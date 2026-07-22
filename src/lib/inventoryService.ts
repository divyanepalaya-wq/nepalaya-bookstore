/**
 * inventoryService.ts
 *
 * Centralized Supabase (Postgres) operations for warehouse / carton / location stock ops.
 * Dual-writes books.in_stock whenever retail (bookstore) qty changes — handled server-side
 * by the `apply_inventory_delta` RPC, which every mutation below ultimately goes through.
 *
 * One-place invariant: a copy lives in exactly one location qty (Main / Backroom / Store).
 * Moves transfer quantity between locations; they never create duplicate stock.
 * Cartons track physical packaging; location qty (book_inventory.by_warehouse) is the
 * source of truth for availability.
 *
 * Multi-row mutations (receive, put-on-sale, transfer pick/receive) are executed as
 * Postgres RPCs (`receive_cartons`, `put_on_sale`, `pick_transfer`, `receive_transfer`)
 * so they stay atomic on the server — there is no client-side transaction primitive in
 * Supabase the way there was with Firestore.
 */

import { supabase } from '@/lib/supabase'
import { mapBox, mapInventory } from '@/lib/mappers'
import { writeAuditLog } from '@/lib/auditLog'
import { newRequestId, opsErrorMessage } from '@/lib/opsErrors'
import type {
  AppUser,
  Box,
  BookInventory,
  MovementType,
  WarehouseType,
  ShelfLocation,
  StocktakeItem,
  StocktakeCountMethod,
  TransferItem,
} from '@/types'
import { DEFAULT_WAREHOUSE_IDS as WH_IDS } from '@/types'
import type { Json } from '@/types/database'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fail(error: { message: string } | null | undefined, fallback: string): never {
  if (!error) throw new Error(fallback)
  throw new Error(opsErrorMessage(error, fallback))
}

// ─── Seed default warehouses ──────────────────────────────────────────────────

export async function seedDefaultWarehouses(user: AppUser): Promise<void> {
  const defaults: Array<{
    id: string
    name: string
    code: string
    type: WarehouseType
    isDefault: boolean
  }> = [
    { id: WH_IDS.primary, name: 'Main Warehouse', code: 'PW', type: 'primary_warehouse', isDefault: true },
    { id: WH_IDS.buffer, name: 'Backroom', code: 'SW', type: 'buffer_warehouse', isDefault: true },
    { id: WH_IDS.bookstore, name: 'Bookstore Floor', code: 'BS', type: 'bookstore', isDefault: true },
  ]

  for (const w of defaults) {
    const { data: existing, error: fetchError } = await supabase
      .from('warehouses')
      .select('id')
      .eq('id', w.id)
      .maybeSingle()
    if (fetchError) fail(fetchError, 'Failed to check warehouse')
    if (existing) continue

    const { error } = await supabase.from('warehouses').insert({
      id: w.id,
      name: w.name,
      code: w.code,
      type: w.type,
      is_active: true,
      is_default: w.isDefault,
      created_by: user.uid,
    })
    if (error) fail(error, 'Failed to seed warehouse')
  }
}

/** Backfill book_inventory from books.in_stock for the bookstore location. */
export async function migrateBookInventory(bookstoreId: string = WH_IDS.bookstore): Promise<number> {
  const { data: books, error } = await supabase
    .from('books')
    .select('id, in_stock, is_deleted')
    .eq('is_deleted', false)
  if (error) fail(error, 'Failed to load books')

  let count = 0
  for (const b of books ?? []) {
    const bookId = b.id as string
    const { data: existing, error: invError } = await supabase
      .from('book_inventory')
      .select('book_id')
      .eq('book_id', bookId)
      .maybeSingle()
    if (invError) continue
    if (existing) continue

    const inStock = Number(b.in_stock ?? 0)
    const { error: insertError } = await supabase.from('book_inventory').insert({
      book_id: bookId,
      by_warehouse: { [bookstoreId]: inStock },
      total_warehouse_qty: 0,
      retail_qty: inStock,
      updated_at: new Date().toISOString(),
    })
    if (!insertError) count++
  }
  return count
}

// ─── Receive boxes ────────────────────────────────────────────────────────────

export interface ReceiveBoxesParams {
  bookId: string
  bookName: string
  warehouseId: string
  warehouseCode: string
  bookstoreId: string
  totalQuantity: number
  copiesPerBox: number
  batchRef?: string
  shelfLocation?: string
  notes?: string
  user: AppUser
}

export interface ReceiveBoxesResult {
  boxes: Array<{ id: string; barcode: string; quantity: number }>
}

