import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Boxes as BoxesIcon, Printer, Search, PackageOpen, Download } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useWarehouse } from '@/contexts/WarehouseContext'
import { useBooks } from '@/contexts/BooksContext'
import { replenishRetail } from '@/lib/inventoryService'
import { mapBox } from '@/lib/mappers'
import { printBoxLabels, boxToLabelData } from '@/lib/boxLabel'
import { exportBoxesRegister } from '@/lib/warehouseExport'
import { formatDateTime, toMillis, cn } from '@/lib/utils'
import { cartonStatusLabel } from '@/lib/roles'
import type { Box, BoxStatus } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner } from '@/components/ui/Spinner'

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'sealed', label: 'Full' },
  { value: 'open', label: 'Open' },
  { value: 'empty', label: 'Empty' },
  { value: 'in_transit', label: 'In transit' },
]

const STATUS_BADGE: Record<BoxStatus, 'green' | 'yellow' | 'gray' | 'orange'> = {
  sealed: 'green',
  open: 'yellow',
  empty: 'gray',
  in_transit: 'orange',
}

export default function BoxesPage() {
  const { appUser } = useAuth()
  const { warehouses, activeWarehouse, bookstoreId } = useWarehouse()
  const { books } = useBooks()

  const [boxes, setBoxes] = useState<(Box & { id: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [warehouseFilter, setWarehouseFilter] = useState(activeWarehouse?.id ?? '')
  const [selected, setSelected] = useState<(Box & { id: string })[]>([])
  const [replenishBox, setReplenishBox] = useState<(Box & { id: string }) | null>(null)
  const [replenishQty, setReplenishQty] = useState('')
  const [replenishing, setReplenishing] = useState(false)

  useEffect(() => {
    if (activeWarehouse && !warehouseFilter) setWarehouseFilter(activeWarehouse.id)
  }, [activeWarehouse?.id])

  useEffect(() => {
    setLoading(true)
    setLoadError(false)
    let cancelled = false

    async function load() {
      let q = supabase.from('boxes').select('*')
      if (warehouseFilter) q = q.eq('warehouse_id', warehouseFilter)
      if (statusFilter) q = q.eq('status', statusFilter as BoxStatus)
      if (!warehouseFilter && !statusFilter) q = q.order('created_at', { ascending: false })

      const { data, error } = await q
      if (cancelled) return
      if (error) {
        setLoadError(true)
        setLoading(false)
        toast.error('Could not load cartons. Tap Retry.')
        return
      }
      setBoxes(
        (data ?? [])
          .map((r) => mapBox(r as Record<string, unknown>))
          .filter((b) => !b.isDeleted)
          .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)),
      )
      setLoading(false)
    }

    void load()
    const channel = supabase
      .channel('boxes-list-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'boxes' }, () => void load())
      .subscribe()

    return () => {
      cancelled = true
      void supabase.removeChannel(channel)
    }
  }, [warehouseFilter, statusFilter, reloadKey])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return boxes
    return boxes.filter(
      (b) =>
        b.barcode.toLowerCase().includes(q) ||
        b.bookName.toLowerCase().includes(q) ||
        (b.batchRef ?? '').toLowerCase().includes(q),
    )
  }, [boxes, search])

  const toggleSelect = (box: Box & { id: string }) => {
    setSelected((prev) =>
      prev.some((s) => s.id === box.id) ? prev.filter((s) => s.id !== box.id) : [...prev, box],
    )
  }

  const printSelected = () => {
    const list = selected.length > 0 ? selected : filtered.slice(0, 50)
    if (list.length === 0) {
      toast.error('No cartons to print')
      return
    }
    try {
      printBoxLabels(
        list.map((box) => {
          const wh = warehouses.find((w) => w.id === box.warehouseId)
          const book = books.find((b) => b.id === box.bookId)
          return boxToLabelData(box, wh ?? { name: 'Warehouse', code: 'XX' }, {
            author: book?.author,
            isbn: book?.isbn,
          })
        }),
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Print failed')
    }
  }

  const handleReplenish = async () => {
    if (!appUser || !replenishBox) return
    const qty = parseInt(replenishQty, 10)
    if (isNaN(qty) || qty <= 0) {
      toast.error('Enter a valid quantity')
      return
    }
    setReplenishing(true)
    try {
      await replenishRetail({
        boxId: replenishBox.id,
        quantity: qty,
        bufferWarehouseId: replenishBox.warehouseId,
        bookstoreId,
        user: appUser,
      })
      toast.success(`Moved ${qty} to bookstore`)
      setReplenishBox(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    } finally {
      setReplenishing(false)
    }
  }

  const warehouseOptions = [
    { value: '', label: 'All warehouses' },
    ...warehouses.map((w) => ({ value: w.id, label: `${w.name} (${w.code})` })),
  ]

  if (loading && boxes.length === 0) return <PageSpinner />

  return (
    <div className="space-y-6">
      {loadError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-sm text-red-700">Could not load cartons.</p>
          <Button size="sm" variant="outline" onClick={() => setReloadKey((k) => k + 1)}>Retry</Button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <BoxesIcon className="h-6 w-6 text-accent-600" />
            Cartons
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Full / Open / Empty · {filtered.length} shown
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              exportBoxesRegister(boxes, warehouses)
              toast.success('Cartons Excel downloaded')
            }}
          >
            <Download className="h-4 w-4" />
            Excel
          </Button>
          <Button variant="outline" onClick={printSelected}>
            <Printer className="h-4 w-4" />
            Print labels{selected.length > 0 ? ` (${selected.length})` : ''}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            className="w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="Search barcode, book, batch…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          options={warehouseOptions}
          value={warehouseFilter}
          onChange={(e) => setWarehouseFilter(e.target.value)}
          className="w-48"
        />
        <Select
          options={STATUS_OPTIONS}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="w-40"
        />
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {filtered.map((box) => {
          const wh = warehouses.find((w) => w.id === box.warehouseId)
          return (
            <div key={box.id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">{box.bookName}</p>
                  <p className="text-xs font-mono text-accent-700">{box.barcode}</p>
                </div>
                <Badge variant={STATUS_BADGE[box.status]}>{cartonStatusLabel(box.status)}</Badge>
              </div>
              <div className="mt-2 flex items-center justify-between text-sm text-gray-600">
                <span>×{box.quantity} · {wh?.code ?? '—'}</span>
                {box.warehouseId !== bookstoreId && box.status !== 'empty' && box.status !== 'in_transit' && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setReplenishBox(box)
                      setReplenishQty(String(box.quantity))
                    }}
                  >
                    Put on sale
                  </Button>
                )}
              </div>
            </div>
          )
        })}
        {filtered.length === 0 && (
          <p className="text-center text-gray-400 py-8 text-sm">No boxes found</p>
        )}
      </div>

      <div className="hidden md:block bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2 w-8" />
                <th className="px-3 py-2">Barcode</th>
                <th className="px-3 py-2">Book</th>
                <th className="px-3 py-2">Qty</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Warehouse</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((box) => {
                const wh = warehouses.find((w) => w.id === box.warehouseId)
                const checked = selected.some((s) => s.id === box.id)
                return (
                  <tr key={box.id} className={cn('hover:bg-gray-50', checked && 'bg-accent-50')}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelect(box)}
                        className="rounded border-gray-300"
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-accent-700">{box.barcode}</td>
                    <td className="px-3 py-2 font-medium text-gray-900">{box.bookName}</td>
                    <td className="px-3 py-2">{box.quantity}</td>
                    <td className="px-3 py-2">
                      <Badge variant={STATUS_BADGE[box.status]}>{cartonStatusLabel(box.status)}</Badge>
                    </td>
                    <td className="px-3 py-2 text-gray-600">{wh?.code ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-400 text-xs">{formatDateTime(box.createdAt)}</td>
                    <td className="px-3 py-2">
                      {box.warehouseId !== bookstoreId && box.status !== 'empty' && box.status !== 'in_transit' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setReplenishBox(box)
                            setReplenishQty(String(box.quantity))
                          }}
                          title="Replenish bookstore"
                        >
                          <PackageOpen className="h-4 w-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-gray-400">
                    No boxes found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={!!replenishBox} onClose={() => setReplenishBox(null)} title="Put on sale" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Move copies from <strong>{replenishBox?.barcode}</strong> onto the store shelf so they can be sold.
          </p>
          <Input
            label="Quantity"
            type="number"
            min={1}
            max={replenishBox?.quantity}
            value={replenishQty}
            onChange={(e) => setReplenishQty(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setReplenishBox(null)}>Cancel</Button>
            <Button loading={replenishing} onClick={handleReplenish}>Confirm</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
