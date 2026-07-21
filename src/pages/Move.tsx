import { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { ArrowRightLeft, ScanBarcode, Store, Warehouse, Package } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useWarehouse } from '@/contexts/WarehouseContext'
import {
  findBoxByBarcode,
  createAndPickTransfer,
  receiveTransfer,
  replenishRetail,
} from '@/lib/inventoryService'
import { cartonStatusLabel } from '@/lib/roles'
import { opsErrorMessage } from '@/lib/opsErrors'
import type { Box, TransferItem } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import CameraScan from '@/components/CameraScan'
import { cn } from '@/lib/utils'

type Dest = 'warehouse' | 'backroom' | 'store'

export default function Move() {
  const { appUser } = useAuth()
  const {
    primaryWarehouse, bufferWarehouse, bookstoreId, warehouses,
  } = useWarehouse()

  const [barcode, setBarcode] = useState('')
  const [box, setBox] = useState<(Box & { id: string }) | null>(null)
  const [dest, setDest] = useState<Dest>('backroom')
  const [qty, setQty] = useState('')
  const [busy, setBusy] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const primaryId = primaryWarehouse?.id ?? 'wh-primary'
  const bufferId = bufferWarehouse?.id ?? 'wh-buffer'

  const locationName = (id: string) => {
    if (id === primaryId) return 'Warehouse'
    if (id === bufferId) return 'Backroom'
    if (id === bookstoreId) return 'Store'
    return warehouses.find((w) => w.id === id)?.name ?? id
  }

  const lookup = async (code: string) => {
    const trimmed = code.trim()
    if (!trimmed) return
    try {
      const found = await findBoxByBarcode(trimmed)
      if (!found) {
        toast.error('Carton not found')
        setBox(null)
        return
      }
      if (found.status === 'empty' || found.quantity <= 0) {
        toast.error('Carton is empty')
        setBox(null)
        return
      }
      if (found.status === 'in_transit') {
        toast.error('Carton is already in transit — receive it under Transfers')
        setBox(found)
        return
      }
      setBox(found)
      setQty(String(found.quantity))
      // Suggest next hop
      if (found.warehouseId === primaryId) setDest('backroom')
      else if (found.warehouseId === bufferId) setDest('store')
      else setDest('store')
    } catch (e) {
      toast.error(opsErrorMessage(e, 'Lookup failed'))
    }
  }

  const destWarehouseId = dest === 'warehouse' ? primaryId : dest === 'backroom' ? bufferId : null

  const canMove =
    !!appUser &&
    !!box &&
    box.status !== 'in_transit' &&
    box.quantity > 0 &&
    (dest === 'store' || (destWarehouseId && destWarehouseId !== box.warehouseId))

  const handleMove = async () => {
    if (!appUser || !box || !canMove) return
    setBusy(true)
    try {
      if (dest === 'store') {
        const n = parseInt(qty, 10)
        if (!n || n <= 0 || n > box.quantity) {
          toast.error(`Enter 1–${box.quantity} pieces`)
          setBusy(false)
          return
        }
        await replenishRetail({
          boxId: box.id,
          quantity: n,
          bufferWarehouseId: bufferId,
          bookstoreId,
          user: appUser,
        })
        toast.success(`Put ${n} on sale`)
      } else {
        const toId = destWarehouseId!
        const item: TransferItem = {
          boxId: box.id,
          barcode: box.barcode,
          bookId: box.bookId,
          bookName: box.bookName,
          quantity: box.quantity,
          shelfLocation: box.shelfLocation,
        }
        const transferId = await createAndPickTransfer({
          fromWarehouseId: box.warehouseId,
          toWarehouseId: toId,
          items: [item],
          bookstoreId,
          notes: 'Quick move',
        })
        await receiveTransfer({
          transferId,
          bookstoreId,
          user: appUser,
        })
        toast.success(`Moved carton to ${locationName(toId)}`)
      }
      setBox(null)
      setBarcode('')
      setQty('')
      inputRef.current?.focus()
    } catch (e) {
      toast.error(opsErrorMessage(e, 'Move failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <ArrowRightLeft className="h-6 w-6 text-accent-600" />
          Move
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Scan a carton → Warehouse, Backroom, or put pieces on sale for POS
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            label="Carton barcode"
            placeholder="Scan or type NPBX-…"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void lookup(barcode)
              }
            }}
            autoFocus
          />
          <div className="flex flex-col gap-2 pt-6">
            <Button type="button" variant="outline" onClick={() => void lookup(barcode)}>
              Find
            </Button>
            <Button type="button" variant="outline" onClick={() => setCameraOpen(true)}>
              <ScanBarcode className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {box && (
          <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-sm font-semibold text-gray-900">{box.barcode}</p>
              <Badge variant={box.status === 'sealed' ? 'green' : 'yellow'}>
                {cartonStatusLabel(box.status)}
              </Badge>
            </div>
            <p className="text-sm text-gray-800">{box.bookName}</p>
            <p className="text-xs text-gray-500">
              {box.quantity} pcs · now at <span className="font-medium text-gray-700">{locationName(box.warehouseId)}</span>
            </p>
          </div>
        )}
      </div>

      {box && box.status !== 'in_transit' && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
          <p className="text-sm font-medium text-gray-700">Send to</p>
          <div className="grid grid-cols-3 gap-2">
            {([
              { id: 'warehouse' as const, label: 'Warehouse', icon: Warehouse, disabled: box.warehouseId === primaryId },
              { id: 'backroom' as const, label: 'Backroom', icon: Package, disabled: box.warehouseId === bufferId },
              { id: 'store' as const, label: 'Store sale', icon: Store, disabled: false },
            ]).map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={opt.disabled}
                onClick={() => setDest(opt.id)}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-xs font-medium transition',
                  opt.disabled && 'opacity-40 cursor-not-allowed',
                  dest === opt.id
                    ? 'border-accent-500 bg-accent-50 text-accent-800'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50',
                )}
              >
                <opt.icon className="h-5 w-5" />
                {opt.label}
              </button>
            ))}
          </div>

          {dest === 'store' && (
            <Input
              label="Pieces to put on sale"
              type="number"
              min={1}
              max={box.quantity}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              hint={`Max ${box.quantity} (opens carton if sealed)`}
            />
          )}

          <Button className="w-full" loading={busy} disabled={!canMove || busy} onClick={() => void handleMove()}>
            {dest === 'store' ? 'Put on sale' : `Move carton to ${dest === 'warehouse' ? 'Warehouse' : 'Backroom'}`}
          </Button>
        </div>
      )}

      <p className="text-xs text-gray-400 text-center">
        Need a multi-carton shipment? Use{' '}
        <a href="/warehouse/transfers" className="text-accent-700 hover:underline">Transfers</a>.
      </p>

      {cameraOpen && (
        <CameraScan
          onClose={() => setCameraOpen(false)}
          onScan={(code) => {
            setCameraOpen(false)
            setBarcode(code)
            void lookup(code)
          }}
        />
      )}
    </div>
  )
}
