import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Truck, Search, CheckCircle2, Plus } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useWarehouse } from '@/contexts/WarehouseContext'
import { useBooks } from '@/contexts/BooksContext'
import { receiveVendorStock, removeShelfStock } from '@/lib/inventoryService'
import { listVendors } from '@/lib/vendors'
import { isThirdParty, categoryLabel } from '@/lib/bookCategories'
import { opsErrorMessage } from '@/lib/opsErrors'
import type { Book, Vendor } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { PageSpinner } from '@/components/ui/Spinner'

/** Third-party Nepali/English → store shelf · pick vendor + book. */
export default function VendorReceive() {
  const { appUser } = useAuth()
  const { bookstoreId, getRetailStock } = useWarehouse()
  const { books, loading } = useBooks()

  const [vendors, setVendors] = useState<(Vendor & { id: string })[]>([])
  const [vendorsLoading, setVendorsLoading] = useState(true)
  const [vendorId, setVendorId] = useState('')
  const [bookSearch, setBookSearch] = useState('')
  const [selected, setSelected] = useState<Book | null>(null)
  const [qty, setQty] = useState('')
  const [busy, setBusy] = useState(false)
  const [undoing, setUndoing] = useState(false)
  const [lastOk, setLastOk] = useState<{
    name: string
    bookId: string
    qty: number
    before: number
    after: number
    vendorName: string
  } | null>(null)

  const vendor = vendors.find((v) => v.id === vendorId) ?? null

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const rows = await listVendors({ activeOnly: true })
        if (cancelled) return
        setVendors(rows)
        if (rows.length === 1) setVendorId(rows[0].id)
      } catch (e) {
        if (!cancelled) {
          toast.error(
            e instanceof Error && /relation|schema|does not exist/i.test(e.message)
              ? 'Vendors not set up yet — run migration 009 in Supabase, or add vendors in Settings'
              : e instanceof Error
                ? e.message
                : 'Could not load vendors',
          )
        }
      } finally {
        if (!cancelled) setVendorsLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

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
    if (!vendor) {
      toast.error('Choose a vendor first')
      return
    }
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
        vendorId: vendor.id,
        vendorName: vendor.name,
        user: appUser,
      })
      setLastOk({
        name: selected.name,
        bookId: selected.id,
        qty: n,
        before,
        after: before + n,
        vendorName: vendor.name,
      })
      toast.success(`${n} pcs · ${selected.name} from ${vendor.name} → shelf`)
      setQty('')
      setSelected(null)
      setBookSearch('')
    } catch (e) {
      toast.error(opsErrorMessage(e, 'Receive failed'))
    } finally {
      setBusy(false)
    }
  }

  const handleUndo = async () => {
    if (!appUser || !lastOk) return
    if (!confirm(`Undo? Remove ${lastOk.qty} pcs of “${lastOk.name}” from shelf.`)) return
    setUndoing(true)
    try {
      await removeShelfStock({
        bookId: lastOk.bookId,
        bookName: lastOk.name,
        quantity: lastOk.qty,
        bookstoreId,
        reason: 'Undo mistaken vendor receive',
        user: appUser,
      })
      toast.success(`Undone · −${lastOk.qty} from shelf`)
      setLastOk(null)
    } catch (e) {
      toast.error(opsErrorMessage(e, 'Undo failed'))
    } finally {
      setUndoing(false)
    }
  }

  if (loading || vendorsLoading) return <PageSpinner />

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Truck className="h-7 w-7 text-accent-600" />
          Stock in · Nepali / English
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Pick vendor · pick book · straight to shelf
        </p>
      </div>

      {lastOk && (
        <div className="rounded-2xl border border-green-200 bg-green-50 p-4 space-y-3">
          <div className="flex gap-3">
            <CheckCircle2 className="h-6 w-6 text-green-700 shrink-0" />
            <div>
              <p className="font-semibold text-green-900">{lastOk.name}</p>
              <p className="text-sm text-green-800 mt-1">
                {lastOk.qty} pcs from <strong>{lastOk.vendorName}</strong> → bookstore · shelf{' '}
                {lastOk.before} → <strong>{lastOk.after}</strong>
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            className="w-full min-h-11 text-red-700 border-red-200"
            loading={undoing}
            disabled={undoing}
            onClick={() => void handleUndo()}
          >
            Undo this receive
          </Button>
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
        <Select
          label="From vendor"
          value={vendorId}
          onChange={(e) => setVendorId(e.target.value)}
          placeholder="Choose vendor…"
          options={vendors.map((v) => ({ value: v.id, label: v.name }))}
        />
        {vendors.length === 0 && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
            No vendors yet.{' '}
            <Link to="/settings/vendors" className="font-semibold underline">
              Add a vendor in Settings
            </Link>
          </p>
        )}
        {vendors.length > 0 && (
          <Link to="/settings/vendors" className="inline-flex items-center gap-1 text-sm text-accent-700">
            <Plus className="h-3.5 w-3.5" /> Manage vendors
          </Link>
        )}
      </div>

      {!vendorId ? (
        <p className="text-center text-sm text-gray-400 py-6">Choose a vendor to continue</p>
      ) : !selected ? (
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
          <p className="text-sm text-gray-500">
            From <strong className="text-gray-800">{vendor?.name}</strong>
          </p>
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
            disabled={busy || !vendor}
            onClick={() => void handleReceive()}
          >
            Add to shelf
          </Button>
        </div>
      )}
    </div>
  )
}