/** Receive a shipment into full + (optional) loose cartons via the `receive_cartons` RPC. */
export async function receiveBoxes(params: ReceiveBoxesParams): Promise<ReceiveBoxesResult> {
  const {
    bookId, bookName, warehouseId, warehouseCode, bookstoreId,
    totalQuantity, copiesPerBox, batchRef, shelfLocation, notes, user,
  } = params

  if (totalQuantity <= 0) throw new Error('Quantity must be positive')
  if (copiesPerBox <= 0) throw new Error('Copies per box must be positive')

  const { data, error } = await supabase.rpc('receive_cartons', {
    p_book_id: bookId,
    p_book_name: bookName,
    p_warehouse_id: warehouseId,
    p_warehouse_code: warehouseCode,
    p_bookstore_id: bookstoreId,
    p_total_quantity: totalQuantity,
    p_copies_per_box: copiesPerBox,
    p_batch_ref: batchRef ?? '',
    p_shelf_location: shelfLocation ?? '',
    p_notes: notes ?? '',
    p_client_request_id: newRequestId(),
  } as never)
  if (error) fail(error, 'Receive failed')

  const boxes = (
    (data as { boxes?: Array<{ id: string; barcode: string; quantity: number }> } | null)?.boxes ?? []
  )

  await writeAuditLog({
    action: 'box_created',
    entity: 'box',
    details: `Received ${totalQuantity}x "${bookName}" into ${boxes.length} carton(s) at ${warehouseCode}`,
    performedBy: user.uid,
    performedByName: user.displayName,
    role: user.role,
  })

  return { boxes }
}

/** Third-party Nepali/English books → bookstore shelf (no carton). */
export async function receiveVendorStock(params: {
  bookId: string
  bookName: string
  quantity: number
  bookstoreId: string
  notes?: string
  user: AppUser
}): Promise<void> {
  const { bookId, bookName, quantity, bookstoreId, notes, user } = params
  if (quantity <= 0) throw new Error('Quantity must be positive')

  const { error } = await supabase.rpc('receive_vendor_stock', {
    p_book_id: bookId,
    p_book_name: bookName,
    p_quantity: quantity,
    p_bookstore_id: bookstoreId,
    p_notes: notes ?? '',
    p_client_request_id: newRequestId(),
  } as never)

  if (error) {
    // Fallback if migration 006 not applied yet
    if (!/function|schema|does not exist|PGRST/i.test(error.message)) {
      fail(error, 'Vendor receive failed')
    }
    const { data: inv } = await supabase
      .from('book_inventory')
      .select('*')
      .eq('book_id', bookId)
      .maybeSingle()
    const by = { ...((inv?.by_warehouse as Record<string, number>) ?? {}) }
    const nextRetail = (Number(by[bookstoreId] ?? inv?.retail_qty ?? 0) || 0) + quantity
    by[bookstoreId] = nextRetail
    let whTotal = 0
    for (const [k, v] of Object.entries(by)) {
      if (k === bookstoreId) continue
      whTotal += Number(v) || 0
    }
    const { error: uerr } = await supabase.from('book_inventory').upsert({
      book_id: bookId,
      by_warehouse: by,
      total_warehouse_qty: whTotal,
      retail_qty: nextRetail,
      updated_at: new Date().toISOString(),
    })
    if (uerr) fail(uerr, 'Vendor receive failed')
    await supabase.from('books').update({ in_stock: nextRetail }).eq('id', bookId)
    await writeMovement({
      type: 'receive',
      bookId,
      bookName,
      quantity,
      warehouseId: bookstoreId,
      reason: notes?.trim() || 'Vendor delivery to store shelf',
      performedBy: user.uid,
      performedByName: user.displayName,
    })
  }

  await writeAuditLog({
    action: 'vendor_receive',
    entity: 'book',
    entityId: bookId,
    details: `Vendor received ${quantity}x "${bookName}" onto store shelf`,
    performedBy: user.uid,
    performedByName: user.displayName,
    role: user.role,
  })
}

/**
 * Undo a mistaken carton receive: soft-delete carton and remove its pieces
 * from warehouse inventory. Only if carton still has qty and is not in transit.
 */
