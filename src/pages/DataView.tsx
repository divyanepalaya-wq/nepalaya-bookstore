import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Database, Boxes, BookOpen, ShoppingCart, Users, BarChart2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { mapBox, mapSale } from '@/lib/mappers'
import { useBooks } from '@/contexts/BooksContext'
import { useWarehouse } from '@/contexts/WarehouseContext'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDateTime, toMillis } from '@/lib/utils'
import { isFullAdmin } from '@/lib/roles'
import type { Box, Sale } from '@/types'
import { Input } from '@/components/ui/Input'
import { PageSpinner } from '@/components/ui/Spinner'
import { Badge } from '@/components/ui/Badge'

type Tab = 'stock' | 'cartons' | 'sales' | 'books'

export default function DataView() {
  const { appUser } = useAuth()
  const { books, loading: booksLoading } = useBooks()
  const { inventoryMap, getRetailStock, getWarehouseStock, primaryWarehouse, bufferWarehouse, inventoryLoading } = useWarehouse()
  const [tab, setTab] = useState<Tab>('stock')
  const [search, setSearch] = useState('')
  const [boxes, setBoxes] = useState<(Box & { id: string })[]>([])
  const [sales, setSales] = useState<(Sale & { id: string })[]>([])
  const [loadingExtra, setLoadingExtra] = useState(true)

  const primaryId = primaryWarehouse?.id ?? 'wh-primary'
  const bufferId = bufferWarehouse?.id ?? 'wh-buffer'
  const admin = isFullAdmin(appUser?.role)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [bRes, sRes] = await Promise.all([
        supabase.from('boxes').select('*').order('created_at', { ascending: false }).limit(500),
        supabase.from('sales').select('*').order('created_at', { ascending: false }).limit(100),
      ])
      if (cancelled) return
      setBoxes(
        (bRes.data ?? [])
          .map((r) => mapBox(r as Record<string, unknown>))
          .filter((b) => !b.isDeleted),
      )
      setSales((sRes.data ?? []).map((r) => mapSale(r as Record<string, unknown>)))
      setLoadingExtra(false)
    }
    void load()
    return () => { cancelled = true }
  }, [])

  const q = search.trim().toLowerCase()

  const stockRows = useMemo(() => {
    return books
      .filter((b) => !q || b.name.toLowerCase().includes(q) || (b.author ?? '').toLowerCase().includes(q))
      .map((b) => ({
        book: b,
        wh: getWarehouseStock(b.id, primaryId),
        br: getWarehouseStock(b.id, bufferId),
        store: getRetailStock(b.id, b.inStock),
      }))
      .sort((a, b) => a.book.name.localeCompare(b.book.name))
  }, [books, q, getWarehouseStock, getRetailStock, primaryId, bufferId])

  const cartonRows = useMemo(() => {
    return boxes
      .filter((b) => !q || b.barcode.toLowerCase().includes(q) || b.bookName.toLowerCase().includes(q))
      .slice(0, 200)
  }, [boxes, q])

  const saleRows = useMemo(() => {
    return sales
      .filter((s) => !q || s.id.toLowerCase().includes(q) || (s.cashierName ?? '').toLowerCase().includes(q))
  }, [sales, q])

  const bookRows = useMemo(() => {
    return books
      .filter((b) => !q || b.name.toLowerCase().includes(q) || (b.isbn ?? '').includes(q))
      .slice(0, 300)
  }, [books, q])

  if (booksLoading || inventoryLoading || loadingExtra) return <PageSpinner />

  const tabs: { id: Tab; label: string; icon: typeof Database }[] = [
    { id: 'stock', label: 'Stock', icon: Database },
    { id: 'cartons', label: 'Cartons', icon: Boxes },
    { id: 'sales', label: 'Sales', icon: ShoppingCart },
    { id: 'books', label: 'Books', icon: BookOpen },
  ]

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Data</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Browse stock, cartons, sales, and books — no heavy analytics
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          {admin && (
            <Link to="/settings/users" className="inline-flex items-center gap-1 text-accent-700 hover:underline">
              <Users className="h-4 w-4" /> Staff
            </Link>
          )}
          <Link to="/reports" className="inline-flex items-center gap-1 text-gray-500 hover:underline">
            <BarChart2 className="h-4 w-4" /> Advanced reports
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-gray-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t.id
                ? 'border-accent-600 text-accent-800'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      <Input
        placeholder="Filter…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        {tab === 'stock' && (
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500 text-left">
              <tr>
                <th className="px-3 py-2">Book</th>
                <th className="px-3 py-2 text-right">Warehouse</th>
                <th className="px-3 py-2 text-right">Backroom</th>
                <th className="px-3 py-2 text-right">Store</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {stockRows.map(({ book, wh, br, store }) => (
                <tr key={book.id}>
                  <td className="px-3 py-2 font-medium text-gray-900">{book.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{wh || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{br || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{store || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'cartons' && (
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500 text-left">
              <tr>
                <th className="px-3 py-2">Barcode</th>
                <th className="px-3 py-2">Book</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Location</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {cartonRows.map((b) => (
                <tr key={b.id}>
                  <td className="px-3 py-2 font-mono text-xs">{b.barcode}</td>
                  <td className="px-3 py-2">{b.bookName}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{b.quantity}</td>
                  <td className="px-3 py-2"><Badge variant={b.status === 'sealed' ? 'green' : 'yellow'}>{b.status}</Badge></td>
                  <td className="px-3 py-2 text-xs text-gray-500">{b.warehouseId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'sales' && (
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500 text-left">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Invoice</th>
                <th className="px-3 py-2">Cashier</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {saleRows.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2 text-xs text-gray-500">{formatDateTime(s.createdAt)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{s.id.slice(0, 8)}</td>
                  <td className="px-3 py-2">{s.cashierName ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(s.grandTotal ?? 0)}</td>
                  <td className="px-3 py-2"><Badge variant={s.status === 'completed' ? 'green' : 'gray'}>{s.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'books' && (
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500 text-left">
              <tr>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Author</th>
                <th className="px-3 py-2">ISBN</th>
                <th className="px-3 py-2 text-right">MRP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {bookRows.map((b) => (
                <tr key={b.id}>
                  <td className="px-3 py-2 font-medium">
                    <Link to={`/books/${b.id}`} className="text-accent-700 hover:underline">{b.name}</Link>
                  </td>
                  <td className="px-3 py-2 text-gray-600">{b.author || '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{b.isbn || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(b.mrp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-gray-400">
        Showing live tables. Inventory map has {Object.keys(inventoryMap).length} SKUs ·
        cartons loaded {boxes.length} · sales {sales.length}
        {sales[0] ? ` · latest ${formatDateTime(sales.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))[0].createdAt)}` : ''}
      </p>
    </div>
  )
}
