import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Send, ScanBarcode, Package, Store, Keyboard } from 'lucide-react'
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

type Dest = 'backroom' | 'store'

/**
 * Send = scan + move.
 * Supports camera scan + USB/wedge barcode scanners (auto-submit on Enter).
 */
export default function SendPage() {
  const { appUser } = useAuth()
  const { primaryWarehouse, bufferWarehouse, bookstoreId } = useWarehouse()
  const [barcode, setBarcode] = useState('')
  const [box, setBox] = useState<(Box & { id: string }) | null>(null)
  const [dest, setDest] = useState<Dest>('backroom')
  const [qty, setQty] = useState('')
  const [busy, setBusy] = useState(false)
  const [looking, setLooking] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [lastLine, setLastLine] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const scanBuf = useRef('')
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const primaryId = primaryWarehouse?.id ?? 'wh-primary'
  const bufferId = bufferWarehouse?.id ?? 'wh-buffer'

  const lookup = async (code: string) => {
    const trimmed = code.trim()
    if (!trimmed) return
    setLooking(true)
    setBarcode(trimmed)
    try {
      const found = await findBoxByBarcode(trimmed)
      if (!found || found.quantity <= 0) {
        toast.error('Carton not found or empty')
        setBox(null)
        return
      }
      if (found.status === 'in_transit') {
        toast.error('Carton already in transit')
        setBox(found)
        return
      }
      setBox(found)
      setQty(String(found.quantity))
      if (found.warehouseId === primaryId) setDest('backroom')
      else setDest('store')
      toast.success(`Found · ${found.bookName}`)
    } catch (e) {
      toast.error(opsErrorMessage(e, 'Lookup failed'))
    } finally {
      setLooking(false)
      inputRef.current?.select()
    }
  }

  // USB / Bluetooth wedge scanners type very fast then often send Enter.
  // Also catch rapid key bursts when focus isn't on the input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (cameraOpen || busy) return
      const el = e.target as HTMLElement | null
      const typingInField =
        el &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
      if (typingInField && el !== inputRef.current) return

      if (e.key === 'Enter') {
        if (scanBuf.current.length >= 3) {
          e.preventDefault()
          const code = scanBuf.current
          scanBuf.current = ''
          void lookup(code)
        }
        return
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!typingInField || el === inputRef.current) {
          scanBuf.current += e.key
          if (scanTimer.current) clearTimeout(scanTimer.current)
          scanTimer.current = setTimeout(() => {
            scanBuf.current = ''
          }, 80)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (scanTimer.current) clearTimeout(scanTimer.current)
    }
  }, [cameraOpen, busy, primaryId])

  const handleSend = async () => {
    if (!appUser || !box) return
    setBusy(true)
    try {
      if (dest === 'backroom') {
        if (box.warehouseId === bufferId) {
          toast.error('Already in backroom')
          setBusy(false)
          return
        }
        const item: TransferItem = {
          boxId: box.id,
          barcode: box.barcode,
          bookId: box.bookId,
          bookName: box.bookName,
          quantity: box.quantity,
          shelfLocation: box.shelfLocation,
        }
        const transferId = await createAndPickTransfer({
          fromWarehouseId: box.warehouseId || primaryId,
          toWarehouseId: bufferId,
          items: [item],
          bookstoreId,
          notes: 'Send to backroom',
        })
        await receiveTransfer({ transferId, bookstoreId, user: appUser })
        setLastLine(`I took ${box.barcode} (${box.bookName}, ${box.quantity} pcs) → backroom`)
        toast.success('→ Backroom')
      } else {
        const n = parseInt(qty, 10)
        if (!n || n <= 0 || n > box.quantity) {
          toast.error(`Enter 1–${box.quantity} pcs`)
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
        setLastLine(`I put ${n} pcs of ${box.bookName} on store shelf`)
        toast.success('→ Shelf')
      }
      setBox(null)
      setBarcode('')
      setQty('')
      inputRef.current?.focus()
    } catch (e) {
      toast.error(opsErrorMessage(e, 'Send failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Send className="h-7 w-7 text-accent-600" />
          Send
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Scan carton → backroom or shelf
        </p>
      </div>

      {lastLine && (
        <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
          {lastLine}
        </div>
      )}

      <Button
        type="button"
        size="lg"
        className="w-full min-h-16 text-lg"
        onClick={() => setCameraOpen(true)}
      >
        <ScanBarcode className="h-6 w-6" /> Open camera scanner
      </Button>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1.5">
          <Keyboard className="h-3.5 w-3.5" /> Or type / USB scan
        </p>
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            className="min-h-14 text-lg font-mono tracking-wide"
            placeholder="NPBX-…"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void lookup(barcode)
              }
            }}
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <Button
            type="button"
            size="lg"
            variant="outline"
            className="min-h-14 px-5 shrink-0"
            loading={looking}
            onClick={() => void lookup(barcode)}
          >
            Find
          </Button>
        </div>

        {box && (
          <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 space-y-1">
            <div className="flex justify-between gap-2">
              <p className="font-mono text-sm font-semibold">{box.barcode}</p>
              <Badge variant={box.status === 'sealed' ? 'green' : 'yellow'}>{cartonStatusLabel(box.status)}</Badge>
            </div>
            <p className="text-lg font-semibold text-gray-900">{box.bookName}</p>
            <p className="text-sm text-gray-500">{box.quantity} pcs in carton</p>
          </div>
        )}
      </div>

      {box && box.status !== 'in_transit' && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-4">
          <p className="text-sm font-semibold text-gray-700">Send to</p>
          <div className="grid grid-cols-2 gap-3">
            {([
              { id: 'backroom' as const, label: 'Backroom', sub: 'Whole carton', icon: Package },
              { id: 'store' as const, label: 'Store shelf', sub: 'Some pieces', icon: Store },
            ]).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setDest(opt.id)}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-2xl border px-3 py-4 text-sm font-semibold transition',
                  dest === opt.id
                    ? 'border-accent-500 bg-accent-50 text-accent-900'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50',
                )}
              >
                <opt.icon className="h-6 w-6" />
                {opt.label}
                <span className="text-[11px] font-normal text-gray-500">{opt.sub}</span>
              </button>
            ))}
          </div>

          {dest === 'store' && (
            <Input
              label="Pieces onto shelf"
              type="number"
              min={1}
              max={box.quantity}
              className="min-h-14 text-2xl font-bold"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          )}

          <Button
            size="lg"
            className="w-full min-h-14 text-lg"
            loading={busy}
            disabled={busy}
            onClick={() => void handleSend()}
          >
            {dest === 'backroom' ? 'Send carton to backroom' : 'Put pieces on shelf'}
          </Button>
        </div>
      )}

      {cameraOpen && (
        <CameraScan
          onClose={() => {
            setCameraOpen(false)
            inputRef.current?.focus()
          }}
          onScan={(code) => {
            setCameraOpen(false)
            void lookup(code)
          }}
        />
      )}
    </div>
  )
}