export async function voidCarton(params: {
  boxId: string
  bookstoreId: string
  reason?: string
  user: AppUser
}): Promise<{ bookId: string; quantity: number; barcode: string }> {
  const { boxId, bookstoreId, reason, user } = params

  const { data: rpcData, error: rpcErr } = await supabase.rpc(
    'void_carton' as never,
    {
      p_box_id: boxId,
      p_bookstore_id: bookstoreId,
      p_reason: reason ?? '',
      p_client_request_id: newRequestId(),
    } as never,
  )

  if (!rpcErr && rpcData) {
    const r = rpcData as { bookId?: string; quantity?: number; barcode?: string }
    return {
      bookId: r.bookId ?? '',
      quantity: r.quantity ?? 0,
      barcode: r.barcode ?? '',
    }
  }
  if (rpcErr && !/function|schema|does not exist|PGRST/i.test(rpcErr.message)) {
    fail(rpcErr, 'Could not void carton')
  }

  const { data: row, error: fetchErr } = await supabase
    .from('boxes')
    .select('*')
    .eq('id', boxId)
    .maybeSingle()
  if (fetchErr) fail(fetchErr, 'Could not load carton')
  if (!row) throw new Error('Carton not found')
  const box = mapBox(row as Record<string, unknown>)
  if (box.isDeleted || box.quantity <= 0) throw new Error('Carton already empty')
  if (box.status === 'in_transit') throw new Error('Carton is in transit — receive or cancel transfer first')

  const qty = box.quantity
  const warehouseId = box.warehouseId
  const now = new Date().toISOString()

  const { error: boxErr } = await supabase
    .from('boxes')
    .update({
      quantity: 0,
      status: 'empty',
      is_deleted: true,
      notes: [box.notes, reason?.trim() || 'Voided mistaken receive'].filter(Boolean).join(' · '),
      opened_at: now,
    })
    .eq('id', boxId)
  if (boxErr) fail(boxErr, 'Could not void carton')

  await adjustLocationQty({
    bookId: box.bookId,
    locationId: warehouseId,
    bookstoreId,
    delta: -qty,
  })

  await writeMovement({
    type: 'adjustment',
    bookId: box.bookId,
    bookName: box.bookName,
    quantity: -qty,
    warehouseId,
    boxId,
    reason: reason?.trim() || `Voided carton ${box.barcode} (mistaken receive)`,
    performedBy: user.uid,
    performedByName: user.displayName,
  })

  await writeAuditLog({
    action: 'box_deleted',
    entity: 'box',
    entityId: boxId,
    details: `Voided carton ${box.barcode}: -${qty} pcs of "${box.bookName}"`,
    performedBy: user.uid,
    performedByName: user.displayName,
    role: user.role,
  })

  return { bookId: box.bookId, quantity: qty, barcode: box.barcode }
}

/** Void several cartons (e.g. undo last warehouse receive). */
export async function voidCartons(params: {
  boxIds: string[]
  bookstoreId: string
  reason?: string
  user: AppUser
}): Promise<number> {
  let pcs = 0
  for (const boxId of params.boxIds) {
    const r = await voidCarton({
      boxId,
      bookstoreId: params.bookstoreId,
      reason: params.reason,
      user: params.user,
    })
    pcs += r.quantity
  }
  return pcs
}

/**
 * Remove pieces from store shelf (undo mistaken vendor receive or over-count).
 */
export async function removeShelfStock(params: {
  bookId: string
  bookName: string
  quantity: number
  bookstoreId: string
  reason?: string
  user: AppUser
}): Promise<void> {
  const { bookId, bookName, quantity, bookstoreId, reason, user } = params
  if (quantity <= 0) throw new Error('Quantity must be positive')

  await adjustLocationQty({
    bookId,
    locationId: bookstoreId,
    bookstoreId,
    delta: -quantity,
  })

  await writeMovement({
    type: 'adjustment',
    bookId,
    bookName,
    quantity: -quantity,
    warehouseId: bookstoreId,
    reason: reason?.trim() || 'Removed from shelf (mistaken receive)',
    performedBy: user.uid,
    performedByName: user.displayName,
  })

  await writeAuditLog({
    action: 'stock_adjusted',
    entity: 'book',
    entityId: bookId,
    details: `Removed ${quantity}x "${bookName}" from shelf`,
    performedBy: user.uid,
    performedByName: user.displayName,
    role: user.role,
  })
}

/** Apply ±delta to a location in book_inventory (and books.in_stock when retail). */
async function adjustLocationQty(params: {
  bookId: string
  locationId: string
  bookstoreId: string
  delta: number
}): Promise<void> {
  const { bookId, locationId, bookstoreId, delta } = params
  if (delta === 0) return

  const { data: inv, error } = await supabase
    .from('book_inventory')
    .select('*')
    .eq('book_id', bookId)
    .maybeSingle()
  if (error) fail(error, 'Failed to load inventory')

  const by = { ...((inv?.by_warehouse as Record<string, number>) ?? {}) }
  const current = Number(by[locationId] ?? (locationId === bookstoreId ? inv?.retail_qty : 0) ?? 0) || 0
  const next = current + delta
  if (next < 0) throw new Error(`Not enough stock at location (have ${current}, need ${Math.abs(delta)})`)
  by[locationId] = next

  let whTotal = 0
  for (const [k, v] of Object.entries(by)) {
    if (k === bookstoreId) continue
    whTotal += Number(v) || 0
  }
  const retailQty = Number(by[bookstoreId] ?? 0) || 0

  const { error: uerr } = await supabase.from('book_inventory').upsert({
    book_id: bookId,
    by_warehouse: by,
    total_warehouse_qty: whTotal,
    retail_qty: retailQty,
    updated_at: new Date().toISOString(),
  })
  if (uerr) fail(uerr, 'Failed to update inventory')

  if (locationId === bookstoreId) {
    await supabase.from('books').update({ in_stock: retailQty }).eq('id', bookId)
  }
}

// ─── Transfers ────────────────────────────────────────────────────────────────

