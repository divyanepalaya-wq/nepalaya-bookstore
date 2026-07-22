import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Truck, Search, CheckCircle2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useWarehouse } from '@/contexts/WarehouseContext'
import { useBooks } from '@/contexts/BooksContext'
import { receiveVendorStock } from '@/lib/inventoryService'
import { isThirdParty, categoryLabel } from '@/lib/bookCategories'
import { opsErrorMessage } from '@/lib/opsErrors'
import type { Book } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { PageSpinner } from '@/components/ui/Spinner'

/** Third-party Nepali/English → store shelf only. */
export default function VendorReceive() {
  const { appUser } = useAuth()
  const { bookstoreId, getRetailStock } = useWarehouse()
  const { books, loading } = useBooks()

  const [bookSearch, setBookSearch] = useState('')
  const [selected, setSelected] = useState<Book | null>(null)
  const [qty, setQty] = useState('')
  const [busy, setBusy] = useState(false)
  const [lastOk, setLastOk] = useState<{ name: string; qty: number; before: number; after: number } | null>(null)

  const thirdParty = useMemo(() => books.filter((b) => isThirdParty(b)), [books])

  const filtered = useMemo(() => {
    const q = bookSearch.trim().toLowerCase()
    if (!q) return thirdParty.slice(0, 40)
    return thirdParty
      .filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          (b.author ?? '').toLowerCase().includes(q) ||
          (b.isbn ?? '').includes(q),
      )
      .slice(0, 40)
  }, [thirdParty, bookSearch])

  const handleReceive = async () => {
    if (!appUser || !selected) return
    if (!isThirdParty(selected)) {
      toast.error('Only Nepali or English (vendor) books')
      return
    }
    const n = parseInt(qty, 10)
    if (!n || n <= 0) {
      toast.error('Enter how many pieces arrived')
      return
    }
    const before = getRetailStock(selected.id, selected.inStock)
    setBusy(true)
    try {
      await receiveVendorStock({
        bookId: selected.id,
        bookName: selected.name,
        quantity: n,
        bookstoreId,
        notes: 'Vendor delivery',
        user: appUser,
      })
      setLastOk({ name: selected.name, qty: n, before, after: before + n })
      toast.success(`${n} pcs · ${selected.name} came from vendor → shelf`)
      setQty('')
      setSelected(null)
      setBookSearch('')
    } catch (e) {
      toast.error(opsErrorMessage(e, 'Receive failed'))
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <PageSpinner />

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Truck className="h-7 w-7 text-accent-600" />
          Receive vendor
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Nepali & English · straight to shelf · कार्टुन छैन
        </p>
      </div>

      {lastOk && (
        <div className="rounded-2xl border border-green-200 bg-green-50 p-4 flex gap-3">
          <CheckCircle2 className="h-6 w-6 text-green-700 shrink-0" />
          <div>
            <p className="font-semibold text-green-900">{lastOk.name}</p>
            <p className="text-sm text-green-800 mt-1">
              {lastOk.qty} pcs came from vendor → bookstore · shelf {lastOk.before} → <strong>{lastOk.after}</strong>
            </p>
          </div>
        </div>
      )}

      {!selected ? (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <Input
              className="pl-11 min-h-12 text-base"
              placeholder="Find Nepali or English book…"
              value={bookSearch}
              onChange={(e) => setBookSearch(e.target.value)}
              autoFocus
            />
          </div>
          <ul className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100 max-h-96 overflow-y-auto">
            {filtered.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-accent-50"
                  onClick={() => setSelected(b)}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-gray-900">{b.name}</p>
                    <Badge variant="gray" className="mt-1">{categoryLabel(b.language)}</Badge>
                  </div>
                  <span className="text-sm tabular-nums text-gray-500">
                    shelf {getRetailStock(b.id, b.inStock)}
                  </span>
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-4 py-8 text-center text-gray-400 text-sm">
                No vendor books match. Tag books as Nepali or English in catalog.
              </li>
            )}
          </ul>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-4">
          <button type="button" className="text-sm text-accent-700" onClick={() => setSelected(null)}>
            ← Change book
          </button>
          <p className="text-xl font-bold text-gray-900">{selected.name}</p>
          <Badge variant="blue">{categoryLabel(selected.language)}</Badge>
          <p className="text-sm text-gray-500">
            Now on shelf: <strong>{getRetailStock(selected.id, selected.inStock)}</strong>
          </p>
          <Input
            label="Pieces received"
            type="number"
            min={1}
            className="min-h-14 text-2xl font-bold"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            autoFocus
          />
          <Button
            size="lg"
            className="w-full min-h-14 text-lg"
            loading={busy}
            disabled={busy}
            onClick={() => void handleReceive()}
          >
            Add to shelf
          </Button>
        </div>
      )}
    </div>
  )
}
