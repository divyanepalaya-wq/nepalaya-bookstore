/**
 * analyticsAgg.ts
 *
 * Keeps a lightweight daily analytics document up-to-date on every sale.
 * Path: analytics/{YYYY-MM-DD}
 *
 * This lets SuperAdmin load 30 analytics docs (30 reads) instead of 500 sale
 * documents every time the analytics tab is opened — a ~94% read reduction.
 *
 * The doc is written with setDoc + merge:true so the first sale of the day
 * creates it, and every subsequent sale increments its fields atomically.
 */

import { doc, setDoc, serverTimestamp, increment } from 'firebase/firestore'
import { format } from 'date-fns'
import { db } from '@/lib/firebase'
import type { PaymentMethod } from '@/types'

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

/** Shared builder for both add and reverse (void) operations. dir=1 to add, dir=-1 to subtract. */
function buildAnalyticsUpdate(
  dir: 1 | -1,
  params: { grandTotal: number; paymentMethod: PaymentMethod; items: SaleAnalyticsItem[]; dateStr: string; hourKey: string },
): Record<string, unknown> {
  const { grandTotal, paymentMethod, items, dateStr, hourKey } = params
  const update: Record<string, unknown> = {
    date: dateStr,
    totalRevenue: increment(dir * grandTotal),
    saleCount:    increment(dir * 1),
    cashRevenue:  increment(dir * (paymentMethod === 'cash' ? grandTotal : 0)),
    cashSaleCount:increment(dir * (paymentMethod === 'cash' ? 1 : 0)),
    [`hourlyRevenue.${hourKey}`]: increment(dir * grandTotal),
    [`hourlyCount.${hourKey}`]:   increment(dir * 1),
    [`paymentMethods.${paymentMethod}.count`]:   increment(dir * 1),
    [`paymentMethods.${paymentMethod}.revenue`]: increment(dir * grandTotal),
    updatedAt: serverTimestamp(),
  }
  items.forEach((item) => {
    update[`topBooks.${item.bookId}.qty`]     = increment(dir * item.quantity)
    update[`topBooks.${item.bookId}.revenue`] = increment(dir * item.subtotal)
    update[`topBooks.${item.bookId}.name`]    = item.bookName  // always safe to keep the name
  })
  return update
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
    const analyticsRef = doc(db, 'analytics', dateStr)
    await setDoc(analyticsRef, buildAnalyticsUpdate(1, { ...params, dateStr, hourKey }), { merge: true })
  } catch (e) {
    console.warn('[analyticsAgg] Failed to update daily analytics:', e)
  }
}

/**
 * Call when a sale is voided to subtract its numbers from the analytics doc.
 * Uses the sale's original createdAt timestamp so it targets the correct day's doc
 * (a sale created on Monday voided on Tuesday must deduct from Monday's doc).
 * Errors are swallowed — analytics are supplemental.
 */
export async function reverseDailyAnalytics(params: {
  grandTotal: number
  paymentMethod: PaymentMethod
  items: SaleAnalyticsItem[]
  /** The Firestore Timestamp from the original sale's createdAt field */
  saleCreatedAt: { toDate: () => Date }
}): Promise<void> {
  try {
    const { saleCreatedAt, ...rest } = params
    const saleDate = saleCreatedAt.toDate()
    const dateStr  = format(saleDate, 'yyyy-MM-dd')
    const hourKey  = String(saleDate.getHours())
    const analyticsRef = doc(db, 'analytics', dateStr)
    await setDoc(analyticsRef, buildAnalyticsUpdate(-1, { ...rest, dateStr, hourKey }), { merge: true })
  } catch (e) {
    console.warn('[analyticsAgg] Failed to reverse analytics for voided sale:', e)
  }
}
