import type { Timestamp } from 'firebase/firestore'

// ─── Roles ───────────────────────────────────────────────────────────────────

export type UserRole = 'superadmin' | 'admin' | 'cashier'

// ─── User ─────────────────────────────────────────────────────────────────────

export interface AppUser {
  uid: string
  email: string
  displayName: string
  role: UserRole
  isActive: boolean
  createdAt: Timestamp
  createdBy?: string
}

// ─── Book ─────────────────────────────────────────────────────────────────────

export type BookCategory =
  | 'fiction'
  | 'non-fiction'
  | 'textbook'
  | 'children'
  | 'reference'
  | 'comics'
  | 'magazine'
  | 'other'

export interface Book {
  id: string
  name: string
  author: string
  isbn?: string
  category: BookCategory
  publisher?: string
  mrp: number
  costPrice: number
  inStock: number
  minStockAlert: number
  description?: string
  createdAt: Timestamp
  updatedAt: Timestamp
  createdBy: string
}

// ─── Stock Transaction ────────────────────────────────────────────────────────

export type StockTransactionType = 'in' | 'out'

export interface StockTransaction {
  id: string
  bookId: string
  bookName: string
  type: StockTransactionType
  quantity: number
  previousStock: number
  newStock: number
  reason: string
  reference?: string
  performedBy: string
  performedByName: string
  createdAt: Timestamp
}

// ─── Customer ─────────────────────────────────────────────────────────────────

export interface Customer {
  id: string       // phone number used as document ID
  name: string
  phone: string
  email?: string
  totalPurchases: number
  totalSpent: number
  createdAt: Timestamp
  lastPurchaseAt?: Timestamp
}

// ─── Sale ─────────────────────────────────────────────────────────────────────

export type PaymentMethod = 'cash' | 'esewa' | 'khalti' | 'card' | 'credit' | 'bank_transfer'

export interface SaleItem {
  bookId: string
  bookName: string
  quantity: number
  unitPrice: number
  discountPercent: number
  discountAmount: number
  subtotal: number
}

export type SaleStatus = 'completed' | 'voided'

export interface Sale {
  id: string
  customerId?: string
  customerName: string
  customerPhone: string
  items: SaleItem[]
  subtotalBeforeDiscount: number
  totalItemDiscounts: number
  orderDiscountPercent: number
  orderDiscountAmount: number
  totalDiscountAmount: number
  grandTotal: number
  paymentMethod: PaymentMethod
  amountPaid: number
  changeGiven: number
  notes?: string
  cashierId: string
  cashierName: string
  status: SaleStatus
  voidReason?: string
  voidedBy?: string
  voidedAt?: Timestamp
  createdAt: Timestamp
}

// ─── Discount ─────────────────────────────────────────────────────────────────

export type DiscountType = 'percentage' | 'fixed'
export type DiscountScope = 'item' | 'order'

export interface Discount {
  id: string
  name: string
  code?: string
  type: DiscountType
  value: number
  scope: DiscountScope
  minPurchaseAmount?: number
  maxDiscountAmount?: number
  isActive: boolean
  createdAt: Timestamp
  createdBy: string
}

// ─── Audit Log ────────────────────────────────────────────────────────────────

export type AuditAction =
  | 'login'
  | 'logout'
  | 'book_created'
  | 'book_updated'
  | 'book_deleted'
  | 'stock_in'
  | 'stock_out'
  | 'sale_created'
  | 'sale_voided'
  | 'customer_created'
  | 'customer_updated'
  | 'user_created'
  | 'user_updated'
  | 'discount_created'
  | 'discount_updated'
  | 'discount_deleted'
  | 'password_changed'
  | 'profile_updated'

export interface AuditLog {
  id: string
  action: AuditAction
  entity: string
  entityId?: string
  details: string
  performedBy: string
  performedByName: string
  role: UserRole
  createdAt: Timestamp
}

// ─── Cart (local only) ────────────────────────────────────────────────────────

export interface CartItem {
  bookId: string
  bookName: string
  unitPrice: number
  quantity: number
  discountPercent: number
  maxStock: number
}
