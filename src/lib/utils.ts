import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format } from 'date-fns'
import type { AppTimestamp } from '@/types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number): string {
  return `Rs. ${amount.toLocaleString('en-NP', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function toDate(ts: AppTimestamp | Date | null | undefined): Date | null {
  if (!ts) return null
  if (ts instanceof Date) return ts
  if (typeof ts === 'string') {
    const d = new Date(ts)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof ts === 'object' && 'toDate' in ts && typeof ts.toDate === 'function') {
    return ts.toDate()
  }
  return null
}

export function formatDate(ts: AppTimestamp | Date | null | undefined): string {
  const d = toDate(ts)
  if (!d) return '—'
  return format(d, 'MMM d, yyyy')
}

export function formatDateTime(ts: AppTimestamp | Date | null | undefined): string {
  const d = toDate(ts)
  if (!d) return '—'
  return format(d, 'MMM d, yyyy h:mm a')
}

export function toMillis(ts: AppTimestamp | Date | null | undefined): number {
  const d = toDate(ts)
  return d ? d.getTime() : 0
}

export function generateId(): string {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 11)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debounce<T extends (...args: any[]) => any>(fn: T, ms: number): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>
  return (...args: Parameters<T>) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}
