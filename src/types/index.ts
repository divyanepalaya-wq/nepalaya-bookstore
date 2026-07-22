// Timestamp-compatible type (ISO string from Postgres, Date, or legacy Firestore-like)
export type AppTimestamp = string | Date | { toDate: () => Date; toMillis?: () => number }

// ─── Roles ───────────────────────────────────────────────────────────────────

export type UserRole = 'superadmin' | 'admin' | 'warehouse' | 'cashier' | 'receptionist'

// ─── User ─────────────────────────────────────────────────────────────────────

export interface AppUser {
  uid: string
  email: string
  displayName: string
  role: UserRole
  isActive: boolean
  createdAt: AppTimestamp
  createdBy?: string
}

// ─── Book ─────────────────────────────────────────────────────────────────────

/** Primary / top-level grouping — required on every book */
export type BookType = 'Nepalaya' | 'English' | 'Nepali'

/** Sub-category (secondary) */
export type BookCategory =
  | 'fiction'
  | 'non-fiction'
  | 'textbook'
  | 'children'
  | 'reference'
  | 'comics'
  | 'magazine'
  | 'other'

// Keep alias so old imports don't break
export type BookLanguage = BookType

export interface Book {
  id: string
  name: string
  author?: string
  isbn?: string
  language: BookType          // primary category (required)
  category: BookCategory      // sub-category
  publisher?: string
  mrp: number
  costPrice: number
  inStock: number
  minStockAlert: number
  description?: string
  coverUrl?: string
  isbnLocked?: boolean
  metadataSource?: string
  createdAt: AppTimestamp
  updatedAt: AppTimestamp
  createdBy: string
  isDeleted?: boolean
  deletedAt?: AppTimestamp
  deletedBy?: string
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
  createdAt: AppTimestamp
}

// ─── Customer ─────────────────────────────────────────────────────────────────

export interface Customer {
  id: string       // phone number used as document ID
  name: string
  phone: string
  email?: string
  totalPurchases: number
  totalSpent: number
  createdAt: AppTimestamp
  lastPurchaseAt?: AppTimestamp
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
export type ReturnStatus = 'none' | 'partial' | 'full'

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
  voidedAt?: AppTimestamp
  returnStatus?: ReturnStatus
  returnedItems?: { bookId: string; bookName: string; quantityReturned: number }[]
  returnReason?: string
  returnedBy?: string
  returnedAt?: AppTimestamp
  returnRefundAmount?: number
  createdAt: AppTimestamp
}

// ─── Shift Close ──────────────────────────────────────────────────────────────

