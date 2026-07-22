import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowLeft, Pencil } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { mapBox, mapMovement } from '@/lib/mappers'
import { useBooks } from '@/contexts/BooksContext'
import { useWarehouse } from '@/contexts/WarehouseContext'
import { useAuth } from '@/contexts/AuthContext'
import { canWarehouse, cartonStatusLabel } from '@/lib/roles'
import { CATEGORY_OPTIONS, categoryLabel } from '@/lib/bookCategories'
import { movementLine } from '@/lib/activityCopy'
import { formatCurrency, formatDateTime, toMillis } from '@/lib/utils'
import type { Box, InventoryMovement, BookType } from '@/types'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Select } from '@/components/ui/Select'
import { PageSpinner } from '@/components/ui/Spinner'

export default function BookDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { appUser } = useAuth()
  const { books, loading: booksLoading } = useBooks()
  const {
    getRetailStock, getWarehouseStock,
    primaryWarehouse, bufferWarehouse,
  } = useWarehouse()
  const [boxes, setBoxes] = useState<(Box & { id: string })[]>([])
  const [movements, setMovements] = useState<(InventoryMovement & { id: string })[]>([])
  const [savingCat, setSavingCat] = useState(false)

  const wh = canWarehouse(appUser?.role)
  const book = books.find((b) => b.id === id)

  useEffect(() => {
    if (!id) return
    const bookId = id
    let cancelled = false
    async function load() {
      const [bRes, mRes] = await Promise.all([
        supabase.from('boxes').select('*').eq('book_id', bookId).limit(100),
        supabase.from('inventory_movements').select('*').eq('book_id', bookId).order('created_at', { ascending: false }).limit(20),
      ])
      if (cancelled) return
      setBoxes(
        (bRes.data ?? [])
          .map((r) => mapBox(r as Record<string, unknown>))
          .filter((b) => !b.isDeleted && b.quantity > 0)
          .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)),
      )
      setMovements((mRes.data ?? []).map((r) => mapMovement(r as Record<string, unknown>)))
    }
    void load()
    return () => { cancelled = true }
  }, [id])

  const stock = useMemo(() => {
    if (!book) return { main: 0, back: 0, store: 0 }
    return {
      main: primaryWarehouse ? getWarehouseStock(book.id, primaryWarehouse.id) : 0,
      back: bufferWarehouse ? getWarehouseStock(book.id, bufferWarehouse.id) : 0,
      store: getRetailStock(book.id, book.inStock),
    }
  }, [book, primaryWarehouse, bufferWarehouse, getWarehouseStock, getRetailStock])

  const setCategory = async (language: BookType) => {
    if (!book || !wh) return
    setSavingCat(true)
    try {
      const { error } = await supabase.from('books').update({ language, updated_at: new Date().toISOString() }).eq('id', book.id)
      if (error) throw error
      toast.success(`Category → ${language}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    } finally {
      setSavingCat(false)
    }
  }

  if (booksLoading) return <PageSpinner />
  if (!book) {
    return (
      <div className="py-16 text-center space-y-3">
        <p className="text-gray-600">Book not found</p>
        <Button variant="outline" onClick={() => navigate('/books')}>Back</Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <button
        type="button"
        onClick={() => navigate('/books')}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"
      >
        <ArrowLeft className="h-4 w-4" /> Books
      </button>

      <div className="flex gap-4">
        {book.coverUrl ? (
          <img src={book.coverUrl} alt="" className="h-28 w-20 rounded-lg object-cover border bg-gray-50 shrink-0" />
        ) : (
          <div className="h-28 w-20 rounded-lg bg-gray-100 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-gray-900 leading-snug">{book.name}</h1>
          <p className="text-sm text-gray-500 mt-1">{book.author || '—'}</p>
          <p className="text-sm text-gray-600 mt-2">MRP {formatCurrency(book.mrp)}</p>
        </div>
      </div>

      {wh ? (
        <Select
          label="Category"
          value={book.language}
          disabled={savingCat}
          onChange={(e) => void setCategory(e.target.value as BookType)}
          options={CATEGORY_OPTIONS.map((c) => ({
            value: c.value,
            label: `${c.label} · ${c.hint}`,
          }))}
        />
      ) : (
        <Badge variant="gray">{categoryLabel(book.language)}</Badge>
      )}

      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Warehouse', value: stock.main },
          { label: 'Backroom', value: stock.back },
          { label: 'Shelf', value: stock.store },
        ].map((c) => (
          <div key={c.label} className="rounded-2xl border border-gray-200 bg-white p-3 text-center">
            <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">{c.label}</p>
            <p className="text-2xl font-bold tabular-nums text-gray-900 mt-1">{c.value}</p>
          </div>
        ))}
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Cartons · {boxes.length}</h2>
        {boxes.length === 0 ? (
          <p className="text-sm text-gray-400">No cartons</p>
        ) : (
          <ul className="space-y-2 max-h-48 overflow-y-auto">
            {boxes.slice(0, 20).map((b) => (
              <li key={b.id} className="flex justify-between gap-2 text-sm">
                <span className="font-mono text-xs text-gray-500 truncate">{b.barcode}</span>
                <span className="tabular-nums font-semibold">{b.quantity}</span>
                <Badge variant="gray">{cartonStatusLabel(b.status)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Log · गतिविधि</h2>
        {movements.length === 0 ? (
          <p className="text-sm text-gray-400">Nothing yet</p>
        ) : (
          <ul className="space-y-3">
            {movements.map((m) => (
              <li key={m.id} className="text-sm">
                <p className="text-gray-900 leading-snug">{movementLine(m)}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">{formatDateTime(m.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {wh && (
        <Button variant="outline" className="w-full min-h-11" onClick={() => navigate('/books')}>
          <Pencil className="h-4 w-4" /> Edit from Books list
        </Button>
      )}
    </div>
  )
}