export async function createTransfer(params: {
  fromWarehouseId: string
  toWarehouseId: string
  items: TransferItem[]
  notes?: string
  user: AppUser
}): Promise<string> {
  const { fromWarehouseId, toWarehouseId, items, notes, user } = params
  if (fromWarehouseId === toWarehouseId) throw new Error('Source and destination must differ')
  if (items.length === 0) throw new Error('Add at least one box')

  const { data, error } = await supabase
    .from('transfers')
    .insert({
      from_warehouse_id: fromWarehouseId,
      to_warehouse_id: toWarehouseId,
      status: 'draft',
      items: items as unknown as Json,
      notes: notes ?? '',
      created_by: user.uid,
      created_by_name: user.displayName,
    })
    .select('id')
    .single()
  if (error) fail(error, 'Failed to create transfer')

  await writeAuditLog({
    action: 'transfer_created',
    entity: 'transfer',
    entityId: data.id as string,
    details: `Transfer draft: ${items.length} box(es) from ${fromWarehouseId} → ${toWarehouseId}`,
    performedBy: user.uid,
    performedByName: user.displayName,
    role: user.role,
  })

  return data.id as string
}

/**
 * Create a draft transfer and immediately pick it (deduct source inventory,
 * mark boxes in_transit) in one atomic server round-trip — the default
 * "Send" action from the Transfers screen.
 */
export async function createAndPickTransfer(params: {
  fromWarehouseId: string
  toWarehouseId: string
  items: TransferItem[]
  bookstoreId: string
  notes?: string
}): Promise<string> {
  const { fromWarehouseId, toWarehouseId, items, bookstoreId, notes } = params
  if (fromWarehouseId === toWarehouseId) throw new Error('Source and destination must differ')
  if (items.length === 0) throw new Error('Add at least one box')

  const { data, error } = await supabase.rpc('create_and_pick_transfer', {
    p_from_warehouse_id: fromWarehouseId,
    p_to_warehouse_id: toWarehouseId,
    p_items: items as unknown as Json,
    p_bookstore_id: bookstoreId,
    p_notes: notes ?? '',
    p_client_request_id: newRequestId(),
  } as never)
  if (error) fail(error, 'Send failed')

  const result = (data ?? {}) as { transferId?: string }
  return result.transferId ?? ''
}

/** Pick transfer: mark boxes in_transit, deduct source inventory (server-side, atomic). */
export async function pickTransfer(params: {
  transferId: string
  bookstoreId: string
  user: AppUser
}): Promise<void> {
  const { transferId, bookstoreId, user } = params
  const { error } = await supabase.rpc('pick_transfer', {
    p_transfer_id: transferId,
    p_bookstore_id: bookstoreId,
    p_client_request_id: newRequestId(),
  } as never)
  if (error) fail(error, 'Send failed')

  await writeAuditLog({
    action: 'transfer_picked',
    entity: 'transfer',
    entityId: transferId,
    details: 'Transfer picked / in transit',
    performedBy: user.uid,
    performedByName: user.displayName,
    role: user.role,
  })
}

/** Receive transfer at destination (server-side, atomic). */
export async function receiveTransfer(params: {
  transferId: string
  bookstoreId: string
  user: AppUser
}): Promise<void> {
  const { transferId, bookstoreId, user } = params
  const { error } = await supabase.rpc('receive_transfer', {
    p_transfer_id: transferId,
    p_bookstore_id: bookstoreId,
    p_client_request_id: newRequestId(),
  } as never)
  if (error) fail(error, 'Receive failed')

  await writeAuditLog({
    action: 'transfer_received',
    entity: 'transfer',
    entityId: transferId,
    details: 'Transfer received at destination',
    performedBy: user.uid,
    performedByName: user.displayName,
    role: user.role,
  })
}

export async function cancelTransfer(params: {
  transferId: string
  user: AppUser
}): Promise<void> {
  const { transferId, user } = params
  const { data: existing, error: fetchError } = await supabase
    .from('transfers')
    .select('status')
    .eq('id', transferId)
    .maybeSingle()
  if (fetchError) fail(fetchError, 'Failed to load transfer')
  if (!existing) throw new Error('Transfer not found')
  if (existing.status !== 'draft') throw new Error('Only draft transfers can be cancelled')

  const { error } = await supabase.from('transfers').update({ status: 'cancelled' }).eq('id', transferId)
  if (error) fail(error, 'Cancel failed')

  await writeAuditLog({
    action: 'transfer_cancelled',
    entity: 'transfer',
    entityId: transferId,
    details: 'Transfer cancelled',
    performedBy: user.uid,
    performedByName: user.displayName,
    role: user.role,
  })
}

// ─── Split a box ──────────────────────────────────────────────────────────────

/** Split a box into two — deducts qty from original, creates new box with the remainder (server-side, atomic). */
export async function splitBox(params: {
  boxId: string
  quantity: number
  user: AppUser
}): Promise<{ id: string; barcode: string; quantity: number }> {
  const { boxId, quantity } = params
  if (quantity <= 0) throw new Error('Quantity must be positive')

  const { data, error } = await supabase.rpc('split_box', {
    p_box_id: boxId,
    p_quantity: quantity,
    p_client_request_id: newRequestId(),
  } as never)
  if (error) fail(error, 'Split failed')

  const result = (data ?? {}) as { id?: string; barcode?: string; quantity?: number }
  return {
    id: result.id ?? '',
    barcode: result.barcode ?? '',
    quantity: result.quantity ?? quantity,
  }
}

