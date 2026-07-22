import { useState, useRef, useEffect, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ScanBarcode, Printer, PackageOpen, ArrowRightLeft, Camera, MapPin } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { mapMovement } from '@/lib/mappers'
import { useAuth } from '@/contexts/AuthContext'
import { useWarehouse } from '@/contexts/WarehouseContext'
import { useBooks } from '@/contexts/BooksContext'
import { findBoxByBarcode, replenishRetail, splitBox, putAwayBox } from '@/lib/inventoryService'
import { parseScanInput, buildShelfLabel } from '@/lib/barcode'
import { printBoxLabels, boxToLabelData } from '@/lib/boxLabel'
import { writeAuditLog } from '@/lib/auditLog'
import { opsErrorMessage } from '@/lib/opsErrors'
import { formatDateTime, cn } from '@/lib/utils'
import { cartonStatusLabel } from '@/lib/roles'
import type { Box, InventoryMovement } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import CameraScan from '@/components/CameraScan'

const STATUS_VARIANT: Record<string, 'green' | 'yellow' | 'gray' | 'orange' | 'red'> = {
  sealed: 'green',
  open: 'yellow',
  empty: 'gray',
  in_transit: 'orange',
}

export default function Scan() {
  const { appUser } = useAuth()
  const { warehouses, bookstoreId, mode } = useWarehouse()
  const { books } = useBooks()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const [scanValue, setScanValue] = useState('')
  const [looking, setLooking] = useState(false)
  const [box, setBox] = useState<(Box & { id: string }) | null>(null)
  const [movements, setMovements] = useState<InventoryMovement[]>([])
  const [notFound, setNotFound] = useState(false)
  const [replenishOpen, setReplenishOpen] = useState(false)
  const [replenishQty, setReplenishQty] = useState('')
  const [replenishing, setReplenishing] = useState(false)
  const [splitOpen, setSplitOpen] = useState(false)
  const [splitQty, setSplitQty] = useState('')
  const [splitting, setSplitting] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [putAwayOpen, setPutAwayOpen] = useState(false)
  const [shelfAisle, setShelfAisle] = useState('')
  const [shelfRack, setShelfRack] = useState('')
  const [shelfBin, setShelfBin] = useState('')
  const [savingShelf, setSavingShelf] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Deep link ?b=NPBX-...
  useEffect(() => {
    const b = searchParams.get('b')
    if (b) {
      setScanValue(b)
      void lookup(b)
    }
  }, [searchParams])

  const lookup = useCallback(async (raw: string) => {
    const parsed = parseScanInput(raw)
    if (!parsed) {
      toast.error('Enter or scan a carton barcode')
      return
    }
    setLooking(true)
    setNotFound(false)
    setBox(null)
    setMovements([])
    try {
      const found = await findBoxByBarcode(parsed)
      if (!found || found.isDeleted) {
        setNotFound(true)
        toast.error('Box not found')
        return
      }
      setBox(found)
      if (appUser) {
        await writeAuditLog({
          action: 'box_scanned',
          entity: 'box',
          entityId: found.id,
          details: `Scanned box ${found.barcode} — ${found.bookName} (${found.quantity})`,
          performedBy: appUser.uid,
          performedByName: appUser.displayName,
          role: appUser.role,
        })
      }
      try {
        const { data, error } = await supabase
          .from('inventory_movements')
          .select('*')
          .eq('box_id', found.id)
          .order('created_at', { ascending: false })
          .limit(20)
        if (error) throw new Error(error.message)
        setMovements((data ?? []).map((r) => mapMovement(r as Record<string, unknown>)))
      } catch {
        setMovements([])
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Lookup failed')
    } finally {
      setLooking(false)
      setScanValue('')
      inputRef.current?.focus()
    }
  }, [appUser])

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    void lookup(scanValue)
  }

  const warehouse = box ? warehouses.find((w) => w.id === box.warehouseId) : null
  const book = box ? books.find((b) => b.id === box.bookId) : null

  const handlePrint = () => {
    if (!box || !warehouse) return
    try {
      printBoxLabels([
        boxToLabelData(box, warehouse, { author: book?.author, isbn: book?.isbn }),
      ])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Print failed')
    }
  }

  const handleReplenish = async () => {
    if (!appUser || !box) return
    const qty = parseInt(replenishQty, 10)
    if (isNaN(qty) || qty <= 0) {
      toast.error('Enter a valid quantity')
      return
    }
    if (qty >= box.quantity) {
      if (!window.confirm(`This will empty carton ${box.barcode}. Continue?`)) return
    }
    setReplenishing(true)
    try {
      await replenishRetail({
        boxId: box.id,
        quantity: qty,
        bufferWarehouseId: box.warehouseId,
        bookstoreId,
        user: appUser,
      })
      toast.success(`Moved ${qty} to bookstore floor`)
      setReplenishOpen(false)
      // Clear selection and return to ready-to-scan state for the next carton.
      setBox(null)
      setMovements([])
      setScanValue('')
      inputRef.current?.focus()
    } catch (e) {
      toast.error(opsErrorMessage(e, 'Put on sale failed'))
    } finally {
      setReplenishing(false)
    }
  }

  const handleSplit = async () => {
    if (!appUser || !box) return
    const qty = parseInt(splitQty, 10)
    if (isNaN(qty) || qty <= 0) {
      toast.error('Enter a valid quantity')
      return
    }
    setSplitting(true)
    try {
      const result = await splitBox({
        boxId: box.id,
        quantity: qty,
        user: appUser,
      })
      toast.success(`Split to new box ${result.barcode}`)
      setSplitOpen(false)
      await lookup(box.barcode)
    } catch (e) {
      toast.error(opsErrorMessage(e, 'Split failed'))
    } finally {
      setSplitting(false)
    }
  }

  const canReplenish =
    box &&
    box.status !== 'empty' &&
    box.status !== 'in_transit' &&
    box.quantity > 0 &&
    (mode === 'small_warehouse' || mode === 'full_warehouse' || appUser?.role === 'admin' || appUser?.role === 'superadmin') &&
    box.warehouseId !== bookstoreId

  const openPutAway = () => {
    if (!box) return
    const parts = box.shelfLocation?.split('-') ?? []
    setShelfAisle(parts[0] ?? '')
    setShelfRack(parts[1] ?? '')
    setShelfBin(parts[2] ?? '')
    setPutAwayOpen(true)
  }

  const handlePutAway = async () => {
    if (!appUser || !box) return
    const label = buildShelfLabel(shelfAisle, shelfRack, shelfBin)
    if (!shelfAisle.trim()) {
      toast.error('Enter an aisle')
      return
    }
    setSavingShelf(true)
    try {
      await putAwayBox({ boxId: box.id, shelfLocation: label, user: appUser })
      toast.success(`Box put away at ${label}`)
      setPutAwayOpen(false)
      await lookup(box.barcode)
    } catch (e) {
      toast.error(opsErrorMessage(e, 'Put away failed'))
    } finally {
      setSavingShelf(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <ScanBarcode className="h-6 w-6 text-accent-600" />
          Scan a carton
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Camera, USB scanner, or type the code — then Put on sale / Move.
        </p>
      </div>

      <form onSubmit={onSubmit} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <Input
          ref={inputRef}
          label="Box code"
          placeholder="Tap Camera, or type / scan here…"
          value={scanValue}
          onChange={(e) => setScanValue(e.target.value)}
          autoComplete="off"
          autoFocus
          className="text-base"
        />
        <div className="mt-3 flex flex-col sm:flex-row gap-2">
          <Button
            type="button"
            onClick={() => setCameraOpen(true)}
            className="flex-1 min-h-[48px] text-base"
          >
            <Camera className="h-5 w-5 mr-1" />
            Open camera
          </Button>
          <Button type="submit" loading={looking} variant="outline" className="flex-1 min-h-[48px]">
            Look up
          </Button>
        </div>
      </form>

      {notFound && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          No box found for that barcode.
        </div>
      )}

      {box && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-sm text-accent-700 font-semibold">{box.barcode}</p>
              <h2 className="text-lg font-bold text-gray-900 mt-1">{box.bookName}</h2>
              {book?.author && <p className="text-sm text-gray-500">{book.author}</p>}
              {book?.isbn && <p className="text-xs text-gray-400">ISBN: {book.isbn}</p>}
            </div>
            <Badge variant={STATUS_VARIANT[box.status] ?? 'gray'}>{cartonStatusLabel(box.status)}</Badge>
          </div>

          <div className="grid grid-cols-2 gap-4 px-5 py-4 text-sm">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide">Quantity</p>
              <p className="text-2xl font-bold text-gray-900">{box.quantity}</p>
              <p className="text-xs text-gray-400">Initial: {box.initialQuantity}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide">Warehouse</p>
              <p className="font-medium text-gray-900">{warehouse?.name ?? box.warehouseId}</p>
              {box.shelfLocation && (
                <p className="text-xs text-gray-500">Shelf: {box.shelfLocation}</p>
              )}
            </div>
            {box.batchRef && (
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide">Batch</p>
                <p className="font-medium">{box.batchRef}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide">Created</p>
              <p className="font-medium">{formatDateTime(box.createdAt)}</p>
            </div>
          </div>

          <div className="px-5 py-3 border-t border-gray-100 flex flex-wrap gap-2">
            {canReplenish && (
              <Button
                size="sm"
                className="min-h-[44px]"
                onClick={() => {
                  setReplenishQty(String(box.quantity))
                  setReplenishOpen(true)
                }}
              >
                <PackageOpen className="h-4 w-4 mr-1" />
                Put on sale
              </Button>
            )}
            {(mode === 'full_warehouse' || mode === 'small_warehouse') && box.status !== 'in_transit' && (
              <Button
                variant="outline"
                size="sm"
                className="min-h-[44px]"
                onClick={() => navigate(`/warehouse/transfers?boxIds=${encodeURIComponent(box.id)}`)}
              >
                <ArrowRightLeft className="h-4 w-4 mr-1" />
                Send to backroom
              </Button>
            )}
            <Button variant="outline" size="sm" className="min-h-[44px]" onClick={openPutAway}>
              <MapPin className="h-4 w-4 mr-1" />
              {box.shelfLocation ? `Shelf ${box.shelfLocation}` : 'Set shelf'}
            </Button>
            <Button variant="outline" size="sm" className="min-h-[44px]" onClick={handlePrint}>
              <Printer className="h-4 w-4 mr-1" />
              Print label
            </Button>
            {box.status !== 'empty' && box.status !== 'in_transit' && box.quantity > 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSplitQty('')
                  setSplitOpen(true)
                }}
              >
                Split box
              </Button>
            )}
          </div>

          {movements.length > 0 && (
            <div className="border-t border-gray-100 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
                Recent movements
              </p>
              <ul className="space-y-2">
                {movements.map((m) => (
                  <li key={m.id} className="flex justify-between text-sm gap-2">
                    <span className={cn('font-medium', m.quantity < 0 ? 'text-red-600' : 'text-green-700')}>
                      {m.type} ({m.quantity > 0 ? '+' : ''}{m.quantity})
                    </span>
                    <span className="text-gray-400 text-xs shrink-0">{formatDateTime(m.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <Modal open={replenishOpen} onClose={() => setReplenishOpen(false)} title="Put on sale" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Move copies from this box onto the bookstore shelf so they can be sold at the till.
          </p>
          <Input
            label="Quantity"
            type="number"
            min={1}
            max={box?.quantity}
            value={replenishQty}
            onChange={(e) => setReplenishQty(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setReplenishOpen(false)}>Cancel</Button>
            <Button loading={replenishing} onClick={handleReplenish}>Confirm</Button>
          </div>
        </div>
      </Modal>

      <Modal open={splitOpen} onClose={() => setSplitOpen(false)} title="Split Box" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Move <strong>{splitQty ? parseInt(splitQty) || 0 : 0}</strong> of {box?.quantity} copies from{' '}
            <strong>{box?.barcode}</strong> into a new box at the same warehouse.
          </p>
          <Input
            label="Quantity to split off"
            type="number"
            min={1}
            max={box ? box.quantity - 1 : 0}
            value={splitQty}
            onChange={(e) => setSplitQty(e.target.value)}
            hint={splitQty && box ? `${box.quantity - parseInt(splitQty)} will remain in this box` : undefined}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setSplitOpen(false)}>Cancel</Button>
            <Button loading={splitting} onClick={handleSplit}>Split</Button>
          </div>
        </div>
      </Modal>

      <Modal open={putAwayOpen} onClose={() => setPutAwayOpen(false)} title="Put Away Box" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Assign a structured shelf location (aisle-rack-bin) for{' '}
            <strong>{box?.barcode}</strong>.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <Input label="Aisle" placeholder="A" value={shelfAisle} onChange={(e) => setShelfAisle(e.target.value)} />
            <Input label="Rack" placeholder="03" value={shelfRack} onChange={(e) => setShelfRack(e.target.value)} />
            <Input label="Bin" placeholder="12" value={shelfBin} onChange={(e) => setShelfBin(e.target.value)} />
          </div>
          <p className="text-xs text-gray-400">
            Label: <span className="font-mono font-semibold text-accent-700">
              {buildShelfLabel(shelfAisle, shelfRack, shelfBin)}
            </span>
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPutAwayOpen(false)}>Cancel</Button>
            <Button loading={savingShelf} onClick={handlePutAway}>Save location</Button>
          </div>
        </div>
      </Modal>

      {cameraOpen && (
        <CameraScan
          onScan={(value) => {
            setScanValue(value)
            void lookup(value)
          }}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </div>
  )
}
