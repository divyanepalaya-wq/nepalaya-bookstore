import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format } from 'date-fns'
import type { Timestamp } from 'firebase/firestore'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number): string {
  return `Rs. ${amount.toLocaleString('en-NP', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatDate(ts: Timestamp | Date | null | undefined): string {
  if (!ts) return '—'
  const d = ts instanceof Date ? ts : ts.toDate()
  return format(d, 'MMM d, yyyy')
}

export function formatDateTime(ts: Timestamp | Date | null | undefined): string {
  if (!ts) return '—'
  const d = ts instanceof Date ? ts : ts.toDate()
  return format(d, 'MMM d, yyyy h:mm a')
}

export function generateId(): string {
  return Math.random().toString(36).slice(2, 11)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debounce<T extends (...args: any[]) => any>(fn: T, ms: number): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>
  return (...args: Parameters<T>) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}