// ─── Replenish retail from a warehouse box ────────────────────────────────────

export async function replenishRetail(params: {
  boxId: string
  quantity: number
  bufferWarehouseId: string
  bookstoreId: string
  user: AppUser
}): Promise<void> {
  const { boxId, quantity, bookstoreId, user } = params
  if (quantity <= 0) throw new Error('Quantity must be positive')

  const { error } = await supabase.rpc('put_on_sale', {
    p_box_id: boxId,
    p_quantity: quantity,
    p_bookstore_id: bookstoreId,
    p_client_request_id: newRequestId(),
  })
  if (error) fail(error, 'Replenish failed')

  await writeAuditLog({
    action: 'replenish_retail',
    entity: 'box',
    entityId: boxId,
    details: `Replenished ${quantity} units to bookstore floor`,
    performedBy: user.uid,
    performedByName: user.displayName,
    role: user.role,
  })
}

/**
 * Undo "put on sale": move pieces from store shelf back into the carton.
 */
export async function undoReplenish(params: {
  boxId: string
  quantity: number
  bookstoreId: string
  reason?: string
  user: AppUser
}): Promise<void> {
  const { boxId, quantity, bookstoreId, reason, user } = params
  if (quantity <= 0) throw new Error('Quantity must be positive')

  const { data: row, error: fetchErr } = await supabase
    .from('boxes')
    .select('*')
    .eq('id', boxId)
    .maybeSingle()
  if (fetchErr) fail(fetchErr, 'Could not load carton')
  if (!row) throw new Error('Carton not found')
  const box = mapBox(row as Record<string, unknown>)

  // Shelf → warehouse location of this carton
  await adjustLocationQty({
    bookId: box.bookId,
    locationId: bookstoreId,
    bookstoreId,
    delta: -quantity,
  })
  await adjustLocationQty({
    bookId: box.bookId,
    locationId: box.warehouseId,
    bookstoreId,
    delta: quantity,
  })

  const nextQty = box.quantity + quantity
  const nextStatus =
    nextQty <= 0 ? 'empty' : box.status === 'empty' || box.status === 'in_transit' ? 'open' : box.status
  const { error: boxErr } = await supabase
    .from('boxes')
    .update({
      quantity: nextQty,
      status: nextStatus,
      is_deleted: false,
    })
    .eq('id', boxId)
  if (boxErr) fail(boxErr, 'Could not restore carton')

  await writeMovement({
    type: 'adjustment',
    bookId: box.bookId,
    bookName: box.bookName,
    quantity: -quantity,
    warehouseId: bookstoreId,
    fromWarehouseId: bookstoreId,
    toWarehouseId: box.warehouseId,
    boxId,
    reason: reason?.trim() || `Undo put on sale · back to ${box.barcode}`,
    performedBy: user.uid,
    performedByName: user.displayName,
  })

  await writeAuditLog({
    action: 'stock_adjusted',
    entity: 'box',
    entityId: boxId,
    details: `Undid replenish: ${quantity} pcs back to carton ${box.barcode}`,
    performedBy: user.uid,
    performedByName: user.displayName,
    role: user.role,
  })
}

// ─── Lookups ──────────────────────────────────────────────────────────────────

export async function findBoxByBarcode(barcode: string): Promise<(Box & { id: string }) | null> {
  const raw = barcode.trim().replace(/[\r\n\t]+/g, '')
  if (!raw) return null

  const candidates = [
    raw.toUpperCase(),
    raw,
    raw.replace(/\s+/g, ''),
    raw.toUpperCase().replace(/\s+/g, ''),
  ]
  if (/^\d+$/.test(raw) && raw.length >= 4) {
    candidates.push(`NPBX-PW-${raw.padStart(6, '0')}`)
    candidates.push(`NPBX-BR-${raw.padStart(6, '0')}`)
  }

  const tried = new Set<string>()
  for (const code of candidates) {
    if (!code || tried.has(code)) continue
    tried.add(code)
    const { data, error } = await supabase.from('boxes').select('*').eq('barcode', code).limit(1).maybeSingle()
    if (error) fail(error, 'Lookup failed')
    if (data) return mapBox(data)
  }

  const suffix = raw.replace(/[^A-Za-z0-9-]/g, '').slice(-8)
  if (suffix.length >= 4) {
    const { data, error } = await supabase
      .from('boxes')
      .select('*')
      .ilike('barcode', `%${suffix}`)
      .neq('status', 'empty')
      .limit(5)
    if (error) fail(error, 'Lookup failed')
    const hits = (data ?? [])
      .map((r) => mapBox(r as Record<string, unknown>))
      .filter((b) => !b.isDeleted && b.quantity > 0)
    if (hits.length === 1) return hits[0]
  }

  return null
}

