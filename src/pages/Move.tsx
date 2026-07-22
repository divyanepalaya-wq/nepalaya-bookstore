import { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { ArrowRightLeft, ScanBarcode, Package } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useWarehouse } from '@/contexts/WarehouseContext'
import {
  findBoxByBarcode,
  createAndPickTransfer,
  receiveTransfer,
} from '@/lib/inventoryService'
import { cartonStatusLabel } from '@/lib/roles'
import { opsErrorMessage } from '@/lib/opsErrors'
import type { Box, TransferItem } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import CameraScan from '@/components/CameraScan'

/** Warehouse: scan carton → send to backroom (one tap). */
export default function Move() {
  const { appUser } = useAuth()
  const { primaryWarehouse, bufferWarehouse, bookstoreId } = useWarehouse()

  const [barcode, setBarcode] = useState('')
  const [box, setBox] = useState<(Box & { id: string }) | null>(null)
  const [busy, setBusy] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const primaryId = primaryWarehouse?.id ?? 'wh-primary'
  const bufferId = bufferWarehouse?.id ?? 'wh-buffer'

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
        toast.error('Already in transit')
        setBox(found)
        return
      }
      if (found.warehouseId === bufferId) {
        toast.error('Already in backroom')
      }
      setBox(found)
    } catch (e) {
      toast.error(opsErrorMessage(e, 'Lookup failed'))
    }
  }

  const canSend =
    !!appUser &&
    !!box &&
    box.status !== 'in_transit' &&
    box.quantity > 0 &&
    box.warehouseId !== bufferId

  const handleSend = async () => {
    if (!appUser || !box || !canSend) return
    setBusy(true)
    try {
      const item: TransferItem = {
        boxId: box.id,
        barcode: box.barcode,
        bookId: box.bookId,
        bookName: box.bookName,
        quantity: box.quantity,
        shelfLocation: box.shelfLocation,
      }
      const fromId = box.warehouseId || primaryId
      const transferId = await createAndPickTransfer({
        fromWarehouseId: fromId,
        toWarehouseId: bufferId,
        items: [item],
        bookstoreId,
        notes: 'Move to backroom',
      })
      await receiveTransfer({ transferId, bookstoreId, user: appUser })
      toast.success('Sent to backroom · ब्याक रुममा पठाइयो')
      setBox(null)
      setBarcode('')
      inputRef.current?.focus()
    } catch (e) {
      toast.error(opsErrorMessage(e, 'Move failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ArrowRightLeft className="h-7 w-7 text-accent-600" />
          Move
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Warehouse → Backroom · ब्याक रुममा पठाउनुहोस्
        </p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            label="Carton barcode"
            className="min-h-12 text-base"
            placeholder="Scan or type…"
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
            <Button type="button" size="lg" variant="outline" className="min-h-12" onClick={() => void lookup(barcode)}>
              Find
            </Button>
            <Button type="button" size="lg" variant="outline" className="min-h-12" onClick={() => setCameraOpen(true)}>
              <ScanBarcode className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {box && (
          <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 space-y-1">
            <div className="flex justify-between gap-2">
              <p className="font-mono text-sm font-semibold">{box.barcode}</p>
              <Badge variant={box.status === 'sealed' ? 'green' : 'yellow'}>{cartonStatusLabel(box.status)}</Badge>
            </div>
            <p className="text-lg font-semibold text-gray-900">{box.bookName}</p>
            <p className="text-sm text-gray-500">{box.quantity} pcs</p>
          </div>
        )}
      </div>

      {box && box.status !== 'in_transit' && (
        <Button
          size="lg"
          className="w-full min-h-16 text-lg"
          loading={busy}
          disabled={!canSend || busy}
          onClick={() => void handleSend()}
        >
          <Package className="h-6 w-6" />
          Send to backroom
        </Button>
      )}

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
