/** Map Postgres snake_case rows ↔ app camelCase types */

import type {
  AppUser, Book, Warehouse, Box, BookInventory, Transfer, TransferItem,
  InventoryMovement, Sale, SaleItem, Customer, Discount, Stocktake, ShelfLocation,
  AuditLog,
} from '@/types'

export function mapProfile(row: {
  id: string
  email: string
  display_name: string
  role: AppUser['role']
  is_active: boolean
  created_at: string
  created_by?: string | null
}): AppUser {
  return {
    uid: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at as unknown as AppUser['createdAt'],
    createdBy: row.created_by ?? undefined,
  }
}

export function mapBook(row: Record<string, unknown>): Book {
  return {
    id: row.id as string,
    name: row.name as string,
    author: (row.author as string) ?? undefined,
    isbn: (row.isbn as string) ?? undefined,
    language: row.language as Book['language'],
    category: row.category as Book['category'],
    publisher: (row.publisher as string) ?? undefined,
    mrp: Number(row.mrp ?? 0),
    costPrice: Number(row.cost_price ?? 0),
    inStock: Number(row.in_stock ?? 0),
    minStockAlert: Number(row.min_stock_alert ?? 5),
    description: (row.description as string) ?? undefined,
    coverUrl: (row.cover_url as string) ?? undefined,
    isbnLocked: Boolean(row.isbn_locked),
    metadataSource: (row.metadata_source as string) ?? undefined,
    createdAt: row.created_at as Book['createdAt'],
    updatedAt: row.updated_at as Book['updatedAt'],
    createdBy: (row.created_by as string) ?? '',
    isDeleted: Boolean(row.is_deleted),
    deletedAt: (row.deleted_at as Book['deletedAt']) ?? undefined,
    deletedBy: (row.deleted_by as string) ?? undefined,
  }
}

export function bookToRow(b: Partial<Book> & { name?: string }): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (b.name !== undefined) row.name = b.name
  if (b.author !== undefined) row.author = b.author
  if (b.isbn !== undefined) row.isbn = b.isbn
  if (b.language !== undefined) row.language = b.language
  if (b.category !== undefined) row.category = b.category
  if (b.publisher !== undefined) row.publisher = b.publisher
  if (b.mrp !== undefined) row.mrp = b.mrp
  if (b.costPrice !== undefined) row.cost_price = b.costPrice
  if (b.inStock !== undefined) row.in_stock = b.inStock
  if (b.minStockAlert !== undefined) row.min_stock_alert = b.minStockAlert
  if (b.description !== undefined) row.description = b.description
  if (b.coverUrl !== undefined) row.cover_url = b.coverUrl
  if (b.isbnLocked !== undefined) row.isbn_locked = b.isbnLocked
  if (b.metadataSource !== undefined) row.metadata_source = b.metadataSource
  if (b.isDeleted !== undefined) row.is_deleted = b.isDeleted
  if (b.createdBy !== undefined) row.created_by = b.createdBy
  return row
}

export function mapWarehouse(row: Record<string, unknown>): Warehouse {
  return {
    id: row.id as string,
    name: row.name as string,
    code: row.code as string,
    type: row.type as Warehouse['type'],
    address: (row.address as string) ?? undefined,
    isActive: Boolean(row.is_active ?? true),
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at as Warehouse['createdAt'],
    createdBy: (row.created_by as string) ?? '',
  }
}

export function mapBox(row: Record<string, unknown>): Box & { id: string } {
  return {
    id: row.id as string,
    barcode: row.barcode as string,
    bookId: row.book_id as string,
    bookName: row.book_name as string,
    warehouseId: row.warehouse_id as string,
    quantity: Number(row.quantity ?? 0),
    initialQuantity: Number(row.initial_quantity ?? 0),
    status: row.status as Box['status'],
    shelfLocation: (row.shelf_location as string) ?? undefined,
    shelfNote: (row.shelf_note as string) ?? undefined,
    batchRef: (row.batch_ref as string) ?? undefined,
    notes: (row.notes as string) ?? undefined,
    createdAt: row.created_at as Box['createdAt'],
    createdBy: (row.created_by as string) ?? '',
    openedAt: (row.opened_at as Box['openedAt']) ?? undefined,
    isDeleted: Boolean(row.is_deleted),
  }
}

