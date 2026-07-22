import type { UserRole, BoxStatus } from '@/types'

/** Operator-facing labels (not raw DB slugs). */
export function roleLabel(role: UserRole | undefined): string {
  if (role === 'superadmin') return 'Admin'
  if (role === 'admin' || role === 'warehouse') return 'Warehouse'
  if (role === 'cashier') return 'Cashier'
  if (role === 'receptionist') return 'Receptionist'
  return role ?? ''
}

export const ROLE_OPTIONS: {
  value: UserRole
  label: string
  desc: string
}[] = [
  {
    value: 'superadmin',
    label: 'Admin',
    desc: 'Everything · staff · settings',
  },
  {
    value: 'warehouse',
    label: 'Warehouse',
    desc: 'Cartons · stock in · send · undo',
  },
  {
    value: 'admin',
    label: 'Warehouse (legacy)',
    desc: 'Same as Warehouse — kept for old accounts',
  },
  {
    value: 'receptionist',
    label: 'Receptionist',
    desc: 'Sell · vendor stock in · books',
  },
  {
    value: 'cashier',
    label: 'Cashier',
    desc: 'Sell only',
  },
]

/** Roles shown when creating/editing staff (hide legacy admin duplicate). */
export const STAFF_ROLE_OPTIONS = ROLE_OPTIONS.filter((r) => r.value !== 'admin')

export function rolePermissions(role: UserRole | undefined): string[] {
  if (role === 'superadmin') {
    return ['Stock in', 'Send', 'Sell', 'Books', 'Cartons', 'Undo', 'Staff', 'Settings']
  }
  if (role === 'admin' || role === 'warehouse') {
    return ['Stock in', 'Send', 'Sell', 'Books', 'Cartons', 'Undo', 'Locations']
  }
  if (role === 'receptionist') {
    return ['Vendor stock in', 'Sell', 'Books']
  }
  if (role === 'cashier') {
    return ['Sell']
  }
  return []
}

export function canWarehouse(role: UserRole | undefined): boolean {
  return role === 'admin' || role === 'warehouse' || role === 'superadmin'
}

export function canAdmin(role: UserRole | undefined): boolean {
  return role === 'superadmin' || role === 'admin' || role === 'warehouse'
}

export function isFullAdmin(role: UserRole | undefined): boolean {
  return role === 'superadmin'
}

export function canPOS(role: UserRole | undefined): boolean {
  return (
    role === 'cashier' ||
    role === 'receptionist' ||
    role === 'admin' ||
    role === 'warehouse' ||
    role === 'superadmin'
  )
}

/** Vendor (Nepali/English) receive to shelf. */
export function canVendorReceive(role: UserRole | undefined): boolean {
  return (
    role === 'receptionist' ||
    role === 'admin' ||
    role === 'warehouse' ||
    role === 'superadmin'
  )
}

export function isWarehouseOperator(role: UserRole | undefined): boolean {
  return role === 'admin' || role === 'warehouse'
}

export function isStoreOperator(role: UserRole | undefined): boolean {
  return role === 'cashier' || role === 'receptionist'
}

export function homePath(role: UserRole | undefined): string {
  if (role === 'cashier' || role === 'receptionist') return '/sell'
  if (role === 'admin' || role === 'warehouse') return '/overview'
  return '/overview'
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
