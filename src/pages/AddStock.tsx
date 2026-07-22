import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { PackagePlus, Printer, Search, CheckCircle2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useWarehouse } from '@/contexts/WarehouseContext'
import { useBooks } from '@/contexts/BooksContext'
import { receiveBoxes } from '@/lib/inventoryService'
import { printBoxLabels, boxToLabelData } from '@/lib/boxLabel'
import { isNepalaya } from '@/lib/bookCategories'
import { opsErrorMessage } from '@/lib/opsErrors'
import type { Book } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { PageSpinner } from '@/components/ui/Spinner'

/** Warehouse: add Nepalaya boxes/pcs (default 24/box). */
export default function AddStock() {
  const { appUser } = useAuth()
  const { primaryWarehouse, bookstoreId } = useWarehouse()
  const { books, loading } = useBooks()

  const [bookSearch, setBookSearch] = useState('')
  const [selectedBook, setSelectedBook] = useState<Book | null>(null)
  const [totalQty, setTotalQty] = useState('')
  const [copiesPerBox, setCopiesPerBox] = useState('24')
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState<Array<{ id: string; barcode: string; quantity: number }>>([])

  const nepalayaBooks = useMemo(() => books.filter((b) => isNepalaya(b)), [books])

  const filtered = useMemo(() => {
    const q = bookSearch.trim().toLowerCase()
    if (!q) return nepalayaBooks.slice(0, 40)
    return nepalayaBooks
      .filter((b) => b.name.toLowerCase().includes(q) || (b.author ?? '').toLowerCase().includes(q))
      .slice(0, 40)
  }, [nepalayaBooks, bookSearch])

  useEffect(() => {
    setCreated([])
  }, [selectedBook?.id])

  const qty = parseInt(totalQty, 10) || 0
  const perBox = parseInt(copiesPerBox, 10) || 0
  const cartonCount = qty > 0 && perBox > 0 ? Math.ceil(qty / perBox) : 0

  const handleAdd = async () => {
    if (!appUser || !selectedBook || !primaryWarehouse) return
    if (!isNepalaya(selectedBook)) {
      toast.error('Warehouse stock is Nepalaya only')
      return
    }
    if (qty <= 0 || perBox <= 0) {
      toast.error('Enter total pieces and pcs per carton')
      return
    }
    setSubmitting(true)
    setCreated([])
    try {
      const result = await receiveBoxes({
        bookId: selectedBook.id,
        bookName: selectedBook.name,
        warehouseId: primaryWarehouse.id,
        warehouseCode: primaryWarehouse.code,
        bookstoreId,
        totalQuantity: qty,
        copiesPerBox: perBox,
        batchRef: 'WH-ADD',
        notes: 'Added via Add stock',
        user: appUser,
      })
      setCreated(result.boxes)
      toast.success(`Created ${result.boxes.length} carton(s)`)
      setTotalQty('')
    } catch (e) {
      toast.error(opsErrorMessage(e, 'Could not add stock'))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <PageSpinner />

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <PackagePlus className="h-7 w-7 text-accent-600" />
          Nepalaya · warehouse
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          X book now in Y carton · गोदाममा · ~{copiesPerBox} pcs/box
        </p>
      </div>

      {!selectedBook ? (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <Input
              className="pl-11 min-h-12 text-base"
              placeholder="Find Nepalaya book…"
              value={bookSearch}
              onChange={(e) => setBookSearch(e.target.value)}
              autoFocus
            />
          </div>
          <ul className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100 max-h-80 overflow-y-auto">
            {filtered.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  className="w-full px-4 py-3.5 text-left hover:bg-accent-50 active:bg-accent-50"
                  onClick={() => setSelectedBook(b)}
                >
                  <p className="font-semibold text-gray-900 text-base">{b.name}</p>
                  {b.author && <p className="text-xs text-gray-500">{b.author}</p>}
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-4 py-8 text-center text-gray-400 text-sm">No Nepalaya books match</li>
            )}
          </ul>
        </div>
      ) : (
        <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4">
          <button type="button" className="text-sm text-accent-700" onClick={() => setSelectedBook(null)}>
            ← Change book
          </button>
          <p className="text-xl font-bold text-gray-900">{selectedBook.name}</p>
          <Input
            label="Total pieces"
            type="number"
            min={1}
            className="min-h-12 text-lg"
            value={totalQty}
            onChange={(e) => setTotalQty(e.target.value)}
          />
          <Input
            label="Pieces per carton"
            type="number"
            min={1}
            className="min-h-12 text-lg"
            value={copiesPerBox}
            onChange={(e) => setCopiesPerBox(e.target.value)}
          />
          {cartonCount > 0 && (
            <p className="text-sm text-gray-600">
              Will create <strong className="text-gray-900">{cartonCount}</strong> carton(s)
            </p>
          )}
          <Button
            size="lg"
            className="w-full min-h-14 text-lg"
            loading={submitting}
            disabled={submitting || qty <= 0}
            onClick={() => void handleAdd()}
          >
            Add boxes
          </Button>
        </div>
      )}

      {created.length > 0 && primaryWarehouse && (
        <div className="rounded-2xl border border-green-200 bg-green-50 p-4 space-y-3">
          <p className="font-medium text-green-900 flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5" /> {created.length} cartons ready
          </p>
          <Button
            size="lg"
            className="w-full min-h-12"
            onClick={() =>
              printBoxLabels(
                created.map((b) =>
                  boxToLabelData(
                    { barcode: b.barcode, bookName: selectedBook?.name ?? '', quantity: b.quantity, batchRef: 'WH-ADD' },
                    { name: primaryWarehouse.name, code: primaryWarehouse.code },
                  ),
                ),
              )
            }
          >
            <Printer className="h-5 w-5" /> Print labels
          </Button>
        </div>
      )}
    </div>
  )
}