export function mapInventory(row: Record<string, unknown>): BookInventory {
  return {
    bookId: row.book_id as string,
    byWarehouse: (row.by_warehouse as Record<string, number>) ?? {},
    totalWarehouseQty: Number(row.total_warehouse_qty ?? 0),
    retailQty: Number(row.retail_qty ?? 0),
    updatedAt: row.updated_at as BookInventory['updatedAt'],
  }
}

export function mapTransfer(row: Record<string, unknown>): Transfer & { id: string } {
  const items = (row.items as TransferItem[]) ?? []
  return {
    id: row.id as string,
    fromWarehouseId: row.from_warehouse_id as string,
    toWarehouseId: row.to_warehouse_id as string,
    status: row.status as Transfer['status'],
    items,
    notes: (row.notes as string) ?? undefined,
    createdBy: (row.created_by as string) ?? '',
    createdByName: (row.created_by_name as string) ?? '',
    receivedBy: (row.received_by as string) ?? undefined,
    receivedByName: (row.received_by_name as string) ?? undefined,
    createdAt: row.created_at as Transfer['createdAt'],
    pickedAt: (row.picked_at as Transfer['pickedAt']) ?? undefined,
    receivedAt: (row.received_at as Transfer['receivedAt']) ?? undefined,
  }
}

export function mapMovement(row: Record<string, unknown>): InventoryMovement & { id: string } {
  return {
    id: row.id as string,
    type: row.type as InventoryMovement['type'],
    bookId: row.book_id as string,
    bookName: row.book_name as string,
    quantity: Number(row.quantity ?? 0),
    warehouseId: (row.warehouse_id as string) ?? undefined,
    fromWarehouseId: (row.from_warehouse_id as string) ?? undefined,
    toWarehouseId: (row.to_warehouse_id as string) ?? undefined,
    boxId: (row.box_id as string) ?? undefined,
    transferId: (row.transfer_id as string) ?? undefined,
    saleId: (row.sale_id as string) ?? undefined,
    reason: (row.reason as string) ?? '',
    performedBy: (row.performed_by as string) ?? '',
    performedByName: (row.performed_by_name as string) ?? '',
    createdAt: row.created_at as InventoryMovement['createdAt'],
  }
}

export function mapSale(row: Record<string, unknown>, items: SaleItem[] = []): Sale & { id: string } {
  return {
    id: row.id as string,
    customerId: (row.customer_id as string) ?? undefined,
    customerName: (row.customer_name as string) ?? 'Walk-in',
    customerPhone: (row.customer_phone as string) ?? '',
    items,
    subtotalBeforeDiscount: Number(row.subtotal_before_discount ?? 0),
    totalItemDiscounts: Number(row.total_item_discounts ?? 0),
    orderDiscountPercent: Number(row.order_discount_percent ?? 0),
    orderDiscountAmount: Number(row.order_discount_amount ?? 0),
    totalDiscountAmount: Number(row.total_discount_amount ?? 0),
    grandTotal: Number(row.grand_total ?? 0),
    paymentMethod: row.payment_method as Sale['paymentMethod'],
    amountPaid: Number(row.amount_paid ?? 0),
    changeGiven: Number(row.change_given ?? 0),
    notes: (row.notes as string) ?? undefined,
    cashierId: (row.cashier_id as string) ?? '',
    cashierName: (row.cashier_name as string) ?? '',
    status: (row.status as Sale['status']) ?? 'completed',
    voidReason: (row.void_reason as string) ?? undefined,
    voidedBy: (row.voided_by as string) ?? undefined,
    voidedAt: (row.voided_at as Sale['voidedAt']) ?? undefined,
    returnStatus: (row.return_status as Sale['returnStatus']) ?? undefined,
    returnedItems: (row.returned_items as Sale['returnedItems']) ?? undefined,
    returnReason: (row.return_reason as string) ?? undefined,
    returnedBy: (row.returned_by as string) ?? undefined,
    returnedAt: (row.returned_at as Sale['returnedAt']) ?? undefined,
    returnRefundAmount: row.return_refund_amount != null ? Number(row.return_refund_amount) : undefined,
    createdAt: row.created_at as Sale['createdAt'],
  }
}

