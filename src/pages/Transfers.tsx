import { useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowRightLeft, Plus, Check, X, Truck, Camera, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { mapBox, mapTransfer } from '@/lib/mappers'
import { useAuth } from '@/contexts/AuthContext'
import { useWarehouse } from '@/contexts/WarehouseContext'
import {
  createTransfer, createAndPickTransfer, pickTransfer, receiveTransfer, cancelTransfer, findBoxByBarcode,
} from '@/lib/inventoryService'
import { parseScanInput } from '@/lib/barcode'
import { opsErrorMessage } from '@/lib/opsErrors'
import { formatDateTime, cn } from '@/lib/utils'
import { cartonStatusLabel, transferStatusLabel } from '@/lib/roles'
import type { Transfer, TransferItem, TransferStatus } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner } from '@/components/ui/Spinner'
import CameraScan from '@/components/CameraScan'

const STATUS_BADGE: Record<TransferStatus, 'gray' | 'blue' | 'orange' | 'green' | 'red'> = {
  draft: 'gray',
  picked: 'blue',
  in_transit: 'orange',
  received: 'green',
  cancelled: 'red',
}

export default function Transfers() {
  const { appUser } = useAuth()
  const { warehouses, bookstoreId, primaryWarehouse, bufferWarehouse } = useWarehouse()
  const [searchParams] = useSearchParams()
  const scanRef = useRef<HTMLInputElement>(null)

  const [transfers, setTransfers] = useState<(Transfer & { id: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [fromId, setFromId] = useState(primaryWarehouse?.id ?? '')
  const [toId, setToId] = useState(bufferWarehouse?.id ?? '')
  const [notes, setNotes] = useState('')
  const [scanInput, setScanInput] = useState('')
  const [items, setItems] = useState<TransferItem[]>([])
  const [sending, setSending] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [actionId, setActionId] = useState<string | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    if (primaryWarehouse && !fromId) setFromId(primaryWarehouse.id)
    if (bufferWarehouse && !toId) setToId(bufferWarehouse.id)
  }, [primaryWarehouse?.id, bufferWarehouse?.id])

  useEffect(() => {
    const barcode = searchParams.get('b')
    if (barcode) {
      setScanInput(barcode)
      setCreateOpen(true)
    }
  }, [searchParams.get('b')])

  /** Add cartons (from a deep-link) to the draft by box id, skipping ones already added. */
  const addBoxesByIds = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return
    try {
      const { data, error } = await supabase.from('boxes').select('*').in('id', ids)
      if (error) throw new Error(error.message)
      const boxes = (data ?? [])
        .map((r) => mapBox(r as Record<string, unknown>))
        .filter((b) => !b.isDeleted && b.quantity > 0 && b.status !== 'in_transit' && b.status !== 'empty')
      if (boxes.length === 0) {
        toast.error('No eligible cartons found for that link')
        return
      }
      setFromId(boxes[0].warehouseId)
      setItems((prev) => {
        const existing = new Set(prev.map((i) => i.boxId))
        const additions = boxes
          .filter((b) => !existing.has(b.id))
          .map((box) => ({
            boxId: box.id,
            barcode: box.barcode,
            bookId: box.bookId,
            bookName: box.bookName,
            quantity: box.quantity,
            shelfLocation: box.shelfLocation || undefined,
          }))
        return [...prev, ...additions]
      })
      toast.success(`Added ${boxes.length} carton(s) from Receive`)
    } catch (e) {
      toast.error(opsErrorMessage(e, 'Failed to load cartons'))
    }
  }, [])

  /** Add cartons (from a deep-link) to the draft by barcode. */
  const addBoxesByBarcodes = useCallback(async (barcodes: string[]) => {
    if (barcodes.length === 0) return
    const boxes = (await Promise.all(barcodes.map((b) => findBoxByBarcode(b).catch(() => null))))
      .filter((b): b is NonNullable<typeof b> => !!b && !b.isDeleted && b.quantity > 0 && b.status !== 'in_transit' && b.status !== 'empty')
    if (boxes.length === 0) {
      toast.error('No eligible cartons found for that link')
      return
    }
    setFromId(boxes[0].warehouseId)
    setItems((prev) => {
      const existing = new Set(prev.map((i) => i.boxId))
      const additions = boxes
        .filter((b) => !existing.has(b.id))
        .map((box) => ({
          boxId: box.id,
          barcode: box.barcode,
          bookId: box.bookId,
          bookName: box.bookName,
          quantity: box.quantity,
          shelfLocation: box.shelfLocation || undefined,
        }))
      return [...prev, ...additions]
    })
    toast.success(`Added ${boxes.length} carton(s)`)
  }, [])

  // Deep-link preselected cartons from Receive / Scan: ?boxIds=id1,id2 or ?boxes=BARCODE1,BARCODE2
  useEffect(() => {
    const boxIds = searchParams.get('boxIds')
    const barcodes = searchParams.get('boxes')
    if (boxIds) {
      setCreateOpen(true)
      void addBoxesByIds(boxIds.split(',').map((s) => s.trim()).filter(Boolean))
    } else if (barcodes) {
      setCreateOpen(true)
      void addBoxesByBarcodes(barcodes.split(',').map((s) => s.trim()).filter(Boolean))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get('boxIds'), searchParams.get('boxes')])

  const loadTransfers = useCallback(async () => {
    setLoadError(false)
    const { data, error } = await supabase
      .from('transfers')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) {
      setLoadError(true)
      toast.error(opsErrorMessage(error, 'Failed to load transfers'))
      setLoading(false)
      return
    }
    setTransfers((data ?? []).map((r) => mapTransfer(r as Record<string, unknown>)))
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadTransfers()
    const channel = supabase
      .channel('transfers-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transfers' }, () => void loadTransfers())
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [loadTransfers])

  useEffect(() => {
    if (createOpen) {
      const t = setTimeout(() => scanRef.current?.focus(), 100)
      return () => clearTimeout(t)
    }
  }, [createOpen])

  const warehouseOptions = warehouses.map((w) => ({
    value: w.id,
    label: w.type === 'primary_warehouse'
      ? 'Main Warehouse'
      : w.type === 'buffer_warehouse'
        ? 'Backroom'
        : w.type === 'bookstore'
          ? 'Bookstore Floor'
          : `${w.name} (${w.code})`,
  }))

  const addBox = useCallback(async (raw: string) => {
    const parsed = parseScanInput(raw)
    if (!parsed) {
      toast.error('Scan or enter a carton barcode')
      return
    }
    setAdding(true)
    try {
      const box = await findBoxByBarcode(parsed)
      if (!box) {
        toast.error('Carton not found')
        return
      }
      if (box.warehouseId !== fromId) {
        toast.error('Carton is not at the “From” location')
        return
      }
      if (box.status === 'in_transit' || box.status === 'empty') {
        toast.error(`Carton is ${cartonStatusLabel(box.status)}`)
        return
      }
      if (items.some((i) => i.boxId === box.id)) {
        toast.error('Already added')
        return
      }
      setItems((prev) => [
        ...prev,
        {
          boxId: box.id,
          barcode: box.barcode,
          bookId: box.bookId,
          bookName: box.bookName,
          quantity: box.quantity,
          shelfLocation: box.shelfLocation || undefined,
        },
      ])
      setScanInput('')
      toast.success(`Added ${box.barcode}`)
      scanRef.current?.focus()
    } catch (e) {
      toast.error(opsErrorMessage(e, 'Failed to add carton'))
    } finally {
      setAdding(false)
    }
  }, [fromId, items])

  const onCameraScan = (value: string) => {
    setCameraOpen(false)
    setScanInput(value)
    void addBox(value)
  }

  const addAvailableBoxes = async () => {
    if (!fromId) return
    try {
      const { data, error } = await supabase
        .from('boxes')
        .select('*')
        .eq('warehouse_id', fromId)
        .in('status', ['sealed', 'open'])
        .limit(50)
      if (error) throw new Error(error.message)
      const existing = new Set(items.map((i) => i.boxId))
      const added: TransferItem[] = []
      ;(data ?? []).forEach((r) => {
        const box = mapBox(r as Record<string, unknown>)
        if (existing.has(box.id) || box.isDeleted || box.quantity <= 0) return
        added.push({
          boxId: box.id,
          barcode: box.barcode,
          bookId: box.bookId,
          bookName: box.bookName,
          quantity: box.quantity,
          shelfLocation: box.shelfLocation || undefined,
        })
      })
      if (added.length === 0) {
        toast('No more cartons at source', { icon: '📦' })
        return
      }
      setItems((prev) => [...prev, ...added])
      toast.success(`Added ${added.length} carton(s)`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Query failed — scan cartons one by one')
    }
  }

  /** Primary action: create the transfer and pick it immediately — cartons leave the source now. */
  const handleSend = async () => {
    if (!appUser) return
    if (!fromId || !toId) {
      toast.error('Select From and To')
      return
    }
    if (items.length === 0) {
      toast.error('Add at least one carton')
      return
    }
    if (!window.confirm(`Send ${items.length} carton(s) now? They'll leave ${whName(fromId)} immediately.`)) return
    setSending(true)
    try {
      await createAndPickTransfer({
        fromWarehouseId: fromId,
        toWarehouseId: toId,
        items,
        bookstoreId,
        notes: notes.trim() || undefined,
      })
      toast.success('Sent — on the way')
      setCreateOpen(false)
      setItems([])
      setNotes('')
    } catch (e) {
      toast.error(opsErrorMessage(e, 'Send failed'))
    } finally {
      setSending(false)
    }
  }

  /** Secondary action: save as a draft to send later. */
  const handleSaveDraft = async () => {
    if (!appUser) return
    if (!fromId || !toId) {
      toast.error('Select From and To')
      return
    }
    if (items.length === 0) {
      toast.error('Add at least one carton')
      return
    }
    setSavingDraft(true)
    try {
      await createTransfer({
        fromWarehouseId: fromId,
        toWarehouseId: toId,
        items,
        notes: notes.trim() || undefined,
        user: appUser,
      })
      toast.success('Draft saved — tap Send when ready')
      setCreateOpen(false)
      setItems([])
      setNotes('')
    } catch (e) {
      toast.error(opsErrorMessage(e, 'Save draft failed'))
    } finally {
      setSavingDraft(false)
    }
  }

  const CONFIRM_MESSAGES: Record<'pick' | 'receive' | 'cancel', string> = {
    pick: 'Send this transfer? Cartons will leave the source location now.',
    receive: 'Confirm these cartons have arrived and been received here?',
    cancel: 'Cancel this draft transfer?',
  }

  const runAction = async (id: string, action: 'pick' | 'receive' | 'cancel') => {
    if (!appUser) return
    if (!window.confirm(CONFIRM_MESSAGES[action])) return
    setActionId(id)
    try {
      if (action === 'pick') await pickTransfer({ transferId: id, bookstoreId, user: appUser })
      else if (action === 'receive') await receiveTransfer({ transferId: id, bookstoreId, user: appUser })
      else await cancelTransfer({ transferId: id, user: appUser })
      toast.success(
        action === 'pick' ? 'Sent — on the way' : action === 'receive' ? 'Received at destination' : 'Cancelled',
      )
    } catch (e) {
      toast.error(opsErrorMessage(e, 'Action failed'))
    } finally {
      setActionId(null)
    }
  }

  const whName = (id: string) => {
    const w = warehouses.find((x) => x.id === id)
    if (!w) return id
    if (w.type === 'primary_warehouse') return 'Main Warehouse'
    if (w.type === 'buffer_warehouse') return 'Backroom'
    if (w.type === 'bookstore') return 'Bookstore Floor'
    return w.name
  }

  if (loading) return <PageSpinner />

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <ArrowRightLeft className="h-6 w-6 text-accent-600" />
            Transfers
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Move cartons · usually Main Warehouse → Backroom
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="min-h-[44px]">
          <Plus className="h-4 w-4" />
          New transfer
        </Button>
      </div>

      {loadError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-sm text-red-700">Couldn't load transfers.</p>
          <Button size="sm" variant="outline" onClick={() => void loadTransfers()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </Button>
        </div>
      )}

      <div className="space-y-3">
        {transfers.map((t) => (
          <div key={t.id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Badge variant={STATUS_BADGE[t.status]}>{transferStatusLabel(t.status)}</Badge>
                  <span className="text-xs text-gray-400">{formatDateTime(t.createdAt)}</span>
                </div>
                <p className="mt-1 font-medium text-gray-900">
                  {whName(t.fromWarehouseId)}
                  <span className="text-gray-400 mx-2">→</span>
                  {whName(t.toWarehouseId)}
                </p>
                <p className="text-sm text-gray-500">
                  {t.items?.length ?? 0} carton(s) · {t.createdByName}
                </p>
                {t.notes && <p className="text-xs text-gray-400 mt-1">{t.notes}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                {t.status === 'draft' && (
                  <>
                    <Button
                      size="sm"
                      className="min-h-[40px]"
                      loading={actionId === t.id}
                      onClick={() => runAction(t.id, 'pick')}
                    >
                      <Truck className="h-4 w-4" />
                      Send
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      loading={actionId === t.id}
                      onClick={() => runAction(t.id, 'cancel')}
                    >
                      <X className="h-4 w-4" />
                      Cancel
                    </Button>
                  </>
                )}
                {(t.status === 'in_transit' || t.status === 'picked') && (
                  <Button
                    size="sm"
                    className="min-h-[40px]"
                    loading={actionId === t.id}
                    onClick={() => runAction(t.id, 'receive')}
                  >
                    <Check className="h-4 w-4" />
                    Receive here
                  </Button>
                )}
              </div>
            </div>
            {t.items?.length > 0 && (
              <ul className="mt-3 border-t border-gray-100 pt-2 space-y-1">
                {[...t.items]
                  .sort((a, b) => (a.shelfLocation ?? '').localeCompare(b.shelfLocation ?? ''))
                  .map((item) => (
                    <li key={item.boxId} className={cn('flex justify-between text-xs font-mono text-gray-600')}>
                      <span className="truncate">
                        {item.shelfLocation && (
                          <span className="text-accent-600 font-semibold mr-1">{item.shelfLocation}</span>
                        )}
                        {item.barcode} — {item.bookName}
                      </span>
                      <span className="shrink-0">×{item.quantity}</span>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        ))}
        {transfers.length === 0 && (
          <p className="text-center text-gray-400 py-8 text-sm">
            No transfers yet. Create one to move cartons Main → Backroom.
          </p>
        )}
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Move cartons" size="lg">
        <div className="space-y-4">
          <p className="text-xs text-gray-500 leading-relaxed">
            1) Choose From → To · 2) Scan cartons · 3) Tap <strong>Send</strong> to ship now, or <strong>Save draft</strong> to pack later
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="From"
              options={warehouseOptions}
              value={fromId}
              onChange={(e) => { setFromId(e.target.value); setItems([]) }}
            />
            <Select
              label="To"
              options={warehouseOptions.filter((o) => o.value !== fromId)}
              value={toId}
              onChange={(e) => setToId(e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">Add cartons</label>
            <div className="flex gap-2 mt-1">
              <Input
                ref={scanRef}
                placeholder="Scan or type barcode…"
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void addBox(scanInput)
                  }
                }}
                autoComplete="off"
                className="text-base"
              />
              <Button
                type="button"
                variant="outline"
                loading={adding}
                onClick={() => void addBox(scanInput)}
                className="shrink-0 min-h-[42px]"
              >
                Add
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => setCameraOpen(true)}
                className="min-h-[44px] flex-1 sm:flex-none"
              >
                <Camera className="h-4 w-4" />
                Open camera
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-[44px]"
                onClick={() => void addAvailableBoxes()}
              >
                Add all at source
              </Button>
            </div>
          </div>

          {items.length > 0 && (
            <ul className="max-h-48 overflow-y-auto border border-gray-100 rounded-lg divide-y text-sm">
              {[...items]
                .sort((a, b) => (a.shelfLocation ?? '').localeCompare(b.shelfLocation ?? ''))
                .map((item) => (
                  <li key={item.boxId} className="flex justify-between items-center gap-2 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-accent-700">{item.barcode}</p>
                      <p className="truncate text-gray-800">{item.bookName} · ×{item.quantity}</p>
                    </div>
                    <button
                      type="button"
                      className="text-red-500 text-xs font-medium shrink-0 px-2 py-1"
                      onClick={() => setItems((p) => p.filter((i) => i.boxId !== item.boxId))}
                    >
                      Remove
                    </button>
                  </li>
                ))}
            </ul>
          )}

          <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={sending || savingDraft}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              loading={savingDraft}
              disabled={items.length === 0 || sending}
              onClick={() => void handleSaveDraft()}
            >
              Save draft
            </Button>
            <Button
              loading={sending}
              disabled={items.length === 0 || savingDraft}
              onClick={() => void handleSend()}
            >
              <Truck className="h-4 w-4" />
              Send ({items.length})
            </Button>
          </div>
        </div>
      </Modal>

      {cameraOpen && (
        <CameraScan
          onScan={onCameraScan}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </div>
  )
}
