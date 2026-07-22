import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Warehouse, Boxes, PackagePlus, ScanBarcode, ArrowRightLeft,
  Layers, AlertTriangle, PackageCheck, Clock, Truck, ShoppingCart, Gauge,
  Download, FileSpreadsheet,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { mapBox, mapTransfer, mapSale, mapSaleItem } from '@/lib/mappers'
import { useWarehouse } from '@/contexts/WarehouseContext'
import { useBooks } from '@/contexts/BooksContext'
import { formatDateTime, toMillis, cn } from '@/lib/utils'
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
import toast from 'react-hot-toast'

const TRANSFER_BADGE: Record<string, 'gray' | 'blue' | 'orange' | 'green' | 'red'> = {
  draft: 'gray',
  picked: 'blue',
  in_transit: 'orange',
  received: 'green',
  cancelled: 'red',
}

/** Window (days) for sales velocity calculation */
const VELOCITY_DAYS = 30

export default function WarehouseDashboard() {
  const navigate = useNavigate()
  const {
    warehouses, inventoryMap, mode, activeWarehouse, bookstoreId,
    getRetailStock, getWarehouseStock,
  } = useWarehouse()
  const { books, loading: booksLoading } = useBooks()
  const [boxes, setBoxes] = useState<(Box & { id: string })[]>([])
  const [transfers, setTransfers] = useState<(Transfer & { id: string })[]>([])
  const [sales, setSales] = useState<(Sale & { id: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [exportOpen, setExportOpen] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data, error } = await supabase
        .from('boxes')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200)
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
      .channel('warehouse-dashboard-boxes-rt')
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
        .limit(20)
      if (cancelled || error) return
      setTransfers((data ?? []).map((r) => mapTransfer(r as Record<string, unknown>)))
    }

    void load()
    const channel = supabase
      .channel('warehouse-dashboard-transfers-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transfers' }, () => void load())
      .subscribe()

    return () => {
      cancelled = true
      void supabase.removeChannel(channel)
    }
  }, [])

  // Sales velocity only needs the last VELOCITY_DAYS — filter server-side instead
  // of pulling an arbitrary "last 400" window.
  useEffect(() => {
    let cancelled = false

    async function load() {
      const sinceIso = new Date(Date.now() - VELOCITY_DAYS * 24 * 60 * 60 * 1000).toISOString()
      const { data, error } = await supabase
        .from('sales')
        .select('*')
        .eq('status', 'completed')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(1000)
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

  const stats = useMemo(() => {
    const warehouseBoxes = mode === 'bookstore'
      ? boxes
      : boxes.filter((b) => b.warehouseId === activeWarehouse?.id)
    const totalBoxes = warehouseBoxes.length
    const sealed = warehouseBoxes.filter((b) => b.status === 'sealed').length
    const open = warehouseBoxes.filter((b) => b.status === 'open').length
    const empty = warehouseBoxes.filter((b) => b.status === 'empty').length
    const inTransit = warehouseBoxes.filter((b) => b.status === 'in_transit').length
    const totalUnits = warehouseBoxes.reduce((s, b) => s + b.quantity, 0)

    let totalWarehouseQty = 0
    let totalRetailQty = 0
    books.forEach((b) => {
      totalRetailQty += getRetailStock(b.id, b.inStock)
      totalWarehouseQty += inventoryMap[b.id]?.totalWarehouseQty ?? 0
    })

    const pendingTransfers = transfers.filter(
      (t) => t.status === 'draft' || t.status === 'picked' || t.status === 'in_transit',
    ).length

    const lowRetail = books.filter(
      (b) => getRetailStock(b.id, b.inStock) <= b.minStockAlert,
    ).length

    // Box utilization: average fill ratio across non-empty boxes
    const nonEmpty = warehouseBoxes.filter((b) => b.status !== 'empty' && b.initialQuantity > 0)
    const totalInitial = nonEmpty.reduce((s, b) => s + b.initialQuantity, 0)
    const fillRatio = totalInitial > 0
      ? Math.round((nonEmpty.reduce((s, b) => s + b.quantity, 0) / totalInitial) * 100)
      : 0
    const underHalf = nonEmpty.filter((b) => b.quantity < b.initialQuantity * 0.5).length

    return {
      totalBoxes, sealed, open, empty, inTransit, totalUnits,
      totalWarehouseQty, totalRetailQty, pendingTransfers, lowRetail,
      fillRatio, underHalf,
    }
  }, [boxes, transfers, books, inventoryMap, mode, activeWarehouse, getRetailStock])

  // Sales velocity (units sold per book in the last VELOCITY_DAYS)
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

  // Reorder suggestions: low retail stock AND actively selling
  const reorderSuggestions = useMemo(() => {
    return books
      .map((b) => {
        const retail = getRetailStock(b.id, b.inStock)
        const sold = velocityByBook[b.id] ?? 0
        const warehouseQty = inventoryMap[b.id]?.totalWarehouseQty ?? 0
        return { book: b, retail, sold, warehouseQty }
      })
      .filter((r) => r.retail <= r.book.minStockAlert && r.sold > 0)
      .sort((a, b) => b.sold - a.sold)
      .slice(0, 8)
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
          'Total boxes': stats.totalBoxes,
          'Units in boxes': stats.totalUnits,
          'Warehouse stock': stats.totalWarehouseQty,
          'Bookstore (for sale)': stats.totalRetailQty,
          'Pending transfers': stats.pendingTransfers,
          'Low retail titles': stats.lowRetail,
          'Box fill %': stats.fillRatio,
          'Boxes under half': stats.underHalf,
        },
      })
      toast.success('Excel downloaded')
      setExportOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    }
  }

  const recentBoxes = useMemo(
    () => boxes.filter((b) => b.status !== 'empty').slice(0, 5),
    [boxes],
  )

  const recentTransfers = useMemo(
    () => transfers.slice(0, 5),
    [transfers],
  )

  /** Smart next-actions for a tiny team */
  const nextActions = useMemo(() => {
    const actions: Array<{ title: string; why: string; path: string; tone: string }> = []
    const pending = transfers.filter((t) => t.status === 'draft' || t.status === 'in_transit' || t.status === 'picked')
    const lowRetail = books.filter((b) => getRetailStock(b.id, b.inStock) <= b.minStockAlert)
    const bufferBoxes = boxes.filter(
      (b) => b.warehouseId !== bookstoreId && b.status !== 'empty' && b.status !== 'in_transit' && b.quantity > 0,
    )
    const unlabeledShelf = boxes.filter(
      (b) => b.status !== 'empty' && !b.shelfLocation && b.warehouseId === activeWarehouse?.id,
    ).length

    if (pending.length > 0) {
      actions.push({
        title: `Finish ${pending.length} open transfer${pending.length > 1 ? 's' : ''}`,
        why: 'Cartons are waiting to be picked or received.',
        path: '/transfers',
        tone: 'border-orange-200 bg-orange-50 text-orange-900',
      })
    }
    if (mode === 'full_warehouse' && stats.totalBoxes === 0) {
      actions.push({
        title: 'Receive your first cartons',
        why: 'Box books, print labels, place them in the big warehouse.',
        path: '/receive',
        tone: 'border-blue-200 bg-blue-50 text-blue-900',
      })
    }
    if (mode === 'small_warehouse' || mode === 'full_warehouse') {
      if (lowRetail.length > 0 && bufferBoxes.length > 0) {
        actions.push({
          title: `${lowRetail.length} title${lowRetail.length > 1 ? 's' : ''} low on the store shelf`,
          why: 'Scan a backroom carton and tap “Put on sale”.',
          path: '/scan',
          tone: 'border-red-200 bg-red-50 text-red-900',
        })
      }
    }
    if (unlabeledShelf > 0 && mode === 'full_warehouse') {
      actions.push({
        title: `${unlabeledShelf} carton${unlabeledShelf > 1 ? 's' : ''} without a shelf spot`,
        why: 'Scan them and set aisle–rack–bin so picking is faster.',
        path: '/scan',
        tone: 'border-amber-200 bg-amber-50 text-amber-900',
      })
    }
    if (actions.length === 0) {
      actions.push({
        title: mode === 'full_warehouse' ? 'Receive stock or move boxes to backroom' : 'Scan a carton or put books on sale',
        why: 'Everything looks calm — keep the pipeline flowing.',
        path: mode === 'full_warehouse' ? '/receive' : '/scan',
        tone: 'border-green-200 bg-green-50 text-green-900',
      })
    }
    return actions.slice(0, 3)
  }, [transfers, books, boxes, bookstoreId, mode, activeWarehouse, getRetailStock, stats.totalBoxes])

  const whName = (id: string) => warehouses.find((w) => w.id === id)?.name ?? id

  if (loading || booksLoading) return <PageSpinner />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Warehouse className="h-6 w-6 text-accent-600" />
            Warehouse Home
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {mode === 'bookstore' ? 'All locations' : activeWarehouse?.name ?? 'Warehouse'} — quick actions & reports
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" onClick={() => navigate('/receive')}>
            <PackagePlus className="h-4 w-4" /> Receive
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate('/scan')}>
            <ScanBarcode className="h-4 w-4" /> Scan
          </Button>
          {mode !== 'bookstore' && (
            <Button size="sm" variant="outline" onClick={() => navigate('/transfers')}>
              <ArrowRightLeft className="h-4 w-4" /> Move
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setExportOpen((v) => !v)}>
            <Download className="h-4 w-4" /> Excel
          </Button>
        </div>
      </div>

      {/* Visual stock journey */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm overflow-hidden">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Book journey</p>
        <div className="flex flex-wrap items-stretch justify-between gap-2">
          {[
            {
              label: '1. Big warehouse',
              sub: 'Receive & label cartons',
              path: '/receive',
              active: mode === 'full_warehouse',
              color: 'from-blue-500 to-blue-600',
              ring: mode === 'full_warehouse' ? 'ring-2 ring-blue-400' : '',
            },
            {
              label: '2. Backroom',
              sub: 'Hold near the shop',
              path: '/transfers',
              active: mode === 'small_warehouse',
              color: 'from-orange-500 to-orange-600',
              ring: mode === 'small_warehouse' ? 'ring-2 ring-orange-400' : '',
            },
            {
              label: '3. Store shelf',
              sub: 'Put on sale',
              path: '/scan',
              active: false,
              color: 'from-emerald-500 to-emerald-600',
              ring: '',
            },
            {
              label: '4. Sell',
              sub: 'POS till',
              path: '/pos',
              active: mode === 'bookstore',
              color: 'from-brand-500 to-brand-600',
              ring: mode === 'bookstore' ? 'ring-2 ring-brand-400' : '',
            },
          ].map((step, i) => (
            <button
              key={step.label}
              type="button"
              onClick={() => navigate(step.path)}
              className={cn(
                'relative flex-1 min-w-[140px] rounded-xl p-3 text-left text-white bg-gradient-to-br shadow-sm transition hover:scale-[1.02]',
                step.color,
                step.ring,
              )}
            >
              {i < 3 && (
                <span className="hidden sm:block absolute -right-2 top-1/2 -translate-y-1/2 z-10 text-white/80 text-lg">→</span>
              )}
              <p className="text-sm font-bold">{step.label}</p>
              <p className="text-[11px] text-white/85 mt-0.5">{step.sub}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Recommended next steps */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Suggested next</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {nextActions.map((a) => (
            <button
              key={a.title}
              type="button"
              onClick={() => navigate(a.path)}
              className={cn(
                'rounded-xl border p-3 text-left transition hover:shadow-sm',
                a.tone,
              )}
            >
              <p className="text-sm font-semibold leading-snug">{a.title}</p>
              <p className="text-xs opacity-80 mt-1">{a.why}</p>
            </button>
          ))}
        </div>
      </div>

      {exportOpen && (
        <div className="bg-white border border-accent-200 rounded-xl p-4 shadow-sm space-y-3">
          <p className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-accent-600" />
            Download reports (Excel)
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              variant="outline"
              className="justify-start"
              onClick={handleFullExport}
            >
              Full warehouse report
            </Button>
            <Button
              variant="outline"
              className="justify-start"
              onClick={() => {
                exportInventoryByLocation({
                  books, warehouses, inventoryMap, getRetailStock, getWarehouseStock, bookstoreId,
                })
                toast.success('Inventory Excel downloaded')
              }}
            >
              Stock by location
            </Button>
            <Button
              variant="outline"
              className="justify-start"
              onClick={() => {
                exportBoxesRegister(boxes, warehouses)
                toast.success('Boxes Excel downloaded')
              }}
            >
              All boxes register
            </Button>
            <Button
              variant="outline"
              className="justify-start"
              onClick={() => {
                exportTransfers(transfers, warehouses)
                toast.success('Transfers Excel downloaded')
              }}
            >
              Transfers history
            </Button>
            <Button
              variant="outline"
              className="justify-start"
              onClick={() => {
                exportReorderList(reorderExportRows)
                toast.success('Reorder list downloaded')
              }}
            >
              Low-stock / reorder list
            </Button>
          </div>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Boxes className="h-4 w-4" />
            Total boxes
          </div>
          <p className="text-2xl font-bold text-gray-900 mt-1">{stats.totalBoxes}</p>
          <p className="text-xs text-gray-400 mt-0.5">{stats.totalUnits} units stored</p>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Layers className="h-4 w-4" />
            Warehouse stock
          </div>
          <p className="text-2xl font-bold text-blue-600 mt-1">{stats.totalWarehouseQty}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Retail: {stats.totalRetailQty} · Total: {stats.totalWarehouseQty + stats.totalRetailQty}
          </p>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Truck className="h-4 w-4" />
            Pending transfers
          </div>
          <p className={cn('text-2xl font-bold mt-1', stats.pendingTransfers > 0 ? 'text-orange-600' : 'text-gray-400')}>
            {stats.pendingTransfers}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">Draft / in transit</p>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <AlertTriangle className="h-4 w-4" />
            Low retail stock
          </div>
          <p className={cn('text-2xl font-bold mt-1', stats.lowRetail > 0 ? 'text-red-600' : 'text-gray-400')}>
            {stats.lowRetail}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">Books below alert threshold</p>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <ShoppingCart className="h-4 w-4" />
            Reorder alerts
          </div>
          <p className={cn('text-2xl font-bold mt-1', reorderSuggestions.length > 0 ? 'text-red-600' : 'text-gray-400')}>
            {reorderSuggestions.length}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">Low + selling (30d)</p>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Gauge className="h-4 w-4" />
            Box utilization
          </div>
          <p className="text-2xl font-bold text-accent-600 mt-1">{stats.fillRatio}%</p>
          <p className="text-xs text-gray-400 mt-0.5">{stats.underHalf} boxes under half-full</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Box status breakdown */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <PackageCheck className="h-4 w-4 text-accent-600" />
            Box status breakdown
          </h2>
          <div className="space-y-3">
            {[
              { key: 'sealed', label: 'Sealed', color: 'bg-green-500', value: stats.sealed },
              { key: 'open', label: 'Open', color: 'bg-yellow-500', value: stats.open },
              { key: 'inTransit', label: 'In transit', color: 'bg-orange-500', value: stats.inTransit },
              { key: 'empty', label: 'Empty', color: 'bg-gray-400', value: stats.empty },
            ].map((s) => {
              const total = stats.totalBoxes || 1
              const pct = Math.round((s.value / total) * 100)
              return (
                <div key={s.key}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-gray-700">{s.label}</span>
                    <span className="text-gray-500">{s.value} ({pct}%)</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all', s.color)}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Recent boxes */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <Clock className="h-4 w-4 text-accent-600" />
            Recent boxes
          </h2>
          {recentBoxes.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No boxes yet</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {recentBoxes.map((box) => (
                <li key={box.id} className="flex items-center justify-between py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{box.bookName}</p>
                    <p className="text-xs text-gray-400 font-mono">{box.barcode}</p>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <Badge
                      variant={
                        box.status === 'sealed' ? 'green'
                        : box.status === 'open' ? 'yellow'
                        : box.status === 'in_transit' ? 'orange'
                        : 'gray'
                      }
                    >
                      {box.status}
                    </Badge>
                    <p className="text-xs text-gray-500 mt-0.5">×{box.quantity}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Reorder suggestions */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
          <ShoppingCart className="h-4 w-4 text-accent-600" />
          Reorder suggestions
          <span className="text-xs font-normal text-gray-400 ml-1">
            (low retail stock + sold in last {VELOCITY_DAYS} days)
          </span>
        </h2>
        {reorderSuggestions.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No titles need reordering right now</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {reorderSuggestions.map(({ book, retail, sold }) => (
              <li key={book.id} className="flex items-center justify-between py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{book.name}</p>
                  <p className="text-xs text-gray-400">
                    Retail: <span className="text-red-600 font-mono">{retail}</span> · alert {book.minStockAlert}
                  </p>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <p className="text-sm font-semibold text-gray-900">{sold}</p>
                  <p className="text-xs text-gray-400">sold / {VELOCITY_DAYS}d</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Recent transfers */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
          <ArrowRightLeft className="h-4 w-4 text-accent-600" />
          Recent transfers
        </h2>
        {recentTransfers.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No transfers yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-gray-400">
                <tr>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2 pr-3">From</th>
                  <th className="pb-2 pr-3">To</th>
                  <th className="pb-2 pr-3">Boxes</th>
                  <th className="pb-2 pr-3">By</th>
                  <th className="pb-2">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {recentTransfers.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="py-2 pr-3">
                      <Badge variant={TRANSFER_BADGE[t.status]}>{t.status}</Badge>
                    </td>
                    <td className="py-2 pr-3 text-gray-600">{whName(t.fromWarehouseId)}</td>
                    <td className="py-2 pr-3 text-gray-600">{whName(t.toWarehouseId)}</td>
                    <td className="py-2 pr-3 font-medium">{t.items?.length ?? 0}</td>
                    <td className="py-2 pr-3 text-gray-500 text-xs">{t.createdByName}</td>
                    <td className="py-2 text-gray-400 text-xs whitespace-nowrap">{formatDateTime(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
