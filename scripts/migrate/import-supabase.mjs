#!/usr/bin/env node
/**
 * Import exported Firestore/Auth JSON into Supabase.
 *
 * Env:
 *   VITE_SUPABASE_URL or SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY  (required — never commit)
 *
 * Reads scripts/migrate/data/*.json
 * Writes scripts/migrate/data/uid_map.json
 *
 * Strategy for users:
 *   - Create Auth user per email with temp password (or skip if exists)
 *   - Map Firebase uid → Supabase uuid
 *   - Upsert profiles with role from users.json
 *   - Remap createdBy / cashierId fields in other collections
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate/import-supabase.mjs
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dirname, 'data')

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

function load(name) {
  const p = join(dataDir, `${name}.json`)
  if (!existsSync(p)) return []
  return JSON.parse(readFileSync(p, 'utf8'))
}

function remapUid(uid, map) {
  if (!uid) return null
  return map[uid] ?? uid
}

/**
 * Map Firebase UIDs → existing Supabase Auth users by email.
 * Does NOT create Auth users (assumes you already created them manually).
 * Sources: users.json and/or auth-users-basic.json
 */
async function mapExistingUsers(uidMap) {
  const firestoreUsers = load('users')
  const authBasic = load('auth-users-basic')
  const byEmail = new Map()

  for (const u of authBasic) {
    if (u.email && u.uid) byEmail.set(String(u.email).toLowerCase(), { firebaseUid: u.uid, email: u.email })
  }
  for (const u of firestoreUsers) {
    if (u.email && u.id) byEmail.set(String(u.email).toLowerCase(), { firebaseUid: u.id, email: u.email, ...u })
  }

  console.log(`Mapping ${byEmail.size} Firebase emails → existing Supabase users (no create)…`)

  const { data: listed, error } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) {
    console.warn('listUsers failed:', error.message)
    return
  }

  const supabaseByEmail = new Map(
    (listed?.users ?? []).map((u) => [String(u.email ?? '').toLowerCase(), u]),
  )

  for (const [email, fb] of byEmail) {
    const existing = supabaseByEmail.get(email)
    if (!existing) {
      console.warn(`  no Supabase user for ${email} — createdBy/cashierId refs stay unmapped`)
      continue
    }
    uidMap[fb.firebaseUid] = existing.id
    console.log(`  ${email}: ${fb.firebaseUid} → ${existing.id}`)
  }

  writeFileSync(join(dataDir, 'uid_map.json'), JSON.stringify(uidMap, null, 2))
  console.log('Wrote uid_map.json')
}

async function upsertBatch(table, rows) {
  if (!rows.length) return
  const chunk = 200
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk)
    const { error } = await sb.from(table).upsert(slice)
    if (error) console.warn(`  ${table} chunk ${i}:`, error.message)
  }
}

