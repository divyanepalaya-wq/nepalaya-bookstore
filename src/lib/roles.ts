import type { UserRole, BoxStatus } from '@/types'

/** UI labels for Firestore roles */
export function roleLabel(role: UserRole | undefined): string {
  if (role === 'cashier') return 'Cashier'
  if (role === 'admin') return 'Warehouse'
  if (role === 'superadmin') return 'Admin'
  return role ?? ''
}

/** Can access warehouse ops (receive, transfers, cartons, count) */
export function canWarehouse(role: UserRole | undefined): boolean {
  return role === 'admin' || role === 'superadmin'
}

/** Full admin (reports users, discounts, locations) */
export function canAdmin(role: UserRole | undefined): boolean {
  return role === 'superadmin' || role === 'admin'
}

/** Superadmin-only (user management, full analytics) */
export function isFullAdmin(role: UserRole | undefined): boolean {
  return role === 'superadmin'
}

export function canPOS(role: UserRole | undefined): boolean {
  return role === 'cashier' || role === 'admin' || role === 'superadmin'
}

/** Warehouse operator (Ramesh) — Nepalaya cartons. */
export function isWarehouseOperator(role: UserRole | undefined): boolean {
  return role === 'admin'
}

/** Store floor / cashier. */
export function isStoreOperator(role: UserRole | undefined): boolean {
  return role === 'cashier'
}

/** Default landing path by role. */
export function homePath(role: UserRole | undefined): string {
  if (role === 'cashier') return '/sell'
  if (role === 'admin') return '/cartons'
  return '/receive'
}

export function cartonStatusLabel(status: BoxStatus | string): string {
  if (status === 'sealed') return 'Full'
  if (status === 'open') return 'Open'
  if (status === 'empty') return 'Empty'
  if (status === 'in_transit') return 'In transit'
  return status
}

export function cartonStatusBadge(
  status: BoxStatus | string,
): 'green' | 'yellow' | 'gray' | 'orange' | 'red' {
  if (status === 'sealed') return 'green'
  if (status === 'open') return 'yellow'
  if (status === 'empty') return 'gray'
  if (status === 'in_transit') return 'orange'
  return 'gray'
}

/** Transfer status for operators (hide draft jargon where possible) */
export function transferStatusLabel(status: string): string {
  if (status === 'draft') return 'Draft'
  if (status === 'picked' || status === 'in_transit') return 'Sent'
  if (status === 'received') return 'Received'
  if (status === 'cancelled') return 'Cancelled'
  return status
}

export const LOCATION_LABELS = {
  primary: 'Main Warehouse',
  buffer: 'Backroom',
  bookstore: 'Bookstore Floor',
} as const
