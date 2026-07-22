import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  PackagePlus, ScanBarcode, ArrowRightLeft, AlertTriangle,
  Clock, ShoppingCart, Boxes, BookOpen, ChevronRight,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { mapBox, mapTransfer, mapSale, mapSaleItem } from '@/lib/mappers'
import { useWarehouse } from '@/contexts/WarehouseContext'
import { useBooks } from '@/contexts/BooksContext'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDateTime, toMillis, cn } from '@/lib/utils'
import { canWarehouse, cartonStatusLabel } from '@/lib/roles'
import type { Box, Transfer, Sale, SaleItem } from '@/types'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { PageSpinner } from '@/components/ui/Spinner'

const VELOCITY_DAYS = 30

export default function OpsDashboard() {
  const navigate = useNavigate()
  const { appUser } = useAuth()
  const {
    inventoryMap, getRetailStock, bookstoreId,
    primaryWarehouse, bufferWarehouse,
  } = useWarehouse()
  const primaryId = primaryWarehouse?.id ?? ''
  const bufferId = bufferWarehouse?.id ?? ''
  const { books, loading: booksLoading } = useBooks()
  const [boxes, setBoxes] = useState<(Box & { id: string })[]>([])
  const [transfers, setTransfers] = useState<(Transfer & { id: string })[]>([])
  const [sales, setSales] = useState<(Sale & { id: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [boxesError, setBoxesError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const wh = canWarehouse(appUser?.role)
  const isCashier = appUser?.role === 'cashier'

  useEffect(() => {
    let cancelled = false

    async function load() {
      setBoxesError(false)
      const { data, error } = await supabase
        .from('boxes')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200)
      if (cancelled) return
      if (error) {
        setBoxesError(true)
        setLoading(false)
        return
      }
      setBoxes(
        (data ?? [])
          .map((r) => mapBox(r as Record<string, unknown>))
          .filter((b) => !b.isDeleted),
      )
      setLoading(false)
    }

    void load()
    const channel = supabase
      .channel('ops-dashboard-boxes-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'boxes' }, () => void load())
      .subscribe()

    return () => {
      cancelled = true
      void supabase.removeChannel(channel)
    }
  }, [reloadKey])

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data, error } = await supabase
        .from('transfers')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30)
      if (cancelled) return
      if (error) return
      setTransfers((data ?? []).map((r) => mapTransfer(r as Record<string, unknown>)))
    }

    void load()
    const channel = supabase
      .channel('ops-dashboard-transfers-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transfers' }, () => void load())
      .subscribe()

    return () => {
      cancelled = true
      void supabase.removeChannel(channel)
    }
  }, [reloadKey])

  // Only need the last VELOCITY_DAYS of completed sales — filter server-side.
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

  const todaySales = useMemo(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const startMs = start.getTime()
    let revenue = 0
    let units = 0
    let count = 0
    sales.forEach((s) => {
      if (s.status !== 'completed') return
      const ms = toMillis(s.createdAt)
      if (!ms || ms < startMs) return
      count += 1
      revenue += s.grandTotal ?? 0
      s.items.forEach((it) => { units += it.quantity })
    })
    return { revenue, units, count }
  }, [sales])

  const pendingTransfers = useMemo(
    () => transfers.filter((t) => t.status === 'draft' || t.status === 'picked' || t.status === 'in_transit'),
    [transfers],
  )

  const stuckDrafts = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    return transfers.filter((t) => {
      if (t.status !== 'draft') return false
      const ms = toMillis(t.createdAt)
      return ms > 0 && ms < cutoff
    })
  }, [transfers])

  const openCartons = useMemo(() => boxes.filter((b) => b.status === 'open').length, [boxes])
  const fullCartons = useMemo(() => boxes.filter((b) => b.status === 'sealed').length, [boxes])

  const lowStore = useMemo(
    () =>
      books
        .map((b) => ({ book: b, retail: getRetailStock(b.id, b.inStock) }))
        .filter((r) => r.retail <= r.book.minStockAlert)
        .sort((a, b) => a.retail - b.retail)
        .slice(0, 8),
    [books, getRetailStock],
  )

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

  const suggestions = useMemo(() => {
    const items: { title: string; body: string; to: string; priority: number }[] = []
    if (wh && pendingTransfers.length > 0) {
      items.push({
        title: 'Finish pending transfers',
        body: `${pendingTransfers.length} transfer(s) waiting`,
        to: '/warehouse/transfers',
        priority: 1,
      })
    }
    if (wh && stuckDrafts.length > 0) {
      items.push({
        title: 'Stuck draft transfers',
        body: `${stuckDrafts.length} draft(s) older than 24 hours — send or cancel`,
        to: '/warehouse/transfers',
        priority: 0,
      })
    }
    if (wh && lowStore.length > 0) {
      const withBackstock = lowStore.filter(
        (r) => (inventoryMap[r.book.id]?.totalWarehouseQty ?? 0) > 0,
      )
      if (withBackstock.length > 0) {
        items.push({
          title: 'Put books on sale',
          body: `${withBackstock.length} low on the floor but stock exists upstream`,
          to: '/warehouse/scan',
          priority: 2,
        })
      }
    }
    if (wh && openCartons > 5) {
      items.push({
        title: 'Review open cartons',
        body: `${openCartons} open cartons — put away or finish putting on sale`,
        to: '/warehouse/cartons',
        priority: 3,
      })
    }
    if (isCashier || !wh) {
      items.push({
        title: 'Open Store POS',
        body: 'Sell from Bookstore Floor stock',
        to: '/pos',
        priority: 1,
      })
    }
    if (wh) {
      items.push({
        title: 'Receive a print run',
        body: 'Create Full cartons + Open remainder at Main Warehouse',
        to: '/warehouse/receive',
        priority: 4,
      })
    }
    return items.sort((a, b) => a.priority - b.priority).slice(0, 4)
  }, [wh, isCashier, pendingTransfers, stuckDrafts, lowStore, openCartons, inventoryMap])

  const recentReceipts = useMemo(() => boxes.slice(0, 6), [boxes])

  if (loading || booksLoading) return <PageSpinner />

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {boxesError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-sm text-amber-800">Some dashboard data failed to load.</p>
          <Button size="sm" variant="outline" onClick={() => { setLoading(true); setReloadKey((k) => k + 1) }}>Retry</Button>
        </div>
      )}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">What needs attention today</p>
      </div>

      {/* Attention cards */}
      <div className={cn('grid gap-3', isCashier ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5')}>
        <Card
          label="Today’s sales"
          value={formatCurrency(todaySales.revenue)}
          sub={`${todaySales.units} books · ${todaySales.count} sales`}
          onClick={() => navigate(wh ? '/reports' : '/pos')}
          icon={<ShoppingCart className="h-4 w-4" />}
        />
        {!isCashier && (
          <Card
            label="Pending transfers"
            value={String(pendingTransfers.length)}
            sub="Need pick or receive"
            alert={pendingTransfers.length > 0}
            onClick={() => navigate('/warehouse/transfers')}
            icon={<ArrowRightLeft className="h-4 w-4" />}
          />
        )}
        <Card
          label="Low on store floor"
          value={String(lowStore.length)}
          sub="At or below alert"
          alert={lowStore.length > 0}
          onClick={() => navigate('/books')}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
        {wh && (
          <>
            <Card
              label="Open cartons"
              value={String(openCartons)}
              sub={`${fullCartons} full`}
              onClick={() => navigate('/warehouse/cartons')}
              icon={<Boxes className="h-4 w-4" />}
            />
            <Card
              label="Titles in catalog"
              value={String(books.length)}
              sub="Books"
              onClick={() => navigate('/books')}
              icon={<BookOpen className="h-4 w-4" />}
            />
          </>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Suggested next */}
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Suggested next</h2>
          <ul className="space-y-2">
            {suggestions.map((s) => (
              <li key={s.title}>
                <button
                  type="button"
                  onClick={() => navigate(s.to)}
                  className="flex w-full items-start gap-3 rounded-lg border border-gray-100 px-3 py-2.5 text-left hover:bg-accent-50 hover:border-accent-100 transition-colors"
                >
                  <ChevronRight className="h-4 w-4 text-accent-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{s.title}</p>
                    <p className="text-xs text-gray-500">{s.body}</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {wh && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => navigate('/warehouse/receive')}>
                <PackagePlus className="h-4 w-4" /> Receive
              </Button>
              <Button size="sm" variant="outline" onClick={() => navigate('/warehouse/scan')}>
                <ScanBarcode className="h-4 w-4" /> Scan
              </Button>
              <Button size="sm" variant="outline" onClick={() => navigate('/pos')}>
                <ShoppingCart className="h-4 w-4" /> POS
              </Button>
            </div>
          )}
          {isCashier && (
            <div className="mt-4">
              <Button onClick={() => navigate('/pos')}>
                <ShoppingCart className="h-4 w-4" /> Open POS
              </Button>
            </div>
          )}
        </section>

        {/* Low stock + recent */}
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-900">Books running low (store)</h2>
            <button type="button" className="text-xs text-accent-600 font-medium" onClick={() => navigate('/books')}>
              All books
            </button>
          </div>
          {lowStore.length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">Store floor looks healthy</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {lowStore.map(({ book, retail }) => {
                const upstream =
                  (inventoryMap[book.id]?.byWarehouse?.[primaryId] ?? 0) +
                  (inventoryMap[book.id]?.byWarehouse?.[bufferId] ?? 0)
                return (
                  <li key={book.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/books/${book.id}`)}
                      className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-gray-50 px-1 rounded"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">{book.name}</p>
                        <p className="text-xs text-gray-500">
                          Store {retail}
                          {upstream > 0 && ` · Upstream ${upstream}`}
                          {(velocityByBook[book.id] ?? 0) > 0 && ` · Sold ${velocityByBook[book.id]} / ${VELOCITY_DAYS}d`}
                        </p>
                      </div>
                      <Badge variant={retail === 0 ? 'red' : 'yellow'}>{retail}</Badge>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      {wh && (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <Clock className="h-4 w-4 text-gray-400" /> Recent cartons
            </h2>
            <button type="button" className="text-xs text-accent-600 font-medium" onClick={() => navigate('/warehouse/cartons')}>
              All cartons
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {recentReceipts.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => navigate(`/warehouse/scan?box=${encodeURIComponent(b.barcode)}`)}
                className="rounded-lg border border-gray-100 px-3 py-2.5 text-left hover:border-accent-200 hover:bg-accent-50/40"
              >
                <p className="text-xs font-mono text-gray-500">{b.barcode}</p>
                <p className="text-sm font-medium text-gray-900 truncate">{b.bookName}</p>
                <div className="mt-1 flex items-center gap-2">
                  <Badge variant={b.status === 'sealed' ? 'green' : b.status === 'open' ? 'yellow' : 'gray'}>
                    {cartonStatusLabel(b.status)}
                  </Badge>
                  <span className="text-xs text-gray-500">{b.quantity} copies</span>
                </div>
                <p className="text-[10px] text-gray-400 mt-1">{formatDateTime(b.createdAt)}</p>
              </button>
            ))}
          </div>
          {bookstoreId && (
            <p className="mt-3 text-[11px] text-gray-400">
              Flow: Printer → Main Warehouse → Backroom → Bookstore Floor → Customer
            </p>
          )}
        </section>
      )}
    </div>
  )
}

function Card({
  label, value, sub, onClick, alert, icon,
}: {
  label: string
  value: string
  sub?: string
  onClick?: () => void
  alert?: boolean
  icon?: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-xl border bg-white p-4 text-left transition-colors hover:border-accent-200',
        alert ? 'border-amber-200 bg-amber-50/40' : 'border-gray-200',
      )}
    >
      <div className="flex items-center gap-1.5 text-gray-500 mb-1">
        {icon}
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-xl font-bold text-gray-900 tabular-nums">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </button>
  )
}