export interface ShiftClose {
  id: string
  cashierId: string
  cashierName: string
  openingFloat: number
  expectedCash: number
  actualCash: number
  variance: number
  saleCount: number
  totalRevenue: number
  cashSaleCount: number
  cashRevenue: number
  notes?: string
  closedAt: AppTimestamp
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
  createdAt: AppTimestamp
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
  | 'sale_returned'
  | 'shift_closed'
  | 'warehouse_created'
  | 'warehouse_updated'
  | 'box_created'
  | 'box_scanned'
  | 'transfer_created'
  | 'transfer_picked'
  | 'transfer_received'
  | 'transfer_cancelled'
  | 'replenish_retail'
  | 'shelf_created'
  | 'shelf_updated'
  | 'stocktake_created'
  | 'stocktake_completed'
  | 'stocktake_cancelled'
  | 'box_putaway'
  | 'vendor_receive'
  | 'box_deleted'
  | 'stock_adjusted'

export interface AuditLog {
  id: string
  action: AuditAction
  entity: string
  entityId?: string
  details: string
  performedBy: string
  performedByName: string
  role: UserRole
  createdAt: AppTimestamp
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

// ─── Warehouse ────────────────────────────────────────────────────────────────

export type WarehouseType = 'bookstore' | 'primary_warehouse' | 'buffer_warehouse'

export type WorkspaceMode = 'bookstore' | 'full_warehouse' | 'small_warehouse'

export interface Warehouse {
  id: string
  name: string
  code: string
  type: WarehouseType
  address?: string
  isActive: boolean
  isDefault?: boolean
  createdAt: AppTimestamp
  createdBy: string
}

// ─── Box ──────────────────────────────────────────────────────────────────────

export type BoxStatus = 'sealed' | 'open' | 'empty' | 'in_transit'

export interface Box {
  id: string
  barcode: string
  bookId: string
  bookName: string
  warehouseId: string
  quantity: number
  initialQuantity: number
  status: BoxStatus
  /** Structured shelf location (preferred). aisle-rack-bin, e.g. A-03-12 */
  shelfLocation?: string
  /** Free-text legacy location fallback */
  shelfNote?: string
  batchRef?: string
  notes?: string
  createdAt: AppTimestamp
  createdBy: string
  openedAt?: AppTimestamp
  isDeleted?: boolean
}

// ─── Shelf Location ──────────────────────────────────────────────────────────

export interface ShelfLocation {
  id: string
  warehouseId: string
  /** Aisle / zone code, e.g. "A" */
  aisle: string
  /** Rack / shelf number within aisle, e.g. "03" */
  rack: string
  /** Bin / slot within rack, e.g. "12" */
  bin: string
  /** Human label, e.g. "A-03-12" (derived but stored for queries) */
  label: string
  description?: string
  capacity?: number
  isActive: boolean
  createdAt: AppTimestamp
  createdBy: string
}

// ─── Stocktake (Cycle Count) ─────────────────────────────────────────────────

export type StocktakeStatus = 'draft' | 'in_progress' | 'completed' | 'cancelled'

export type StocktakeCountMethod = 'by_box' | 'by_location'

export interface StocktakeItem {
  bookId: string
  bookName: string
  warehouseId: string
  /** Carton this line was counted against, for by_box stocktakes */
  boxId?: string
  /** Carton barcode, for by_box stocktakes */
  barcode?: string
  shelfLocation?: string
  /** Expected quantity from bookInventory */
  expectedQty: number
  /** Counted quantity (null until counted) */
  countedQty: number | null
  countedBy?: string
  countedAt?: AppTimestamp
  note?: string
}

export interface Stocktake {
  id: string
  name: string
  warehouseId: string
  status: StocktakeStatus
  method: StocktakeCountMethod
  items: StocktakeItem[]
  createdBy: string
  createdByName: string
  startedAt?: AppTimestamp
  completedAt?: AppTimestamp
  createdAt: AppTimestamp
}

// ─── Book Inventory (per-location stock) ──────────────────────────────────────

export interface BookInventory {
  bookId: string
  byWarehouse: Record<string, number>
  totalWarehouseQty: number
  retailQty: number
  updatedAt: AppTimestamp
}

// ─── Transfer ─────────────────────────────────────────────────────────────────

export type TransferStatus = 'draft' | 'picked' | 'in_transit' | 'received' | 'cancelled'

export interface TransferItem {
  boxId: string
  barcode: string
  bookId: string
  bookName: string
  quantity: number
  shelfLocation?: string
}

export interface Transfer {
  id: string
  fromWarehouseId: string
  toWarehouseId: string
  status: TransferStatus
  items: TransferItem[]
  notes?: string
  createdBy: string
  createdByName: string
  receivedBy?: string
  receivedByName?: string
  createdAt: AppTimestamp
  pickedAt?: AppTimestamp
  receivedAt?: AppTimestamp
}

// ─── Inventory Movement ───────────────────────────────────────────────────────

export type MovementType =
  | 'receive'
  | 'transfer_out'
  | 'transfer_in'
  | 'replenish_retail'
  | 'adjustment'
  | 'sale'
  | 'return'

export interface InventoryMovement {
  id: string
  type: MovementType
  bookId: string
  bookName: string
  quantity: number
  warehouseId?: string
  fromWarehouseId?: string
  toWarehouseId?: string
  boxId?: string
  transferId?: string
  saleId?: string
  reason: string
  performedBy: string
  performedByName: string
  createdAt: AppTimestamp
}

/** Default warehouse document IDs used for seeding */
export const DEFAULT_WAREHOUSE_IDS = {
  primary: 'wh-primary',
  buffer: 'wh-buffer',
  bookstore: 'wh-bookstore',
} as const
