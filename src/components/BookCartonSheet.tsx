import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Trash2, Save } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useWarehouse } from '@/contexts/WarehouseContext'
import { receiveBoxes, voidCarton, applyInventoryDelta } from '@/lib/inventoryService'
import { opsErrorMessage } from '@/lib/opsErrors'
import { cartonStatusLabel } from '@/lib/roles'
import { toMillis, cn } from '@/lib/utils'
import type { Box, Book } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'

type Props = {
  book: Book
  boxes: (Box & { id: string })[]
  canEdit: boolean
  onChanged: () => void
}

/** Parse carton # from batch_ref like "C1" / "1" */
export function cartonNumber(b: Box, fallbackIndex: number): number {
  const raw = (b.batchRef || '').trim()
  const m = raw.match(/^C?(\d+)$/i)
  if (m) return Number(m[1])
  return fallbackIndex
}

/**
 * Excel-style carton sheet for one book:
 * Carton # | ID (barcode) | Pcs
 */
export function BookCartonSheet({ book, boxes, canEdit, onChanged }: Props) {
  const { appUser } = useAuth()
  const { primaryWarehouse, bookstoreId } = useWarehouse()
  const [busy, setBusy] = useState(false)
  const [newNo, setNewNo] = useState('')
  const [newPcs, setNewPcs] = useState('')
  const [editQty, setEditQty] = useState<Record<string, string>>({})

  const rows = useMemo(() => {
    const sorted = [...boxes].sort((a, b) => {
      const na = cartonNumber(a, 0)
      const nb = cartonNumber(b, 0)
      if (na && nb && na !== nb) return na - nb
      return toMillis(a.createdAt) - toMillis(b.createdAt)
    })
    return sorted.map((b, i) => ({
      box: b,
      no: cartonNumber(b, i + 1),
    }))
  }, [boxes])

  const totalPcs = rows.reduce((s, r) => s + r.box.quantity, 0)
  const nextNo = useMemo(() => {
    const max = rows.reduce((m, r) => Math.max(m, r.no), 0)
    return max + 1
  }, [rows])

  const addCarton = async () => {
    if (!appUser || !primaryWarehouse) return
    const no = parseInt(newNo.trim() || String(nextNo), 10)
    const pcs = parseInt(newPcs.trim(), 10)
    if (!no || no < 1) {
      toast.error('Carton number required')
      return
    }
    if (!pcs || pcs < 1) {
      toast.error('Enter how many books in this carton')
      return
    }
    if (rows.some((r) => r.no === no)) {
      toast.error(`Carton #${no} already exists`)
      return
    }
    setBusy(true)
    try {
      await receiveBoxes({
        bookId: book.id,
        bookName: book.name,
        warehouseId: primaryWarehouse.id,
        warehouseCode: primaryWarehouse.code || 'PW',
        bookstoreId,
        totalQuantity: pcs,
        copiesPerBox: pcs,
        batchRef: `C${no}`,
        notes: `Carton ${no}`,
        user: appUser,
      })
      toast.success(`Carton #${no} · ${pcs} pcs`)
      setNewNo('')
      setNewPcs('')
      onChanged()
    } catch (e) {
      toast.error(opsErrorMessage(e, 'Could not add carton'))
    } finally {
      setBusy(false)
    }
  }

  const saveQty = async (box: Box & { id: string }) => {
    if (!appUser) return
    const raw = editQty[box.id]
    if (raw == null || raw === '') return
    const next = parseInt(raw, 10)
    if (!Number.isFinite(next) || next < 0) {
      toast.error('Invalid quantity')
      return
    }
    if (next === box.quantity) return
    if (next === 0) {
      if (!confirm(`Set carton to 0? This voids the carton.`)) return
      setBusy(true)
      try {
        await voidCarton({ boxId: box.id, bookstoreId, reason: 'Qty set to 0', user: appUser })
        toast.success('Carton removed')
        onChanged()
      } catch (e) {
        toast.error(opsErrorMessage(e, 'Could not void'))
      } finally {
        setBusy(false)
      }
      return
    }
    const delta = next - box.quantity
    setBusy(true)
    try {
      await applyInventoryDelta(book.id, box.warehouseId, bookstoreId, delta)
      const { error } = await supabase
        .from('boxes')
        .update({
          quantity: next,
          status: next < box.initialQuantity ? 'open' : box.status === 'empty' ? 'open' : box.status,
          opened_at: next < box.initialQuantity ? new Date().toISOString() : undefined,
        })
        .eq('id', box.id)
      if (error) throw error
      await supabase.from('inventory_movements').insert({
        type: 'adjustment',
        book_id: book.id,
        book_name: book.name,
        quantity: delta,
        warehouse_id: box.warehouseId,
        box_id: box.id,
        reason: `Carton qty ${box.quantity} → ${next}`,
        performed_by: appUser.uid,
        performed_by_name: appUser.displayName,
      })
      toast.success(`Carton updated · ${next} pcs`)
      setEditQty((prev) => {
        const n = { ...prev }
        delete n[box.id]
        return n
      })
      onChanged()
    } catch (e) {
      toast.error(opsErrorMessage(e, 'Could not update qty'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (box: Box & { id: string }, no: number) => {
    if (!appUser) return
    if (!confirm(`Remove carton #${no} (${box.quantity} pcs)?`)) return
    setBusy(true)
    try {
      await voidCarton({
        boxId: box.id,
        bookstoreId,
        reason: `Remove carton #${no}`,
        user: appUser,
      })
      toast.success(`Removed carton #${no}`)
      onChanged()
    } catch (e) {
      toast.error(opsErrorMessage(e, 'Could not remove'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Cartons</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Like Excel · #{rows.length} cartons · {totalPcs.toLocaleString()} pcs
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
              <th className="text-left font-semibold px-3 py-2 w-16">#</th>
              <th className="text-left font-semibold px-3 py-2">Carton ID</th>
              <th className="text-right font-semibold px-3 py-2 w-24">Books</th>
              <th className="text-right font-semibold px-3 py-2 w-20"> </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                  No cartons yet — add row below
                </td>
              </tr>
            )}
            {rows.map(({ box, no }) => {
              const draft = editQty[box.id]
              const dirty = draft != null && draft !== String(box.quantity)
              return (
                <tr key={box.id} className="hover:bg-accent-50/30">
                  <td className="px-3 py-2.5 font-bold tabular-nums text-accent-800">{no}</td>
                  <td className="px-3 py-2.5">
                    <p className="font-mono text-xs text-gray-700 break-all">{box.barcode}</p>
                    <Badge variant="gray" className="mt-1">{cartonStatusLabel(box.status)}</Badge>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {canEdit ? (
                      <input
                        type="number"
                        min={0}
                        className={cn(
                          'w-20 ml-auto block rounded-lg border border-gray-200 px-2 py-1.5 text-right font-semibold tabular-nums',
                          dirty && 'border-accent-400 bg-accent-50',
                        )}
                        value={draft ?? String(box.quantity)}
                        disabled={busy}
                        onChange={(e) => setEditQty((prev) => ({ ...prev, [box.id]: e.target.value }))}
                        onBlur={() => {
                          if (dirty) void saveQty(box)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && dirty) void saveQty(box)
                        }}
                      />
                    ) : (
                      <span className="font-semibold tabular-nums">{box.quantity}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {canEdit && (
                      <div className="inline-flex gap-1">
                        {dirty && (
                          <button
                            type="button"
                            disabled={busy}
                            className="rounded-lg p-1.5 text-accent-700 hover:bg-accent-50"
                            title="Save"
                            onClick={() => void saveQty(box)}
                          >
                            <Save className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busy}
                          className="rounded-lg p-1.5 text-red-600 hover:bg-red-50"
                          title="Remove carton"
                          onClick={() => void remove(box, no)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-gray-50 font-semibold">
                <td className="px-3 py-2 text-gray-500" colSpan={2}>Total</td>
                <td className="px-3 py-2 text-right tabular-nums text-accent-800">{totalPcs.toLocaleString()}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {canEdit && (
        <div className="border-t border-gray-100 px-3 py-3 space-y-2 bg-white">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Add carton</p>
          <div className="grid grid-cols-[4.5rem_1fr_auto] gap-2 items-end">
            <Input
              label="#"
              type="number"
              min={1}
              className="min-h-11"
              placeholder={String(nextNo)}
              value={newNo}
              onChange={(e) => setNewNo(e.target.value)}
            />
            <Input
              label="Books in carton"
              type="number"
              min={1}
              className="min-h-11"
              placeholder="e.g. 20"
              value={newPcs}
              onChange={(e) => setNewPcs(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addCarton()
              }}
            />
            <Button
              type="button"
              className="min-h-11"
              loading={busy}
              disabled={busy}
              onClick={() => void addCarton()}
            >
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
          <p className="text-[11px] text-gray-400">
            Example: carton #1 = 10 books, carton #2 = 20 books. Barcode ID is created automatically.
          </p>
        </div>
      )}
    </section>
  )
}
