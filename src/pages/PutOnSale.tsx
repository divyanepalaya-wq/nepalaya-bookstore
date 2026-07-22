import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Store, ScanBarcode } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useWarehouse } from '@/contexts/WarehouseContext'
import { findBoxByBarcode, replenishRetail } from '@/lib/inventoryService'
import { cartonStatusLabel } from '@/lib/roles'
import { opsErrorMessage } from '@/lib/opsErrors'
import type { Box } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import CameraScan from '@/components/CameraScan'

/** Store: scan backroom carton → put pieces on shelf. */
export default function PutOnSale() {
  const { appUser } = useAuth()
  const { bufferWarehouse, bookstoreId } = useWarehouse()
  const [params] = useSearchParams()
  const [barcode, setBarcode] = useState(params.get('box') ?? '')
  const [box, setBox] = useState<(Box & { id: string }) | null>(null)
  const [qty, setQty] = useState('')
  const [busy, setBusy] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const bufferId = bufferWarehouse?.id ?? 'wh-buffer'

  const lookup = async (code: string) => {
    const trimmed = code.trim()
    if (!trimmed) return
    try {
      const found = await findBoxByBarcode(trimmed)
      if (!found || found.quantity <= 0) {
        toast.error('Carton not found or empty')
        setBox(null)
        return
      }
      setBox(found)
      setQty(String(found.quantity))
      if (found.warehouseId !== bufferId) {
        toast('Carton is not in backroom — you can still put pieces on sale', { icon: 'ℹ️' })
      }
    } catch (e) {
      toast.error(opsErrorMessage(e, 'Lookup failed'))
    }
  }

  useEffect(() => {
    const pre = params.get('box')
    if (pre) void lookup(pre)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handlePut = async () => {
    if (!appUser || !box) return
    const n = parseInt(qty, 10)
    if (!n || n <= 0 || n > box.quantity) {
      toast.error(`Enter 1–${box.quantity}`)
      return
    }
    setBusy(true)
    try {
      await replenishRetail({
        boxId: box.id,
        quantity: n,
        bufferWarehouseId: bufferId,
        bookstoreId,
        user: appUser,
      })
      toast.success(`Put ${n} on shelf`)
      setBox(null)
      setBarcode('')
      setQty('')
      inputRef.current?.focus()
    } catch (e) {
      toast.error(opsErrorMessage(e, 'Failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Store className="h-7 w-7 text-green-600" />
          Put on sale
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Backroom → shelf · सेल्फमा राख्नुहोस्
        </p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            label="Carton barcode"
            className="min-h-12 text-base"
            placeholder="Scan NPBX-…"
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
            <p className="text-base font-semibold text-gray-900">{box.bookName}</p>
            <p className="text-sm text-gray-500">{box.quantity} pcs in carton</p>
          </div>
        )}
      </div>

      {box && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-4">
          <Input
            label="Pieces to put on shelf"
            type="number"
            min={1}
            max={box.quantity}
            className="min-h-14 text-2xl font-bold"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
          <Button
            size="lg"
            className="w-full min-h-14 text-lg"
            loading={busy}
            disabled={busy}
            onClick={() => void handlePut()}
          >
            Put on shelf
          </Button>
        </div>
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
