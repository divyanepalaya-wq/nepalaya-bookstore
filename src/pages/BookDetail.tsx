import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, PackagePlus, ArrowRightLeft, Store, ScanBarcode, Pencil,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { mapBox, mapMovement } from '@/lib/mappers'
import { useBooks } from '@/contexts/BooksContext'
import { useWarehouse } from '@/contexts/WarehouseContext'
import { useAuth } from '@/contexts/AuthContext'
import { canWarehouse, cartonStatusLabel, cartonStatusBadge, LOCATION_LABELS } from '@/lib/roles'
import { formatCurrency, formatDateTime, toMillis } from '@/lib/utils'
import type { Box, InventoryMovement } from '@/types'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { PageSpinner } from '@/components/ui/Spinner'

export default function BookDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { appUser } = useAuth()
  const { books, loading: booksLoading } = useBooks()
  const {
    getRetailStock, getWarehouseStock,
    primaryWarehouse, bufferWarehouse, bookstoreWarehouse,
  } = useWarehouse()
  const [boxes, setBoxes] = useState<(Box & { id: string })[]>([])
  const [movements, setMovements] = useState<(InventoryMovement & { id: string })[]>([])

  const wh = canWarehouse(appUser?.role)
  const book = books.find((b) => b.id === id)

  useEffect(() => {
    if (!id) return
    const bookId = id
    let cancelled = false

    async function load() {
      const { data, error } = await supabase.from('boxes').select('*').eq('book_id', bookId)
      if (cancelled || error) return
      setBoxes(
        (data ?? [])
          .map((r) => mapBox(r as Record<string, unknown>))
          .filter((b) => !b.isDeleted)
          .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)),
      )
    }

    void load()
    const channel = supabase
      .channel(`book-boxes-${bookId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'boxes', filter: `book_id=eq.${bookId}` }, () => void load())
      .subscribe()

    return () => {
      cancelled = true
      void supabase.removeChannel(channel)
    }
  }, [id])

  useEffect(() => {
    if (!id) return
    const bookId = id
    let cancelled = false

    async function load() {
      const { data, error } = await supabase
        .from('inventory_movements')
        .select('*')
        .eq('book_id', bookId)
        .order('created_at', { ascending: false })
        .limit(25)
      if (cancelled || error) return
      setMovements((data ?? []).map((r) => mapMovement(r as Record<string, unknown>)))
    }

    void load()
    return () => { cancelled = true }
  }, [id])

  const stock = useMemo(() => {
    if (!book) return { main: 0, back: 0, store: 0, total: 0 }
    const main = primaryWarehouse ? getWarehouseStock(book.id, primaryWarehouse.id) : 0
    const back = bufferWarehouse ? getWarehouseStock(book.id, bufferWarehouse.id) : 0
    const store = getRetailStock(book.id, book.inStock)
    return { main, back, store, total: main + back + store }
  }, [book, primaryWarehouse, bufferWarehouse, getWarehouseStock, getRetailStock])

  const cartonCounts = useMemo(() => {
    const full = boxes.filter((b) => b.status === 'sealed').length
    const open = boxes.filter((b) => b.status === 'open').length
    const empty = boxes.filter((b) => b.status === 'empty').length
    return { full, open, empty }
  }, [boxes])

  if (booksLoading) return <PageSpinner />
  if (!book) {
    return (
      <div className="max-w-3xl mx-auto py-16 text-center space-y-3">
        <p className="text-gray-600">Book not found</p>
        <Button variant="outline" onClick={() => navigate('/books')}>Back to Books</Button>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <button
          type="button"
          onClick={() => navigate('/books')}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-3"
        >
          <ArrowLeft className="h-4 w-4" /> Books
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{book.name}</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {book.author || 'Unknown author'}
              {book.isbn ? ` · ISBN ${book.isbn}` : ''}
              {book.language ? ` · ${book.language}` : ''}
              {book.category ? ` · ${book.category}` : ''}
            </p>
            <p className="text-sm text-gray-600 mt-2">
              Cost {formatCurrency(book.costPrice ?? 0)} · MRP {formatCurrency(book.mrp)}
            </p>
          </div>
          {wh && (
            <Button variant="outline" size="sm" onClick={() => navigate('/books/manage')}>
              <Pencil className="h-4 w-4" /> Edit in catalog
            </Button>
          )}
        </div>
      </div>

      {/* Inventory strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: LOCATION_LABELS.primary, value: stock.main },
          { label: LOCATION_LABELS.buffer, value: stock.back },
          { label: LOCATION_LABELS.bookstore, value: stock.store, alert: stock.store <= book.minStockAlert },
          { label: 'Total', value: stock.total },
        ].map((c) => (
          <div
            key={c.label}
            className={`rounded-xl border p-3 ${c.alert ? 'border-amber-200 bg-amber-50/50' : 'border-gray-200 bg-white'}`}
          >
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{c.label}</p>
            <p className="text-2xl font-bold text-gray-900 tabular-nums mt-1">{c.value}</p>
          </div>
        ))}
      </div>

      {/* Actions */}
      {wh && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => navigate(`/warehouse/receive?bookId=${book.id}`)}>
            <PackagePlus className="h-4 w-4" /> Receive more
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate('/warehouse/transfers')}>
            <ArrowRightLeft className="h-4 w-4" /> Transfer
          </Button>
          {(stock.back > 0 || stock.main > 0) && (
            <Button size="sm" variant="outline" onClick={() => navigate('/warehouse/scan')}>
              <Store className="h-4 w-4" /> Put on sale
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => navigate(`/warehouse/scan`)}>
            <ScanBarcode className="h-4 w-4" /> Scan carton
          </Button>
        </div>
      )}

      {/* Cartons */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-900">Cartons</h2>
          <p className="text-xs text-gray-500">
            {cartonCounts.full} Full · {cartonCounts.open} Open · {cartonCounts.empty} Empty
          </p>
        </div>
        {boxes.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">No cartons for this title yet</p>
        ) : (
          <ul className="space-y-2 max-h-72 overflow-y-auto">
            {boxes.slice(0, 40).map((b) => (
              <li key={b.id}>
                <Link
                  to={`/warehouse/scan?box=${encodeURIComponent(b.barcode)}`}
                  className="flex items-center gap-3 rounded-lg border border-gray-100 px-3 py-2 hover:bg-accent-50/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-mono text-gray-500">{b.barcode}</p>
                    <p className="text-sm text-gray-800">{b.quantity} / {b.initialQuantity} copies</p>
                  </div>
                  <Badge variant={cartonStatusBadge(b.status)}>{cartonStatusLabel(b.status)}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Movements */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Recent movements</h2>
        {movements.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">No movements yet</p>
        ) : (
          <ul className="divide-y divide-gray-50">
            {movements.map((m) => (
              <li key={m.id} className="py-2.5 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-900 capitalize">{m.type.replace(/_/g, ' ')}</p>
                  <p className="text-xs text-gray-500">{m.reason || m.performedByName || '—'}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold tabular-nums text-gray-900">{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</p>
                  <p className="text-[10px] text-gray-400">{formatDateTime(m.createdAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[11px] text-gray-400">
          Locations: {bookstoreWarehouse?.name ?? LOCATION_LABELS.bookstore} · sales via Store POS
        </p>
      </section>
    </div>
  )
}