export function mapSaleItem(row: Record<string, unknown>): SaleItem {
  return {
    bookId: row.book_id as string,
    bookName: row.book_name as string,
    quantity: Number(row.quantity ?? 0),
    unitPrice: Number(row.unit_price ?? 0),
    discountPercent: Number(row.discount_percent ?? 0),
    discountAmount: Number(row.discount_amount ?? 0),
    subtotal: Number(row.subtotal ?? 0),
  }
}

export function mapCustomer(row: Record<string, unknown>): Customer {
  return {
    id: row.id as string,
    name: row.name as string,
    phone: row.phone as string,
    email: (row.email as string) ?? undefined,
    totalPurchases: Number(row.total_purchases ?? 0),
    totalSpent: Number(row.total_spent ?? 0),
    createdAt: row.created_at as Customer['createdAt'],
    lastPurchaseAt: (row.last_purchase_at as Customer['lastPurchaseAt']) ?? undefined,
  }
}

export function mapDiscount(row: Record<string, unknown>): Discount {
  return {
    id: row.id as string,
    name: row.name as string,
    code: (row.code as string) ?? undefined,
    type: row.type as Discount['type'],
    value: Number(row.value ?? 0),
    scope: row.scope as Discount['scope'],
    minPurchaseAmount: row.min_purchase_amount != null ? Number(row.min_purchase_amount) : undefined,
    maxDiscountAmount: row.max_discount_amount != null ? Number(row.max_discount_amount) : undefined,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at as Discount['createdAt'],
    createdBy: (row.created_by as string) ?? '',
  }
}

export function mapStocktake(row: Record<string, unknown>): Stocktake {
  return {
    id: row.id as string,
    name: row.name as string,
    warehouseId: row.warehouse_id as string,
    status: row.status as Stocktake['status'],
    method: row.method as Stocktake['method'],
    items: (row.items as Stocktake['items']) ?? [],
    createdBy: (row.created_by as string) ?? '',
    createdByName: (row.created_by_name as string) ?? '',
    startedAt: (row.started_at as Stocktake['startedAt']) ?? undefined,
    completedAt: (row.completed_at as Stocktake['completedAt']) ?? undefined,
    createdAt: row.created_at as Stocktake['createdAt'],
  }
}

export function mapAuditLog(row: Record<string, unknown>): AuditLog & { id: string } {
  return {
    id: row.id as string,
    action: row.action as AuditLog['action'],
    entity: row.entity as string,
    entityId: (row.entity_id as string) ?? undefined,
    details: row.details as string,
    performedBy: (row.performed_by as string) ?? '',
    performedByName: (row.performed_by_name as string) ?? '',
    role: row.role as AuditLog['role'],
    createdAt: row.created_at as AuditLog['createdAt'],
  }
}

export function mapShelf(row: Record<string, unknown>): ShelfLocation {
  return {
    id: row.id as string,
    warehouseId: row.warehouse_id as string,
    aisle: row.aisle as string,
    rack: row.rack as string,
    bin: row.bin as string,
    label: row.label as string,
    description: (row.description as string) ?? undefined,
    capacity: row.capacity != null ? Number(row.capacity) : undefined,
    isActive: Boolean(row.is_active ?? true),
    createdAt: row.created_at as ShelfLocation['createdAt'],
    createdBy: (row.created_by as string) ?? '',
  }
}