export async function getBookInventory(bookId: string): Promise<BookInventory | null> {
  const { data, error } = await supabase.from('book_inventory').select('*').eq('book_id', bookId).maybeSingle()
  if (error) fail(error, 'Failed to load inventory')
  if (!data) return null
  return mapInventory(data)
}

export function getRetailQty(
  inv: BookInventory | null | undefined,
  bookstoreId: string,
  fallbackInStock?: number,
): number {
  if (inv) return inv.byWarehouse?.[bookstoreId] ?? inv.retailQty ?? 0
  return fallbackInStock ?? 0
}

export { WH_IDS }

// ─── Shelf Locations ─────────────────────────────────────────────────────────

export async function createShelfLocation(params: {
  warehouseId: string
  aisle: string
  rack: string
  bin: string
  label: string
  description?: string
  capacity?: number
  user: AppUser
}): Promise<string> {
  const { warehouseId, aisle, rack, bin, label, description, capacity, user } = params
  const { data, error } = await supabase
    .from('shelf_locations')
    .insert({
      warehouse_id: warehouseId,
      aisle: aisle.trim().toUpperCase(),
      rack: rack.trim().padStart(2, '0'),
      bin: bin.trim().padStart(2, '0'),
      label,
      description: description ?? '',
      capacity: capacity ?? null,
      is_active: true,
      created_by: user.uid,
    })
    .select('id')
    .single()
  if (error) fail(error, 'Failed to create shelf location')

  await writeAuditLog({
    action: 'shelf_created',
    entity: 'shelfLocation',
    entityId: data.id as string,
    details: `Created shelf location ${label} in warehouse ${warehouseId}`,
    performedBy: user.uid,
    performedByName: user.displayName,
    role: user.role,
  })

  return data.id as string
}

export async function updateShelfLocation(
  id: string,
  data: Partial<Pick<ShelfLocation, 'aisle' | 'rack' | 'bin' | 'label' | 'description' | 'capacity' | 'isActive'>>,
): Promise<void> {
  const patch: {
    aisle?: string
    rack?: string
    bin?: string
    label?: string
    description?: string
    capacity?: number | null
    is_active?: boolean
  } = {}
  if (data.aisle !== undefined) patch.aisle = data.aisle
  if (data.rack !== undefined) patch.rack = data.rack
  if (data.bin !== undefined) patch.bin = data.bin
  if (data.label !== undefined) patch.label = data.label
  if (data.description !== undefined) patch.description = data.description
  if (data.capacity !== undefined) patch.capacity = data.capacity
  if (data.isActive !== undefined) patch.is_active = data.isActive

  const { error } = await supabase.from('shelf_locations').update(patch).eq('id', id)
  if (error) fail(error, 'Failed to update shelf location')
}

/** Assign a structured shelf location to a box (put-away). */
export async function putAwayBox(params: {
  boxId: string
  shelfLocation: string
  user: AppUser
}): Promise<void> {
  const { boxId, shelfLocation, user } = params
  const { data: existing, error: fetchError } = await supabase
    .from('boxes')
    .select('id')
    .eq('id', boxId)
    .maybeSingle()
  if (fetchError) fail(fetchError, 'Failed to load box')
  if (!existing) throw new Error('Box not found')

  const { error } = await supabase
    .from('boxes')
    .update({ shelf_location: shelfLocation, shelf_note: shelfLocation })
    .eq('id', boxId)
  if (error) fail(error, 'Put-away failed')

  await writeAuditLog({
    action: 'box_putaway',
    entity: 'box',
    entityId: boxId,
    details: `Put away box to ${shelfLocation}`,
    performedBy: user.uid,
    performedByName: user.displayName,
    role: user.role,
  })
}

// ─── Stocktake (Cycle Count) ─────────────────────────────────────────────────

export async function createStocktake(params: {
  name: string
  warehouseId: string
  method: StocktakeCountMethod
  items: StocktakeItem[]
  user: AppUser
}): Promise<string> {
  const { name, warehouseId, method, items, user } = params
  const { data, error } = await supabase
    .from('stocktakes')
    .insert({
      name,
      warehouse_id: warehouseId,
      status: 'draft',
      method,
      // Kept for backwards compatibility with stocktakes read before this
      // migration; new counts are written to `stocktake_lines` below.
      items: items as unknown as Json,
      created_by: user.uid,
      created_by_name: user.displayName,
    })
    .select('id')
    .single()
  if (error) fail(error, 'Failed to create stocktake')

  const stocktakeId = data.id as string

  if (items.length > 0) {
    const { error: linesError } = await supabase.from('stocktake_lines').insert(
      items.map((item, index) => ({
        stocktake_id: stocktakeId,
        line_index: index,
        book_id: item.bookId,
        book_name: item.bookName,
        box_id: item.boxId ?? null,
        box_barcode: item.barcode ?? null,
        warehouse_id: item.warehouseId,
        shelf_location: item.shelfLocation ?? '',
        expected_qty: item.expectedQty,
      })),
    )
    if (linesError) fail(linesError, 'Failed to create stocktake lines')
  }

  await writeAuditLog({
    action: 'stocktake_created',
    entity: 'stocktake',
    entityId: stocktakeId,
    details: `Created stocktake "${name}" with ${items.length} item(s)`,
    performedBy: user.uid,
    performedByName: user.displayName,
    role: user.role,
  })

  return stocktakeId
}

