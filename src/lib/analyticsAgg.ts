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
    const { grandTotal, paymentMethod, items } = params
    const dateStr = format(new Date(), 'yyyy-MM-dd')
    const hourKey = String(new Date().getHours())
    const analyticsRef = doc(db, 'analytics', dateStr)

    const update: Record<string, unknown> = {
      date: dateStr,
      totalRevenue: increment(grandTotal),
      saleCount: increment(1),
      cashRevenue: increment(paymentMethod === 'cash' ? grandTotal : 0),
      cashSaleCount: increment(paymentMethod === 'cash' ? 1 : 0),
      [`hourlyRevenue.${hourKey}`]: increment(grandTotal),
      [`hourlyCount.${hourKey}`]: increment(1),
      [`paymentMethods.${paymentMethod}.count`]: increment(1),
      [`paymentMethods.${paymentMethod}.revenue`]: increment(grandTotal),
      updatedAt: serverTimestamp(),
    }

    items.forEach((item) => {
      update[`topBooks.${item.bookId}.qty`]     = increment(item.quantity)
      update[`topBooks.${item.bookId}.revenue`] = increment(item.subtotal)
      // name is a set (not increment) — safe to overwrite with same value repeatedly
      update[`topBooks.${item.bookId}.name`]    = item.bookName
    })

    await setDoc(analyticsRef, update, { merge: true })
  } catch (e) {
    // Never crash a sale because analytics failed
    console.warn('[analyticsAgg] Failed to update daily analytics:', e)
  }
}