async function main() {
  mkdirSync(dataDir, { recursive: true })
  const uidMap = existsSync(join(dataDir, 'uid_map.json'))
    ? JSON.parse(readFileSync(join(dataDir, 'uid_map.json'), 'utf8'))
    : {}

  await mapExistingUsers(uidMap)

  // Warehouses
  const warehouses = load('warehouses').map((w) => ({
    id: w.id,
    name: w.name,
    code: w.code,
    type: w.type,
    address: w.address ?? null,
    is_active: w.isActive !== false,
    is_default: !!w.isDefault,
    created_at: w.createdAt ?? new Date().toISOString(),
    created_by: remapUid(w.createdBy, uidMap),
  }))
  await upsertBatch('warehouses', warehouses)
  console.log(`warehouses: ${warehouses.length}`)

  // Books
  const books = load('books').map((b) => ({
    id: b.id,
    name: b.name,
    author: b.author ?? null,
    isbn: b.isbn ?? null,
    language: b.language ?? 'Nepali',
    category: b.category ?? 'other',
    publisher: b.publisher ?? null,
    mrp: b.mrp ?? 0,
    cost_price: b.costPrice ?? 0,
    in_stock: b.inStock ?? 0,
    min_stock_alert: b.minStockAlert ?? 5,
    description: b.description ?? null,
    created_at: b.createdAt ?? new Date().toISOString(),
    updated_at: b.updatedAt ?? new Date().toISOString(),
    created_by: remapUid(b.createdBy, uidMap),
    is_deleted: !!b.isDeleted,
    deleted_at: b.deletedAt ?? null,
    deleted_by: remapUid(b.deletedBy, uidMap),
  }))
  await upsertBatch('books', books)
  console.log(`books: ${books.length}`)

  // Inventory
  const inv = load('bookInventory').map((r) => ({
    book_id: r.id ?? r.bookId,
    by_warehouse: r.byWarehouse ?? {},
    total_warehouse_qty: r.totalWarehouseQty ?? 0,
    retail_qty: r.retailQty ?? 0,
    updated_at: r.updatedAt ?? new Date().toISOString(),
  }))
  await upsertBatch('book_inventory', inv)
  console.log(`book_inventory: ${inv.length}`)

  // Boxes
  const boxes = load('boxes').map((b) => ({
    id: b.id,
    barcode: b.barcode,
    book_id: b.bookId,
    book_name: b.bookName,
    warehouse_id: b.warehouseId,
    quantity: b.quantity ?? 0,
    initial_quantity: b.initialQuantity ?? b.quantity ?? 0,
    status: b.status ?? 'sealed',
    shelf_location: b.shelfLocation ?? '',
    shelf_note: b.shelfNote ?? null,
    batch_ref: b.batchRef ?? '',
    notes: b.notes ?? '',
    created_at: b.createdAt ?? new Date().toISOString(),
    created_by: remapUid(b.createdBy, uidMap),
    opened_at: b.openedAt ?? null,
    is_deleted: !!b.isDeleted,
  }))
  await upsertBatch('boxes', boxes)
  console.log(`boxes: ${boxes.length}`)

  // Transfers
  const transfers = load('transfers').map((t) => ({
    id: t.id,
    from_warehouse_id: t.fromWarehouseId,
    to_warehouse_id: t.toWarehouseId,
    status: t.status,
    items: t.items ?? [],
    notes: t.notes ?? null,
    created_by: remapUid(t.createdBy, uidMap),
    created_by_name: t.createdByName ?? null,
    received_by: remapUid(t.receivedBy, uidMap),
    received_by_name: t.receivedByName ?? null,
    created_at: t.createdAt ?? new Date().toISOString(),
    picked_at: t.pickedAt ?? null,
    received_at: t.receivedAt ?? null,
  }))
  await upsertBatch('transfers', transfers)
  console.log(`transfers: ${transfers.length}`)

  // Customers
  const customers = load('customers').map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone ?? c.id,
    email: c.email ?? '',
    total_purchases: c.totalPurchases ?? 0,
    total_spent: c.totalSpent ?? 0,
    created_at: c.createdAt ?? new Date().toISOString(),
    last_purchase_at: c.lastPurchaseAt ?? null,
  }))
  await upsertBatch('customers', customers)
  console.log(`customers: ${customers.length}`)

  // Sales + items
  const sales = load('sales')
  const saleRows = []
  const itemRows = []
  for (const s of sales) {
    saleRows.push({
      id: s.id,
      customer_id: s.customerId ?? null,
      customer_name: s.customerName ?? 'Walk-in',
      customer_phone: s.customerPhone ?? '',
      subtotal_before_discount: s.subtotalBeforeDiscount ?? 0,
      total_item_discounts: s.totalItemDiscounts ?? 0,
      order_discount_percent: s.orderDiscountPercent ?? 0,
      order_discount_amount: s.orderDiscountAmount ?? 0,
      total_discount_amount: s.totalDiscountAmount ?? 0,
      grand_total: s.grandTotal ?? 0,
      payment_method: s.paymentMethod ?? 'cash',
      amount_paid: s.amountPaid ?? 0,
      change_given: s.changeGiven ?? 0,
      notes: s.notes ?? null,
      cashier_id: remapUid(s.cashierId, uidMap),
      cashier_name: s.cashierName ?? null,
      status: s.status ?? 'completed',
      void_reason: s.voidReason ?? null,
      voided_by: remapUid(s.voidedBy, uidMap),
      voided_at: s.voidedAt ?? null,
      return_status: s.returnStatus ?? null,
      returned_items: s.returnedItems ?? null,
      return_reason: s.returnReason ?? null,
      returned_by: remapUid(s.returnedBy, uidMap),
      returned_at: s.returnedAt ?? null,
      return_refund_amount: s.returnRefundAmount ?? null,
      created_at: s.createdAt ?? new Date().toISOString(),
    })
    for (const it of s.items ?? []) {
      itemRows.push({
        sale_id: s.id,
        book_id: it.bookId,
        book_name: it.bookName,
        quantity: it.quantity,
        unit_price: it.unitPrice,
        discount_percent: it.discountPercent ?? 0,
        discount_amount: it.discountAmount ?? 0,
        subtotal: it.subtotal,
      })
    }
  }
  await upsertBatch('sales', saleRows)
  // sale_items have generated ids — delete+insert by sale is safer; upsert without id may duplicate
  if (itemRows.length) {
    for (let i = 0; i < itemRows.length; i += 200) {
      const slice = itemRows.slice(i, i + 200)
      const { error } = await sb.from('sale_items').insert(slice)
      if (error) console.warn('sale_items:', error.message)
    }
  }
  console.log(`sales: ${saleRows.length}, sale_items: ${itemRows.length}`)

  // Discounts
  const discounts = load('discounts').map((d) => ({
    id: d.id,
    name: d.name,
    code: d.code ?? null,
    type: d.type,
    value: d.value,
    scope: d.scope,
    min_purchase_amount: d.minPurchaseAmount ?? null,
    max_discount_amount: d.maxDiscountAmount ?? null,
    is_active: d.isActive !== false,
    created_at: d.createdAt ?? new Date().toISOString(),
    created_by: remapUid(d.createdBy, uidMap),
  }))
  await upsertBatch('discounts', discounts)
  console.log(`discounts: ${discounts.length}`)

  // Movements (sample / all)
  const movements = load('inventoryMovements').map((m) => ({
    id: m.id,
    type: m.type,
    book_id: m.bookId,
    book_name: m.bookName,
    quantity: m.quantity,
    warehouse_id: m.warehouseId ?? null,
    from_warehouse_id: m.fromWarehouseId ?? null,
    to_warehouse_id: m.toWarehouseId ?? null,
    box_id: m.boxId ?? null,
    transfer_id: m.transferId ?? null,
    sale_id: m.saleId ?? null,
    reason: m.reason ?? '',
    performed_by: remapUid(m.performedBy, uidMap),
    performed_by_name: m.performedByName ?? null,
    created_at: m.createdAt ?? new Date().toISOString(),
  }))
  await upsertBatch('inventory_movements', movements)
  console.log(`inventory_movements: ${movements.length}`)

  // Counters
  const counters = load('counters').map((c) => ({
    id: c.id,
    value: c.value ?? 0,
    updated_at: c.updatedAt ?? new Date().toISOString(),
  }))
  await upsertBatch('counters', counters)
  console.log(`counters: ${counters.length}`)

  console.log('\nImport complete. Run verify.mjs next.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