/**
 * Record a counted quantity for a stocktake item via the `update_stocktake_line`
 * RPC (writes to `stocktake_lines` when present, falls back to the legacy
 * `stocktakes.items` jsonb array otherwise — both handled server-side).
 * `countedBy` is accepted for backwards compatibility but ignored: the RPC
 * stamps the count with `auth.uid()`.
 */
export async function updateStocktakeItemCount(
  stocktakeId: string,
  itemIndex: number,
  countedQty: number,
  _countedBy?: string,
): Promise<void> {
  const { error } = await supabase.rpc('update_stocktake_line', {
    p_stocktake_id: stocktakeId,
    p_line_index: itemIndex,
    p_counted_qty: countedQty,
    p_client_request_id: newRequestId(),
  })
  if (error) fail(error, 'Failed to save count')
}

export async function startStocktake(stocktakeId: string): Promise<void> {
  const { error } = await supabase
    .from('stocktakes')
    .update({ status: 'in_progress', started_at: new Date().toISOString() })
    .eq('id', stocktakeId)
  if (error) fail(error, 'Failed to start stocktake')
}

/**
 * Complete a stocktake via the `complete_stocktake` RPC: merges per-book/
 * warehouse deltas (from `stocktake_lines` when present, else the legacy
 * `stocktakes.items` jsonb), applies them, writes adjustment movements, and
 * marks the stocktake completed — all atomically on the server.
 */
export async function completeStocktake(params: {
  stocktakeId: string
  bookstoreId: string
  user: AppUser
}): Promise<{ adjusted: number; totalDiscrepancy: number }> {
  const { stocktakeId, bookstoreId } = params

  const { data, error } = await supabase.rpc('complete_stocktake', {
    p_stocktake_id: stocktakeId,
    p_bookstore_id: bookstoreId,
    p_client_request_id: newRequestId(),
  })
  if (error) fail(error, 'Failed to complete stocktake')

  const result = (data ?? {}) as { adjusted?: number; total_discrepancy?: number; totalDiscrepancy?: number }
  return {
    adjusted: result.adjusted ?? 0,
    totalDiscrepancy: result.total_discrepancy ?? result.totalDiscrepancy ?? 0,
  }
}

export async function cancelStocktake(stocktakeId: string, user: AppUser): Promise<void> {
  const { error } = await supabase.from('stocktakes').update({ status: 'cancelled' }).eq('id', stocktakeId)
  if (error) fail(error, 'Failed to cancel stocktake')

  await writeAuditLog({
    action: 'stocktake_cancelled',
    entity: 'stocktake',
    entityId: stocktakeId,
    details: 'Stocktake cancelled',
    performedBy: user.uid,
    performedByName: user.displayName,
    role: user.role,
  })
}

// ─── Low-level inventory / movement primitives ────────────────────────────────
//
// These no longer take a Firestore `Transaction` — Supabase has no client-side
// transaction handle, so each call below is its own atomic server round-trip
// (`apply_inventory_delta` RPC for stock, a plain insert for movements). Callers
// that need multiple deltas + a movement to be atomic together (e.g. POS checkout)
// should prefer the dedicated `complete_sale` RPC instead of composing these.

/** Prefetch book_inventory rows for a set of books. */
export async function readInventories(bookIds: string[]): Promise<Map<string, BookInventory | null>> {
  const unique = [...new Set(bookIds)]
  const map = new Map<string, BookInventory | null>()
  unique.forEach((id) => map.set(id, null))
  if (unique.length === 0) return map

  const { data, error } = await supabase.from('book_inventory').select('*').in('book_id', unique)
  if (error) fail(error, 'Failed to load inventories')
  ;(data ?? []).forEach((row) => map.set(row.book_id as string, mapInventory(row)))
  return map
}

/**
 * Apply a single location delta for one book via the `apply_inventory_delta` RPC.
 *
 * NOTE: as of the reliability migration, `apply_inventory_delta` execute
 * permission has been revoked from `authenticated` — every client mutation
 * must go through a higher-level, validated RPC (receive_cartons, put_on_sale,
 * pick/receive_transfer, split_box, complete_stocktake, return_sale_items,
 * complete_sale) that calls it server-side instead. This helper is kept only
 * for rare admin adjustments run with elevated (service-role) credentials —
 * calling it as a regular authenticated user will now fail with "permission
 * denied". Prefer `returnSaleItems` over calling this directly for POS returns.
 */
