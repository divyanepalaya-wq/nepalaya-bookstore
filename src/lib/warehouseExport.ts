/**
 * Warehouse Excel / CSV export helpers for management reports.
 */

import * as XLSX from 'xlsx'
import { downloadCSV } from '@/lib/csvUtils'
import { toMillis } from '@/lib/utils'
import type { Book, Box, Transfer, Warehouse, BookInventory, AppTimestamp } from '@/types'

function stamp(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function toIso(ts: AppTimestamp | null | undefined): string {
  const ms = toMillis(ts)
  return ms ? new Date(ms).toISOString() : ''
}

function downloadXlsx(filename: string, sheets: Record<string, (string | number)[][]>) {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(rows)
    // Auto-ish column widths
    const cols = rows[0]?.map((_, i) => ({
      wch: Math.min(40, Math.max(10, ...rows.map((r) => String(r[i] ?? '').length))),
    }))
    if (cols) ws['!cols'] = cols
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31))
  }
  XLSX.writeFile(wb, filename)
}

export function exportInventoryByLocation(params: {
  books: Book[]
  warehouses: Warehouse[]
  inventoryMap: Record<string, BookInventory>
  getRetailStock: (bookId: string, fallback?: number) => number
  getWarehouseStock: (bookId: string, warehouseId: string) => number
  bookstoreId: string
}) {
  const { books, warehouses, getRetailStock, getWarehouseStock, bookstoreId } = params
  const nonRetail = warehouses.filter((w) => w.id !== bookstoreId)
  const headers = [
    'Book',
    'Author',
    'ISBN',
    'MRP',
    'Bookstore (for sale)',
    ...nonRetail.map((w) => w.name),
    'Warehouse total',
    'Grand total',
    'Min alert',
  ]
  const rows = books.map((b) => {
    const retail = getRetailStock(b.id, b.inStock)
    const whQtys = nonRetail.map((w) => getWarehouseStock(b.id, w.id))
    const whTotal = whQtys.reduce((s, n) => s + n, 0)
    return [
      b.name,
      b.author ?? '',
      b.isbn ?? '',
      b.mrp,
      retail,
      ...whQtys,
      whTotal,
      retail + whTotal,
      b.minStockAlert,
    ]
  })
  downloadXlsx(`inventory-by-location-${stamp()}.xlsx`, {
    Inventory: [headers, ...rows],
  })
}

export function exportBoxesRegister(boxes: (Box & { id: string })[], warehouses: Warehouse[]) {
  const whName = (id: string) => warehouses.find((w) => w.id === id)?.name ?? id
  const headers = [
    'Barcode',
    'Book',
    'Quantity',
    'Initial qty',
    'Status',
    'Warehouse',
    'Shelf',
    'Batch',
    'Created',
  ]
  const rows = boxes.map((b) => [
    b.barcode,
    b.bookName,
    b.quantity,
    b.initialQuantity,
    b.status === 'sealed' ? 'Full' : b.status,
    whName(b.warehouseId),
    b.shelfLocation ?? '',
    b.batchRef ?? '',
    toIso(b.createdAt),
  ])
  downloadXlsx(`boxes-register-${stamp()}.xlsx`, {
    Boxes: [headers, ...rows],
  })
}

export function exportTransfers(transfers: (Transfer & { id: string })[], warehouses: Warehouse[]) {
  const whName = (id: string) => warehouses.find((w) => w.id === id)?.name ?? id
  const headers = [
    'Transfer ID',
    'Status',
    'From',
    'To',
    'Boxes',
    'Created by',
    'Created at',
    'Received at',
    'Notes',
  ]
  const rows = transfers.map((t) => [
    t.id,
    t.status,
    whName(t.fromWarehouseId),
    whName(t.toWarehouseId),
    t.items?.length ?? 0,
    t.createdByName,
    toIso(t.createdAt),
    toIso(t.receivedAt),
    t.notes ?? '',
  ])
  const itemHeaders = ['Transfer ID', 'Barcode', 'Book', 'Qty', 'Shelf']
  const itemRows = transfers.flatMap((t) =>
    (t.items ?? []).map((i) => [
      t.id,
      i.barcode,
      i.bookName,
      i.quantity,
      (i as { shelfLocation?: string }).shelfLocation ?? '',
    ]),
  )
  downloadXlsx(`transfers-${stamp()}.xlsx`, {
    Transfers: [headers, ...rows],
    Items: [itemHeaders, ...itemRows],
  })
}

