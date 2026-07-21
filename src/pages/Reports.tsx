import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Download, FileSpreadsheet, Package, ShoppingCart, Warehouse, BookOpen,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { mapBox, mapTransfer, mapSale, mapSaleItem } from '@/lib/mappers'
import { useWarehouse } from '@/contexts/WarehouseContext'
import { useBooks } from '@/contexts/BooksContext'
import { formatCurrency, toMillis, cn } from '@/lib/utils'
import { LOCATION_LABELS } from '@/lib/roles'
import {
  exportWarehouseFullReport,
  exportInventoryByLocation,
  exportBoxesRegister,
  exportTransfers,
  exportReorderList,
} from '@/lib/warehouseExport'
import type { Box, Transfer, Sale, SaleItem } from '@/types'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { PageSpinner } from '@/components/ui/Spinner'

type Tab = 'inventory' | 'sales' | 'warehouse' | 'publishing'

const VELOCITY_DAYS = 30

export default function Reports() {
  const { books, loading: booksLoading } = useBooks()
  const {
    warehouses, inventoryMap, getRetailStock, getWarehouseStock,
    bookstoreId, primaryWarehouse, bufferWarehouse,
  } = useWarehouse()
  const [tab, setTab] = useState<Tab>('inventory')
  const [boxes, setBoxes] = useState<(Box & { id: string })[]>([])
  const [transfers, setTransfers] = useState<(Transfer & { id: string })[]>([])
  const [sales, setSales] = useState<(Sale & { id: string })[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data, error } = await supabase
        .from('boxes')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)
      if (cancelled) return
      if (error) { setLoading(false); return }
      setBoxes(
        (data ?? [])
          .map((r) => mapBox(r as Record<string, unknown>))
          .filter((b) => !b.isDeleted),
      )
      setLoading(false)
    }

    void load()
    const channel = supabase
      .channel('reports-boxes-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'boxes' }, () => void load())
      .subscribe()

    return () => {
      cancelled = true
      void supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data, error } = await supabase
        .from('transfers')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)
      if (cancelled || error) return
      setTransfers((data ?? []).map((r) => mapTransfer(r as Record<string, unknown>)))
    }

    void load()
    const channel = supabase
      .channel('reports-transfers-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transfers' }, () => void load())
      .subscribe()

    return () => {
      cancelled = true
      void supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data, error } = await supabase
        .from('sales')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)
      if (cancelled || error) return
      const rows = data as Array<Record<string, unknown>>
      const ids = rows.map((r) => r.id as string)
      let itemsBySale: Record<string, SaleItem[]> = {}
      if (ids.length > 0) {
        const { data: itemRows } = await supabase.from('sale_items').select('*').in('sale_id', ids)
        for (const row of (itemRows ?? []) as Array<Record<string, unknown>>) {
          const saleId = row.sale_id as string
          if (!itemsBySale[saleId]) itemsBySale[saleId] = []
          itemsBySale[saleId].push(mapSaleItem(row))
        }
      }
      setSales(rows.map((r) => mapSale(r, itemsBySale[r.id as string] ?? [])))
    }

    void load()
    return () => { cancelled = true }
  }, [])

  const velocityByBook = useMemo(() => {
    const since = Date.now() - VELOCITY_DAYS * 24 * 60 * 60 * 1000
    const map: Record<string, number> = {}
    sales.forEach((s) => {
      if (s.status !== 'completed') return
      const ms = toMillis(s.createdAt)
      if (ms && ms < since) return
      s.items.forEach((it) => {
        map[it.bookId] = (map[it.bookId] ?? 0) + it.quantity
      })
    })
    return map
  }, [sales])

  const inventoryRows = useMemo(() => {
    return books.map((b) => {
      const store = getRetailStock(b.id, b.inStock)
      const main = primaryWarehouse ? getWarehouseStock(b.id, primaryWarehouse.id) : 0
      const back = bufferWarehouse ? getWarehouseStock(b.id, bufferWarehouse.id) : 0
      const total = store + main + back
      const value = total * (b.costPrice ?? 0)
      return { book: b, store, main, back, total, value }
    }).sort((a, b) => a.book.name.localeCompare(b.book.name))
  }, [books, getRetailStock, getWarehouseStock, primaryWarehouse, bufferWarehouse])

  const salesSummary = useMemo(() => {
    let revenue = 0
    let units = 0
    let count = 0
    sales.forEach((s) => {
      if (s.status !== 'completed') return
      count += 1
      revenue += s.grandTotal ?? 0
      s.items.forEach((it) => { units += it.quantity })
    })
    return { revenue, units, count }
  }, [sales])

  const publishing = useMemo(() => {
    return books.map((b) => {
      const sold = velocityByBook[b.id] ?? 0
      const store = getRetailStock(b.id, b.inStock)
      const warehouseQty = inventoryMap[b.id]?.totalWarehouseQty ?? 0
      const total = store + warehouseQty
      let tag: 'fast' | 'slow' | 'reprint' | 'dead' | 'ok' = 'ok'
      if (sold === 0 && total > 0) tag = 'dead'
      else if (sold >= 10 && store <= b.minStockAlert) tag = 'reprint'
      else if (sold >= 8) tag = 'fast'
      else if (sold > 0 && sold <= 2 && total > 20) tag = 'slow'
      return { book: b, sold, store, warehouseQty, total, tag }
    }).sort((a, b) => b.sold - a.sold)
  }, [books, velocityByBook, getRetailStock, inventoryMap])

  const reorderExportRows = useMemo(
    () =>
      books
        .map((b) => ({
          name: b.name,
          author: b.author,
          isbn: b.isbn,
          retail: getRetailStock(b.id, b.inStock),
          sold30d: velocityByBook[b.id] ?? 0,
          warehouseQty: inventoryMap[b.id]?.totalWarehouseQty ?? 0,
          minAlert: b.minStockAlert,
        }))
        .filter((r) => r.retail <= r.minAlert),
    [books, velocityByBook, getRetailStock, inventoryMap],
  )

  const handleFullExport = () => {
    try {
      exportWarehouseFullReport({
        books,
        warehouses,
        boxes,
        transfers,
        inventoryMap,
        getRetailStock,
        getWarehouseStock,
        bookstoreId,
        reorder: reorderExportRows,
        kpis: {
          Titles: books.length,
          'Cartons': boxes.length,
          'Pending transfers': transfers.filter((t) => t.status !== 'received' && t.status !== 'cancelled').length,
          'Sales (loaded)': salesSummary.count,
        },
      })
      toast.success('Full Excel downloaded')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    }
  }

  if (loading || booksLoading) return <PageSpinner />

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'inventory', label: 'Inventory', icon: <Package className="h-4 w-4" /> },
    { id: 'sales', label: 'Sales', icon: <ShoppingCart className="h-4 w-4" /> },
    { id: 'warehouse', label: 'Warehouse', icon: <Warehouse className="h-4 w-4" /> },
    { id: 'publishing', label: 'Publishing', icon: <BookOpen className="h-4 w-4" /> },
  ]

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-sm text-gray-500 mt-0.5">Inventory, sales, warehouse & publishing signals</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleFullExport}>
          <FileSpreadsheet className="h-4 w-4" /> Full Excel
        </Button>
      </div>

      <div className="flex gap-1 p-1 bg-gray-100 rounded-lg overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold whitespace-nowrap',
              tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500',
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'inventory' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                exportInventoryByLocation({
                  books,
                  warehouses,
                  inventoryMap,
                  getRetailStock,
                  getWarehouseStock,
                  bookstoreId,
                })
                toast.success('Inventory Excel downloaded')
              }}
            >
              <Download className="h-4 w-4" /> Export inventory
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                exportReorderList(reorderExportRows)
                toast.success('Reorder list downloaded')
              }}
            >
              <Download className="h-4 w-4" /> Low-stock list
            </Button>
          </div>
          <div className="grid gap-2 sm:hidden">
            {inventoryRows.filter((r) => r.store <= r.book.minStockAlert).slice(0, 20).map((r) => (
              <div key={r.book.id} className="rounded-xl border border-gray-200 bg-white p-3">
                <p className="font-medium text-sm text-gray-900">{r.book.name}</p>
                <p className="text-xs text-gray-500 mt-1">
                  Store {r.store} · Back {r.back} · Main {r.main} · Value {formatCurrency(r.value)}
                </p>
              </div>
            ))}
          </div>
          <div className="hidden sm:block overflow-hidden rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left">Title</th>
                  <th className="px-3 py-2 text-right">{LOCATION_LABELS.bookstore}</th>
                  <th className="px-3 py-2 text-right">{LOCATION_LABELS.buffer}</th>
                  <th className="px-3 py-2 text-right">{LOCATION_LABELS.primary}</th>
                  <th className="px-3 py-2 text-right">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {inventoryRows.slice(0, 80).map((r) => (
                  <tr key={r.book.id}>
                    <td className="px-3 py-2 font-medium text-gray-900">{r.book.name}</td>
                    <td className={cn('px-3 py-2 text-right tabular-nums', r.store <= r.book.minStockAlert && 'text-amber-600 font-semibold')}>{r.store}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.back}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.main}</td>
                    <td className="px-3 py-2 text-right text-gray-600">{formatCurrency(r.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'sales' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Revenue (loaded)" value={formatCurrency(salesSummary.revenue)} />
            <Stat label="Books sold" value={String(salesSummary.units)} />
            <Stat label="Transactions" value={String(salesSummary.count)} />
          </div>
          <p className="text-xs text-gray-500">
            Showing recent sales (up to 500). Use Full Excel for warehouse-linked exports.
          </p>
          <div className="space-y-2">
            {sales.filter((s) => s.status === 'completed').slice(0, 25).map((s) => (
              <div key={s.id} className="rounded-lg border border-gray-100 bg-white px-3 py-2 flex justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">{s.items?.length ?? 0} line(s)</p>
                  <p className="text-xs text-gray-500">{s.cashierName || '—'}</p>
                </div>
                <p className="text-sm font-semibold tabular-nums">{formatCurrency(s.grandTotal ?? 0)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'warehouse' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                exportBoxesRegister(boxes, warehouses)
                toast.success('Cartons Excel downloaded')
              }}
            >
              <Download className="h-4 w-4" /> Cartons register
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                exportTransfers(transfers, warehouses)
                toast.success('Transfers Excel downloaded')
              }}
            >
              <Download className="h-4 w-4" /> Transfers
            </Button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Cartons" value={String(boxes.length)} />
            <Stat label="Full" value={String(boxes.filter((b) => b.status === 'sealed').length)} />
            <Stat label="Open" value={String(boxes.filter((b) => b.status === 'open').length)} />
            <Stat label="Transfers" value={String(transfers.length)} />
          </div>
          <ul className="space-y-2">
            {transfers.slice(0, 15).map((t) => (
              <li key={t.id} className="rounded-lg border border-gray-100 bg-white px-3 py-2 flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {warehouses.find((w) => w.id === t.fromWarehouseId)?.name ?? 'From'} →{' '}
                    {warehouses.find((w) => w.id === t.toWarehouseId)?.name ?? 'To'}
                  </p>
                  <p className="text-xs text-gray-500">{t.items?.length ?? 0} carton(s)</p>
                </div>
                <Badge variant={t.status === 'received' ? 'green' : t.status === 'cancelled' ? 'red' : 'orange'}>
                  {t.status}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'publishing' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Velocity over last {VELOCITY_DAYS} days vs store/warehouse stock — reprint & dead-stock hints.
          </p>
          <div className="grid gap-2">
            {publishing.slice(0, 40).map((r) => (
              <div key={r.book.id} className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{r.book.name}</p>
                  <p className="text-xs text-gray-500">
                    Sold {r.sold} · Store {r.store} · Upstream {r.warehouseQty}
                  </p>
                </div>
                {r.tag !== 'ok' && (
                  <Badge variant={r.tag === 'fast' || r.tag === 'reprint' ? 'green' : r.tag === 'dead' ? 'red' : 'yellow'}>
                    {r.tag === 'reprint' ? 'Reprint?' : r.tag}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <p className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">{label}</p>
      <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{value}</p>
    </div>
  )
}
