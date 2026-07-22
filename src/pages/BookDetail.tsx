import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowLeft, Pencil, Sparkles, Trash2, Minus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { mapBox, mapMovement } from '@/lib/mappers'
import { useBooks } from '@/contexts/BooksContext'
import { useWarehouse } from '@/contexts/WarehouseContext'
import { useAuth } from '@/contexts/AuthContext'
import { canWarehouse, cartonStatusLabel } from '@/lib/roles'
import { CATEGORY_OPTIONS, categoryLabel } from '@/lib/bookCategories'
import { movementLine } from '@/lib/activityCopy'
import { voidCarton, removeShelfStock } from '@/lib/inventoryService'
import { opsErrorMessage } from '@/lib/opsErrors'
import { formatCurrency, formatDateTime, toMillis } from '@/lib/utils'
import type { Box, InventoryMovement, BookType } from '@/types'
import { BookEnrichModal } from '@/components/BookEnrichModal'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { PageSpinner } from '@/components/ui/Spinner'

export default function BookDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { appUser } = useAuth()
  const { books, loading: booksLoading } = useBooks()
  const {
    getRetailStock, getWarehouseStock,
    primaryWarehouse, bufferWarehouse, bookstoreId,
  } = useWarehouse()
  const [boxes, setBoxes] = useState<(Box & { id: string })[]>([])
  const [movements, setMovements] = useState<(InventoryMovement & { id: string })[]>([])
  const [savingCat, setSavingCat] = useState(false)
  const [enrichOpen, setEnrichOpen] = useState(false)
  const [removeQty, setRemoveQty] = useState('')
  const [busy, setBusy] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

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
  }, [id, reloadKey])

  const stock = useMemo(() => {
    if (!book) return { main: 0, back: 0, store: 0, warehouse: 0 }
    const main = primaryWarehouse ? getWarehouseStock(book.id, primaryWarehouse.id) : 0
    const back = bufferWarehouse ? getWarehouseStock(book.id, bufferWarehouse.id) : 0
    return {
      main,
      back,
      warehouse: main + back,
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

  const handleVoidCarton = async (box: Box & { id: string }) => {
    if (!appUser) return
    if (!confirm(`Remove carton ${box.barcode} (${box.quantity} pcs)? This undoes a mistaken receive.`)) return
    setBusy(true)
    try {
      await voidCarton({ boxId: box.id, bookstoreId, user: appUser })
      toast.success(`Removed carton · −${box.quantity} pcs`)
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast.error(opsErrorMessage(e, 'Could not remove carton'))
    } finally {
      setBusy(false)
    }
  }

  const handleRemoveShelf = async () => {
    if (!appUser || !book) return
    const n = parseInt(removeQty, 10)
    if (!n || n <= 0) {
      toast.error('Enter how many to remove')
      return
    }
    if (n > stock.store) {
      toast.error(`Only ${stock.store} on shelf`)
      return
    }
    if (!confirm(`Remove ${n} pcs from shelf?`)) return
    setBusy(true)
    try {
      await removeShelfStock({
        bookId: book.id,
        bookName: book.name,
        quantity: n,
        bookstoreId,
        user: appUser,
      })
      toast.success(`Removed ${n} from shelf`)
      setRemoveQty('')
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast.error(opsErrorMessage(e, 'Could not remove'))
    } finally {
      setBusy(false)
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
          {book.isbn && <p className="text-xs text-gray-400 mt-1">ISBN {book.isbn}</p>}
        </div>
      </div>

      {wh && (
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1 min-h-11" onClick={() => setEnrichOpen(true)}>
            <Sparkles className="h-4 w-4" /> Find cover / ISBN
          </Button>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => navigate('/books')}>
            <Pencil className="h-4 w-4" />
          </Button>
        </div>
      )}

      {wh ? (
        <Select
          label="Category"
          value={book.language}
          disabled={savingCat}
          onChange={(e) => void setCategory(e.target.value as BookType)}
          options={CATEGORY_OPTIONS.map((c) => ({ value: c.value, label: c.label }))}
        />
      ) : (
        <Badge variant="gray">{categoryLabel(book.language)}</Badge>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Warehouse</p>
          <p className="text-3xl font-bold tabular-nums text-gray-900 mt-1">{stock.warehouse}</p>
          <p className="text-[11px] text-gray-500 mt-1">Main {stock.main} · Back {stock.back}</p>
        </div>
        <div className="rounded-2xl border border-green-200 bg-green-50/60 p-4 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-green-700">Shelf</p>
          <p className="text-3xl font-bold tabular-nums text-gray-900 mt-1">{stock.store}</p>
          <p className="text-[11px] text-gray-500 mt-1">On sale now</p>
        </div>
      </div>

      {wh && stock.store > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
          <p className="text-sm font-semibold text-gray-900">Remove from shelf</p>
          <p className="text-xs text-gray-500">Undo mistaken vendor receive or over-count</p>
          <div className="flex gap-2">
            <Input
              type="number"
              min={1}
              max={stock.store}
              className="min-h-11"
              placeholder={`1–${stock.store}`}
              value={removeQty}
              onChange={(e) => setRemoveQty(e.target.value)}
            />
            <Button type="button" variant="outline" className="min-h-11 shrink-0" disabled={busy} onClick={() => void handleRemoveShelf()}>
              <Minus className="h-4 w-4" /> Remove
            </Button>
          </div>
        </div>
      )}

      <section className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Cartons · {boxes.length}</h2>
        {boxes.length === 0 ? (
          <p className="text-sm text-gray-400">No cartons</p>
        ) : (
          <ul className="space-y-2 max-h-56 overflow-y-auto">
            {boxes.slice(0, 30).map((b) => (
              <li key={b.id} className="flex items-center gap-2 text-sm">
                <span className="font-mono text-xs text-gray-500 truncate flex-1">{b.barcode}</span>
                <span className="tabular-nums font-semibold">{b.quantity}</span>
                <Badge variant="gray">{cartonStatusLabel(b.status)}</Badge>
                {wh && (
                  <button
                    type="button"
                    disabled={busy}
                    title="Remove carton (undo receive)"
                    className="rounded-lg p-1.5 text-red-600 hover:bg-red-50 disabled:opacity-40"
                    onClick={() => void handleVoidCarton(b)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Log</h2>
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

      <BookEnrichModal
        open={enrichOpen}
        book={book}
        onClose={() => setEnrichOpen(false)}
        onSaved={() => setReloadKey((k) => k + 1)}
      />
    </div>
  )
}