export function exportReorderList(
  rows: Array<{ name: string; author?: string; isbn?: string; retail: number; sold30d: number; warehouseQty: number; minAlert: number }>,
) {
  const headers = ['Book', 'Author', 'ISBN', 'On sale now', 'Sold (30d)', 'In warehouse', 'Min alert', 'Suggested fill']
  const data = rows.map((r) => [
    r.name,
    r.author ?? '',
    r.isbn ?? '',
    r.retail,
    r.sold30d,
    r.warehouseQty,
    r.minAlert,
    Math.max(0, r.minAlert * 2 - r.retail),
  ])
  downloadXlsx(`reorder-list-${stamp()}.xlsx`, {
    Reorder: [headers, ...data],
  })
}

export function exportWarehouseFullReport(params: {
  books: Book[]
  warehouses: Warehouse[]
  boxes: (Box & { id: string })[]
  transfers: (Transfer & { id: string })[]
  inventoryMap: Record<string, BookInventory>
  getRetailStock: (bookId: string, fallback?: number) => number
  getWarehouseStock: (bookId: string, warehouseId: string) => number
  bookstoreId: string
  reorder: Array<{ name: string; author?: string; isbn?: string; retail: number; sold30d: number; warehouseQty: number; minAlert: number }>
  kpis: Record<string, number | string>
}) {
  const {
    books, warehouses, boxes, transfers, getRetailStock, getWarehouseStock,
    bookstoreId, reorder, kpis,
  } = params

  const kpiSheet = [
    ['Metric', 'Value'],
    ...Object.entries(kpis).map(([k, v]) => [k, v]),
  ]

  const nonRetail = warehouses.filter((w) => w.id !== bookstoreId)
  const invHeaders = [
    'Book', 'Author', 'ISBN', 'Bookstore', ...nonRetail.map((w) => w.code), 'Warehouse total', 'Grand total',
  ]
  const invRows = books.map((b) => {
    const retail = getRetailStock(b.id, b.inStock)
    const whQtys = nonRetail.map((w) => getWarehouseStock(b.id, w.id))
    const whTotal = whQtys.reduce((s, n) => s + n, 0)
    return [b.name, b.author ?? '', b.isbn ?? '', retail, ...whQtys, whTotal, retail + whTotal]
  })

  const whName = (id: string) => warehouses.find((w) => w.id === id)?.name ?? id
  const boxHeaders = ['Barcode', 'Book', 'Qty', 'Status', 'Warehouse', 'Shelf', 'Batch']
  const boxRows = boxes.map((b) => [
    b.barcode, b.bookName, b.quantity, b.status, whName(b.warehouseId), b.shelfLocation ?? '', b.batchRef ?? '',
  ])

  const transferHeaders = ['ID', 'Status', 'From', 'To', 'Boxes', 'Created by', 'Created']
  const transferRows = transfers.map((t) => [
    t.id.slice(-8),
    t.status,
    whName(t.fromWarehouseId),
    whName(t.toWarehouseId),
    t.items?.length ?? 0,
    t.createdByName,
    toIso(t.createdAt),
  ])

  const reorderHeaders = ['Book', 'On sale', 'Sold 30d', 'In warehouse', 'Min alert']
  const reorderRows = reorder.map((r) => [r.name, r.retail, r.sold30d, r.warehouseQty, r.minAlert])

  downloadXlsx(`warehouse-full-report-${stamp()}.xlsx`, {
    Summary: kpiSheet,
    Inventory: [invHeaders, ...invRows],
    Boxes: [boxHeaders, ...boxRows],
    Transfers: [transferHeaders, ...transferRows],
    Reorder: [reorderHeaders, ...reorderRows],
  })
}

/** Quick CSV fallback for movements if needed */
export function exportMovementsCsv(
  rows: Array<(string | number)[]>,
  headers: string[],
) {
  downloadCSV(`inventory-movements-${stamp()}.csv`, headers, rows)
}