export async function applyInventoryDelta(
  bookId: string,
  warehouseId: string,
  bookstoreId: string,
  delta: number,
): Promise<{ previous: number; next: number; retailQty: number }> {
  const { data, error } = await supabase.rpc('apply_inventory_delta', {
    p_book_id: bookId,
    p_warehouse_id: warehouseId,
    p_bookstore_id: bookstoreId,
    p_delta: delta,
  })
  if (error) fail(error, 'Inventory update failed')
  const result = (data ?? {}) as { previous?: number; next?: number; retail_qty?: number }
  return {
    previous: result.previous ?? 0,
    next: result.next ?? 0,
    retailQty: result.retail_qty ?? 0,
  }
}

/** Apply one or more location deltas for the same book, sequentially. */
export async function commitInventoryDeltas(
  bookId: string,
  bookstoreId: string,
  deltas: Array<{ warehouseId: string; delta: number }>,
): Promise<{ retailQty: number }> {
  let retailQty = 0
  for (const { warehouseId, delta } of deltas) {
    if (delta === 0) continue
    const result = await applyInventoryDelta(bookId, warehouseId, bookstoreId, delta)
    retailQty = result.retailQty
  }
  return { retailQty }
}

export async function writeMovement(params: {
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
}): Promise<string> {
  const { data, error } = await supabase
    .from('inventory_movements')
    .insert({
      type: params.type,
      book_id: params.bookId,
      book_name: params.bookName,
      quantity: params.quantity,
      warehouse_id: params.warehouseId ?? null,
      from_warehouse_id: params.fromWarehouseId ?? null,
      to_warehouse_id: params.toWarehouseId ?? null,
      box_id: params.boxId ?? null,
      transfer_id: params.transferId ?? null,
      sale_id: params.saleId ?? null,
      reason: params.reason,
      performed_by: params.performedBy,
      performed_by_name: params.performedByName,
    })
    .select('id')
    .single()
  if (error) fail(error, 'Failed to record movement')
  return data.id as string
}

// ─── POS sale / return movement helpers ───────────────────────────────────────
//
// NOTE: POS checkout itself should call the `complete_sale` RPC (atomic on the
// server: deducts stock, records sale + sale_items + movements in one go).
// These two helpers remain for the return flow, and for any call site still
// composing its own sale/return logic against book_inventory directly.

export async function recordSaleMovement(params: {
  bookId: string
  bookName: string
  quantity: number // positive units sold
  bookstoreId: string
  saleId?: string
  user: { uid: string; displayName: string }
}): Promise<void> {
  await writeMovement({
    type: 'sale',
    bookId: params.bookId,
    bookName: params.bookName,
    quantity: -params.quantity,
    warehouseId: params.bookstoreId,
    saleId: params.saleId,
    reason: 'POS Sale',
    performedBy: params.user.uid,
    performedByName: params.user.displayName,
  })
}

export async function recordReturnMovement(params: {
  bookId: string
  bookName: string
  quantity: number
  bookstoreId: string
  saleId?: string
  user: { uid: string; displayName: string }
}): Promise<void> {
  await writeMovement({
    type: 'return',
    bookId: params.bookId,
    bookName: params.bookName,
    quantity: params.quantity,
    warehouseId: params.bookstoreId,
    saleId: params.saleId,
    reason: 'POS Return',
    performedBy: params.user.uid,
    performedByName: params.user.displayName,
  })
}

// ─── POS returns (atomic RPC) ───────────────────────────────────────────────

export interface ReturnSaleItemInput {
  bookId: string
  bookName: string
  quantity: number
  /** Refund amount attributable to this line — computed client-side from the sale's per-unit price */
  refundAmount: number
}

/**
 * Return one or more line items from a completed sale in a single atomic
 * server round-trip: restores stock, records the movement, and updates the
 * sale's return status/refund total. Replaces the old multi-step client-side
 * return flow (separate stock read + delta + movement + sale update calls).
 * Prefer this over `applyInventoryDelta` + `recordReturnMovement` for POS
 * returns going forward.
 */
export async function returnSaleItems(params: {
  saleId: string
  items: ReturnSaleItemInput[]
  reason: string
  bookstoreId: string
  user: AppUser
}): Promise<{ refund: number; status: string; returnedQty: number }> {
  const { saleId, items, reason, bookstoreId } = params
  if (items.length === 0) throw new Error('Select at least one item to return')
  if (!reason.trim()) throw new Error('Return reason is required')

  const { data, error } = await supabase.rpc('return_sale_items', {
    p_sale_id: saleId,
    p_items: items as unknown as Json,
    p_reason: reason.trim(),
    p_bookstore_id: bookstoreId,
    p_client_request_id: newRequestId(),
  } as never)
  if (error) fail(error, 'Return failed')

  const result = (data ?? {}) as {
    refundAmount?: number
    returnStatus?: string
    returnedItems?: Array<{ quantityReturned?: number }>
  }
  const returnedQty = (result.returnedItems ?? []).reduce((sum, it) => sum + (it.quantityReturned ?? 0), 0)

  return {
    refund: result.refundAmount ?? 0,
    status: result.returnStatus ?? 'partial',
    returnedQty,
  }
}
