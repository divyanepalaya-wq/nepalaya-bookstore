import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { RotateCcw, Package, Store } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { mapMovement } from '@/lib/mappers'
import { useAuth } from '@/contexts/AuthContext'
import { useWarehouse } from '@/contexts/WarehouseContext'
import { voidCarton, undoReplenish, removeShelfStock } from '@/lib/inventoryService'
import { movementLine } from '@/lib/activityCopy'
import { opsErrorMessage } from '@/lib/opsErrors'
import { formatDateTime } from '@/lib/utils'
import type { InventoryMovement } from '@/types'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { PageSpinner } from '@/components/ui/Spinner'

type Row = InventoryMovement & { id: string }

const UNDONE_MARK = '[UNDONE]'

function isMarkedUndone(m: Row): boolean {
  return (m.reason || '').includes(UNDONE_MARK)
}

async function markUndone(movementId: string, reason: string) {
  await supabase
    .from('inventory_movements')
    .update({ reason: `${UNDONE_MARK} ${reason || ''}`.trim() })
    .eq('id', movementId)
}

/**
 * Undo mistaken stock actions. Already-undone rows show a badge, not Undo.
 */
export default function FixStock() {
  const { appUser } = useAuth()
  const { bookstoreId } = useWarehouse()
  const [rows, setRows] = useState<Row[]>([])
  const [deadBoxes, setDeadBoxes] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const reload = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('inventory_movements')
      .select('*')
      .in('type', ['receive', 'replenish_retail', 'adjustment'])
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) {
      toast.error(error.message)
      setLoading(false)
      return
    }
    const mapped = (data ?? []).map((r) => mapMovement(r as Record<string, unknown>))
    setRows(mapped)

    // Cartons already voided → treat those receives as undone
    const boxIds = [...new Set(mapped.map((m) => m.boxId).filter(Boolean))] as string[]
    if (boxIds.length > 0) {
      const { data: boxes } = await supabase
        .from('boxes')
        .select('id, quantity, status, is_deleted')
        .in('id', boxIds)
      const dead = new Set<string>()
      for (const b of boxes ?? []) {
        if (b.is_deleted || b.status === 'empty' || Number(b.quantity) <= 0) {
          dead.add(b.id as string)
        }
      }
      setDeadBoxes(dead)
    } else {
      setDeadBoxes(new Set())
    }
    setLoading(false)
  }

  useEffect(() => {
    void reload()
  }, [])

  /** Pair undo adjustments → original move already reversed. */
  const undoneKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const m of rows) {
      if (m.type !== 'adjustment') continue
      const reason = (m.reason || '').toLowerCase()
      if (!reason.includes('undo') && !reason.includes('mistaken') && !reason.includes('voided')) continue
      if (m.boxId) keys.add(`box:${m.boxId}:${Math.abs(m.quantity)}`)
      keys.add(`book:${m.bookId}:${Math.abs(m.quantity)}:${m.type}`)
      if (reason.includes('vendor') || reason.includes('shelf')) {
        keys.add(`vendor:${m.bookId}:${Math.abs(m.quantity)}`)
      }
      if (reason.includes('put on sale') || reason.includes('replenish')) {
        keys.add(`replenish:${m.boxId}:${Math.abs(m.quantity)}`)
      }
    }
    return keys
  }, [rows])

  const alreadyUndone = (m: Row): boolean => {
    if (isMarkedUndone(m)) return true
    if (m.boxId && deadBoxes.has(m.boxId) && m.type === 'receive') return true
    if (m.type === 'replenish_retail' && m.boxId) {
      if (undoneKeys.has(`replenish:${m.boxId}:${Math.abs(m.quantity)}`)) return true
      if (undoneKeys.has(`box:${m.boxId}:${Math.abs(m.quantity)}`)) return true
    }
    if (
      m.type === 'receive' &&
      !m.boxId &&
      undoneKeys.has(`vendor:${m.bookId}:${Math.abs(m.quantity)}`)
    ) {
      return true
    }
    return false
  }

  const canUndo = (m: Row) => {
    if (alreadyUndone(m)) return false
    if (m.quantity <= 0) return false
    if (m.type === 'adjustment') return false
    if (m.type === 'replenish_retail' && m.boxId) return true
    if (m.type === 'receive' && m.boxId) return true
    if (
      m.type === 'receive' &&
      ((m.reason || '').toLowerCase().includes('vendor') || m.warehouseId === bookstoreId)
    ) {
      return true
    }
    return false
  }

  const undo = async (m: Row) => {
    if (!appUser) return
    if (alreadyUndone(m)) {
      toast.error('Already undone')
      return
    }
    setBusyId(m.id)
    try {
      if (m.type === 'replenish_retail' && m.boxId) {
        if (!confirm(`Undo put on sale?\nMove ${m.quantity} pcs of “${m.bookName}” back into the carton.`)) {
          return
        }
        await undoReplenish({
          boxId: m.boxId,
          quantity: Math.abs(m.quantity),
          bookstoreId,
          user: appUser,
        })
        await markUndone(m.id, m.reason)
        toast.success(`Undone · ${m.quantity} pcs back to carton`)
      } else if (
        m.type === 'receive' &&
        !m.boxId &&
        ((m.reason || '').toLowerCase().includes('vendor') || m.warehouseId === bookstoreId)
      ) {
        if (!confirm(`Undo vendor receive? Remove ${m.quantity} pcs of “${m.bookName}” from shelf.`)) {
          return
        }
        await removeShelfStock({
          bookId: m.bookId,
          bookName: m.bookName,
          quantity: Math.abs(m.quantity),
          bookstoreId,
          reason: 'Undo mistaken vendor receive',
          user: appUser,
        })
        await markUndone(m.id, m.reason)
        toast.success(`Undone · −${m.quantity} from shelf`)
      } else if (m.type === 'receive' && m.boxId) {
        if (
          !confirm(
            `Undo carton receive?\nRemove carton and −${m.quantity} pcs of “${m.bookName}” from warehouse.\n\nIf you put some on the shelf already, undo those “put on sale” rows first.`,
          )
        ) {
          return
        }
        const r = await voidCarton({
          boxId: m.boxId,
          bookstoreId,
          reason: 'Undo mistaken warehouse receive',
          user: appUser,
        })
        await markUndone(m.id, m.reason)
        toast.success(`Undone · carton ${r.barcode} · −${r.quantity} pcs`)
      } else {
        toast.error('Open the book page to fix this one')
        return
      }
      await reload()
    } catch (e) {
      toast.error(opsErrorMessage(e, 'Undo failed'))
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return <PageSpinner />

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <RotateCcw className="h-7 w-7 text-accent-600" />
          Undo stock
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Reverse mistaken receives or put-on-sale. Already undone items stay in the log without Undo.
        </p>
      </div>

      <ul className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100">
        {rows.length === 0 && (
          <li className="px-4 py-10 text-center text-gray-400 text-sm">No recent stock moves</li>
        )}
        {rows.map((m) => {
          const undone = alreadyUndone(m)
          const undoable = canUndo(m)
          const line = isMarkedUndone(m)
            ? movementLine({ ...m, reason: (m.reason || '').replace(UNDONE_MARK, '').trim() })
            : movementLine(m)
          return (
            <li key={m.id} className={`px-4 py-3.5 space-y-2 ${undone ? 'opacity-60' : ''}`}>
              <div className="flex gap-2 items-start">
                <div className="mt-0.5 text-accent-600">
                  {m.type === 'replenish_retail' ? <Store className="h-4 w-4" /> : <Package className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900 leading-snug">{line}</p>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">{m.bookName}</p>
                  <div className="flex flex-wrap gap-2 mt-1">
                    <Badge variant="gray">{m.type.replace(/_/g, ' ')}</Badge>
                    {undone && <Badge variant="green">Undone</Badge>}
                    <span className="text-[11px] text-gray-400">{formatDateTime(m.createdAt)}</span>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 pl-6">
                {undoable && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-red-700 border-red-200"
                    loading={busyId === m.id}
                    disabled={!!busyId}
                    onClick={() => void undo(m)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Undo
                  </Button>
                )}
                <Link to={`/books/${m.bookId}`} className="text-sm text-accent-700 self-center px-2">
                  Open book →
                </Link>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
