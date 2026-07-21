import { useEffect, useMemo, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { PackagePlus, Printer, Search, CheckCircle2, ArrowRightLeft } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useWarehouse } from '@/contexts/WarehouseContext'
import { useBooks } from '@/contexts/BooksContext'
import { receiveBoxes } from '@/lib/inventoryService'
import { printBoxLabels, boxToLabelData } from '@/lib/boxLabel'
import { opsErrorMessage } from '@/lib/opsErrors'
import { formatCurrency, cn } from '@/lib/utils'
import type { Book } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { PageSpinner } from '@/components/ui/Spinner'

export default function Receive() {
  const { appUser } = useAuth()
  const { warehouses, primaryWarehouse, bookstoreId } = useWarehouse()
  const { books, loading: booksLoading } = useBooks()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const defaultWh = primaryWarehouse

  const [warehouseId, setWarehouseId] = useState(defaultWh?.id ?? '')
  const [bookSearch, setBookSearch] = useState('')
  const [selectedBook, setSelectedBook] = useState<Book | null>(null)
  const [totalQty, setTotalQty] = useState('')
  const [copiesPerBox, setCopiesPerBox] = useState('24')
  const [batchRef, setBatchRef] = useState('')
  const [shelfLocation, setShelfLocation] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [createdBoxes, setCreatedBoxes] = useState<Array<{ id: string; barcode: string; quantity: number; status?: string }>>([])

  // Sync default warehouse when context loads
  useEffect(() => {
    if (!warehouseId && defaultWh) setWarehouseId(defaultWh.id)
  }, [defaultWh?.id, warehouseId])

  // Prefill book from Books hub
  useEffect(() => {
    const bookId = searchParams.get('bookId')
    if (!bookId || selectedBook) return
    const b = books.find((x) => x.id === bookId)
    if (b) setSelectedBook(b)
  }, [searchParams, books, selectedBook])

  const warehouseOptions = warehouses
    .filter((w) => w.type !== 'bookstore')
    .map((w) => ({
      value: w.id,
      label: w.type === 'primary_warehouse'
        ? `Main Warehouse (${w.code})`
        : w.type === 'buffer_warehouse'
          ? `Backroom (${w.code})`
          : `${w.name} (${w.code})`,
    }))

  const filteredBooks = useMemo(() => {
    const q = bookSearch.trim().toLowerCase()
    if (!q) return books.slice(0, 30)
    return books.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        (b.author ?? '').toLowerCase().includes(q) ||
        (b.isbn ?? '').includes(q),
    ).slice(0, 30)
  }, [books, bookSearch])

  const selectedWh = warehouses.find((w) => w.id === warehouseId) ?? defaultWh
  const qty = parseInt(totalQty, 10) || 0
  const perBox = parseInt(copiesPerBox, 10) || 0
  const fullCount = qty > 0 && perBox > 0 ? Math.floor(qty / perBox) : 0
  const remainder = qty > 0 && perBox > 0 ? qty % perBox : 0
  const cartonCount = fullCount + (remainder > 0 ? 1 : 0)

  const handleReceive = async () => {
    if (!appUser || !selectedBook || !selectedWh) return
    if (qty <= 0 || perBox <= 0) {
      toast.error('Enter valid quantity and copies per carton')
      return
    }
    setSubmitting(true)
    setCreatedBoxes([])
    try {
      const result = await receiveBoxes({
        bookId: selectedBook.id,
        bookName: selectedBook.name,
        warehouseId: selectedWh.id,
        warehouseCode: selectedWh.code,
        bookstoreId,
        totalQuantity: qty,
        copiesPerBox: perBox,
        batchRef: batchRef.trim() || undefined,
        shelfLocation: shelfLocation.trim() || undefined,
        notes: notes.trim() || undefined,
        user: appUser,
      })
      setCreatedBoxes(result.boxes)
      toast.success(`Created ${result.boxes.length} carton(s)`)
    } catch (e) {
      toast.error(opsErrorMessage(e, 'Receive failed'))
    } finally {
      setSubmitting(false)
    }
  }

  const handlePrintAll = () => {
    if (!selectedWh || createdBoxes.length === 0 || !selectedBook) return
    try {
      printBoxLabels(
        createdBoxes.map((b) =>
          boxToLabelData(
            { barcode: b.barcode, bookName: selectedBook.name, quantity: b.quantity, shelfLocation, batchRef },
            selectedWh,
            { author: selectedBook.author, isbn: selectedBook.isbn },
          ),
        ),
      )
    } catch (e) {
      toast.error(opsErrorMessage(e, 'Print failed'))
    }
  }

  /** Jump to Transfers with the just-created cartons preselected, ready to send to Backroom. */
  const handleSendCartons = () => {
    if (createdBoxes.length === 0) return
    const ids = createdBoxes.map((b) => b.id).join(',')
    navigate(`/warehouse/transfers?boxIds=${encodeURIComponent(ids)}`)
  }

  /** Clear the form so the next carton can be received from scratch. */
  const handleDone = () => {
    setCreatedBoxes([])
    setSelectedBook(null)
    setBookSearch('')
    setTotalQty('')
    setCopiesPerBox('24')
    setBatchRef('')
    setShelfLocation('')
    setNotes('')
  }

  if (booksLoading) return <PageSpinner />

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <PackagePlus className="h-6 w-6 text-accent-600" />
          Receive print run
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Create Full cartons + an Open carton for leftover copies. Defaults to Main Warehouse.
        </p>
        <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5 text-xs text-blue-900 leading-relaxed">
          <strong>Flow:</strong> pick book → total copies → copies per carton → create cartons →
          <strong> print labels</strong> → stick on cartons → shelf in Main Warehouse → transfer to Backroom → Put on sale.
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-4">
          <Select
          label="Receive into"
          options={warehouseOptions}
          value={warehouseId || selectedWh?.id || ''}
          onChange={(e) => setWarehouseId(e.target.value)}
        />

        <div>
          <label className="text-sm font-medium text-gray-700">Book</label>
          {selectedBook ? (
            <div className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2">
              <div>
                <p className="font-medium text-gray-900">{selectedBook.name}</p>
                <p className="text-xs text-gray-500">
                  {selectedBook.author}{selectedBook.isbn ? ` · ${selectedBook.isbn}` : ''} · MRP {formatCurrency(selectedBook.mrp)}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelectedBook(null)}>Change</Button>
            </div>
          ) : (
            <>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  className="w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="Search by name, author, ISBN…"
                  value={bookSearch}
                  onChange={(e) => setBookSearch(e.target.value)}
                />
              </div>
              <ul className="mt-2 max-h-48 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-50">
                {filteredBooks.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                      onClick={() => { setSelectedBook(b); setBookSearch('') }}
                    >
                      <span className="font-medium">{b.name}</span>
                      <span className="text-gray-400 text-xs ml-2">{b.author}</span>
                    </button>
                  </li>
                ))}
                {filteredBooks.length === 0 && (
                  <li className="px-3 py-4 text-sm text-gray-400 text-center">No books found</li>
                )}
              </ul>
            </>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Total quantity"
            type="number"
            min={1}
            value={totalQty}
            onChange={(e) => setTotalQty(e.target.value)}
          />
          <Input
            label="Copies per carton"
            type="number"
            min={1}
            value={copiesPerBox}
            onChange={(e) => setCopiesPerBox(e.target.value)}
            hint={
              cartonCount > 0
                ? `${fullCount} Full${remainder > 0 ? ` + 1 Open (loose ×${remainder})` : ''} = ${cartonCount} carton(s)`
                : undefined
            }
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input label="Batch / PO ref (optional)" value={batchRef} onChange={(e) => setBatchRef(e.target.value)} />
          <Input label="Shelf location (optional)" value={shelfLocation} onChange={(e) => setShelfLocation(e.target.value)} placeholder="A-12-3" />
        </div>
        <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />

        <Button
          className="w-full"
          loading={submitting}
          disabled={!selectedBook || !selectedWh}
          onClick={handleReceive}
        >
          Receive & create cartons
        </Button>
      </div>

      {createdBoxes.length > 0 && (
        <div className="bg-white border border-green-200 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-start gap-3">
            <div className="shrink-0 flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">Created {createdBoxes.length} carton(s)</h2>
              <p className="text-xs text-amber-700 mt-0.5">Print labels now and stick them on every carton.</p>
            </div>
          </div>

          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
            {createdBoxes.map((b) => (
              <li key={b.id} className={cn('flex justify-between px-3 py-2 text-sm font-mono')}>
                <span className="text-accent-700">{b.barcode}</span>
                <span className="text-gray-600">Qty {b.quantity}</span>
              </li>
            ))}
          </ul>

          <div className="flex flex-col sm:flex-row gap-2">
            <Button className="flex-1 min-h-[44px]" onClick={handlePrintAll}>
              <Printer className="h-4 w-4" />
              Print labels
            </Button>
            <Button variant="outline" className="flex-1 min-h-[44px]" onClick={handleSendCartons}>
              <ArrowRightLeft className="h-4 w-4" />
              Send these cartons
            </Button>
            <Button variant="ghost" className="min-h-[44px]" onClick={handleDone}>
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
