/**
 * analyticsAgg.ts
 *
 * Keeps a lightweight daily analytics row up-to-date on every sale.
 * Table: analytics (id = 'YYYY-MM-DD', data jsonb)
 *
 * This lets SuperAdmin load 30 analytics rows (30 reads) instead of 500 sale
 * rows every time the analytics tab is opened — a ~94% read reduction.
 *
 * Postgres has no `increment()` field-update primitive like Firestore, so we
 * read the current row, merge the delta into its jsonb `data` in JS, and
 * upsert the result. This is a read-modify-write (not perfectly atomic under
 * heavy concurrent checkout), which is an acceptable trade-off for a
 * supplemental analytics feature.
 */

import { format } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { toMillis } from '@/lib/utils'
import type { AppTimestamp, PaymentMethod } from '@/types'

export interface SaleAnalyticsItem {
  bookId: string
  bookName: string
  quantity: number
  subtotal: number
}

export interface DailyAnalytics {
  date: string
  totalRevenue: number
  saleCount: number
  cashRevenue: number
  cashSaleCount: number
  /** hourlyRevenue['9'] = revenue collected at 09:xx */
  hourlyRevenue: Record<string, number>
  /** hourlyCount['9'] = number of sales at 09:xx */
  hourlyCount: Record<string, number>
  /** topBooks[bookId] = { name, qty, revenue } */
  topBooks: Record<string, { name: string; qty: number; revenue: number }>
  /** paymentMethods['cash'] = { count, revenue } */
  paymentMethods: Record<string, { count: number; revenue: number }>
}

function emptyAnalytics(dateStr: string): DailyAnalytics {
  return {
    date: dateStr,
    totalRevenue: 0,
    saleCount: 0,
    cashRevenue: 0,
    cashSaleCount: 0,
    hourlyRevenue: {},
    hourlyCount: {},
    topBooks: {},
    paymentMethods: {},
  }
}

async function loadDay(dateStr: string): Promise<DailyAnalytics> {
  const { data, error } = await supabase.from('analytics').select('data').eq('id', dateStr).maybeSingle()
  if (error || !data) return emptyAnalytics(dateStr)
  return { ...emptyAnalytics(dateStr), ...(data.data as Partial<DailyAnalytics>) }
}

async function saveDay(dateStr: string, day: DailyAnalytics): Promise<void> {
  await supabase.from('analytics').upsert({
    id: dateStr,
    data: day as unknown as Record<string, unknown>,
    updated_at: new Date().toISOString(),
  })
}

/** Shared merge for both add and reverse (void) operations. dir=1 to add, dir=-1 to subtract. */
function applyDelta(
  day: DailyAnalytics,
  dir: 1 | -1,
  params: { grandTotal: number; paymentMethod: PaymentMethod; items: SaleAnalyticsItem[]; hourKey: string },
): DailyAnalytics {
  const { grandTotal, paymentMethod, items, hourKey } = params
  const isCash = paymentMethod === 'cash'

  const next: DailyAnalytics = {
    ...day,
    totalRevenue: day.totalRevenue + dir * grandTotal,
    saleCount: day.saleCount + dir * 1,
    cashRevenue: day.cashRevenue + dir * (isCash ? grandTotal : 0),
    cashSaleCount: day.cashSaleCount + dir * (isCash ? 1 : 0),
    hourlyRevenue: { ...day.hourlyRevenue },
    hourlyCount: { ...day.hourlyCount },
    topBooks: { ...day.topBooks },
    paymentMethods: { ...day.paymentMethods },
  }

  next.hourlyRevenue[hourKey] = (next.hourlyRevenue[hourKey] ?? 0) + dir * grandTotal
  next.hourlyCount[hourKey] = (next.hourlyCount[hourKey] ?? 0) + dir * 1

  const pm = next.paymentMethods[paymentMethod] ?? { count: 0, revenue: 0 }
  next.paymentMethods[paymentMethod] = {
    count: pm.count + dir * 1,
    revenue: pm.revenue + dir * grandTotal,
  }

  items.forEach((item) => {
    const existing = next.topBooks[item.bookId] ?? { name: item.bookName, qty: 0, revenue: 0 }
    next.topBooks[item.bookId] = {
      name: item.bookName,
      qty: existing.qty + dir * item.quantity,
      revenue: existing.revenue + dir * item.subtotal,
    }
  })

  return next
}

/**
 * Call once after every successful sale.
 * Errors are swallowed — analytics are supplemental and should never break checkout.
 */
export async function updateDailyAnalytics(params: {
  grandTotal: number
  paymentMethod: PaymentMethod
  items: SaleAnalyticsItem[]
}): Promise<void> {
  try {
    const dateStr = format(new Date(), 'yyyy-MM-dd')
    const hourKey = String(new Date().getHours())
    const day = await loadDay(dateStr)
    const next = applyDelta(day, 1, { ...params, hourKey })
    await saveDay(dateStr, next)
  } catch (e) {
    console.warn('[analyticsAgg] Failed to update daily analytics:', e)
  }
}

/**
 * Call when a sale is voided to subtract its numbers from the analytics row.
 * Uses the sale's original createdAt timestamp so it targets the correct day's
 * row (a sale created on Monday voided on Tuesday must deduct from Monday's row).
 * Errors are swallowed — analytics are supplemental.
 */
export async function reverseDailyAnalytics(params: {
  grandTotal: number
  paymentMethod: PaymentMethod
  items: SaleAnalyticsItem[]
  saleCreatedAt: AppTimestamp
}): Promise<void> {
  try {
    const { saleCreatedAt, ...rest } = params
    const ms = toMillis(saleCreatedAt)
    if (!ms) return
    const saleDate = new Date(ms)
    const dateStr = format(saleDate, 'yyyy-MM-dd')
    const hourKey = String(saleDate.getHours())
    const day = await loadDay(dateStr)
    const next = applyDelta(day, -1, { ...rest, hourKey })
    await saveDay(dateStr, next)
  } catch (e) {
    console.warn('[analyticsAgg] Failed to reverse analytics for voided sale:', e)
  }
}
