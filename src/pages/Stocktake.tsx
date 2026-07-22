import { useState, useEffect, useMemo, useCallback } from 'react'
import toast from 'react-hot-toast'
import { ClipboardCheck, Plus, CheckCircle2, XCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { mapStocktake } from '@/lib/mappers'
import { useAuth } from '@/contexts/AuthContext'
import { useWarehouse } from '@/contexts/WarehouseContext'
import { useBooks } from '@/contexts/BooksContext'
import {
  createStocktake,
  startStocktake,
  updateStocktakeItemCount,
  completeStocktake,
  cancelStocktake,
} from '@/lib/inventoryService'
import { formatDateTime } from '@/lib/utils'
import type { BookInventory, Stocktake, StocktakeItem, StocktakeCountMethod } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'

export default function StocktakePage() {
  const { appUser } = useAuth()
  const { warehouses, inventoryMap, bookstoreId } = useWarehouse()
  const { books } = useBooks()

  const [stocktakes, setStocktakes] = useState<Stocktake[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [method, setMethod] = useState<StocktakeCountMethod>('by_box')
  const [active, setActive] = useState<Stocktake | null>(null)
  const [counts, setCounts] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(false)

    async function load() {
      const { data, error } = await supabase.from('stocktakes').select('*').order('created_at', { ascending: false })
      if (cancelled) return
      if (error) {
        setLoadError(true)
        setLoading(false)
        toast.error('Could not load cycle counts. Tap Retry.')
        return
      }
      setStocktakes((data ?? []).map((r) => mapStocktake(r as Record<string, unknown>)))
      setLoading(false)
    }

    void load()
    const channel = supabase
      .channel('stocktakes-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stocktakes' }, () => void load())
      .subscribe()

    return () => {
      cancelled = true
      void supabase.removeChannel(channel)
    }
  }, [reloadKey])

  useEffect(() => {
    if (warehouses.length > 0 && !warehouseId) {
      const firstWh = warehouses[0]
      setWarehouseId(firstWh.id)
    }
  }, [warehouses, warehouseId])

  const bookName = useCallback(
    (bookId: string) => books.find((b) => b.id === bookId)?.name ?? bookId,
    [books],
  )

  const openCreate = () => {
    setName(`Cycle count ${new Date().toLocaleDateString()}`)
    setMethod('by_box')
    setCreateOpen(true)
  }

  const handleCreate = async () => {
    if (!appUser) return
    if (!name.trim()) {
      toast.error('Enter a name')
      return
    }
    if (!warehouseId) {
      toast.error('Select a warehouse')
      return
    }
    setSaving(true)
    try {
      const items: StocktakeItem[] = []
      for (const [bookId, inv] of Object.entries(inventoryMap)) {
        const invData = inv as BookInventory
        const expected = invData.byWarehouse?.[warehouseId] ?? 0
        if (expected <= 0 && method === 'by_box') continue
        items.push({
          bookId,
          bookName: bookName(bookId),
          warehouseId,
          shelfLocation: '',
          expectedQty: expected,
          countedQty: null,
        })
      }
      const id = await createStocktake({
        name: name.trim(),
        warehouseId,
        method,
        items,
        user: appUser,
      })
      toast.success(`Created stocktake with ${items.length} item(s)`)
      setCreateOpen(false)
      // Open immediately — don't rely on stale stocktakes listener list
      setActive({
        id,
        name: name.trim(),
        warehouseId,
        method,
        status: 'draft',
        items,
        createdBy: appUser.uid,
        createdByName: appUser.displayName,
        createdAt: new Date().toISOString(),
      })
      setCounts({})
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  const handleStart = async (id: string) => {
    try {
      await startStocktake(id)
      const s = stocktakes.find((x) => x.id === id) ?? null
      setActive(s ? { ...s, status: 'in_progress' } : s)
      toast.success('Stocktake started')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    }
  }

  const handleCountChange = (idx: number, value: string) => {
    setCounts((c) => ({ ...c, [idx]: value }))
  }

  const handleSaveCount = async (idx: number) => {
    if (!active) return
    const raw = counts[idx]
    if (raw === undefined || raw === '') {
      toast.error('Enter a count')
      return
    }
    const qty = parseInt(raw, 10)
    if (isNaN(qty) || qty < 0) {
      toast.error('Enter a valid count')
      return
    }
    setSaving(true)
    try {
      await updateStocktakeItemCount(active.id, idx, qty, appUser?.displayName ?? 'unknown')
      setActive((a) =>
        a ? { ...a, items: a.items.map((it, i) => (i === idx ? { ...it, countedQty: qty } : it)) } : a,
      )
      setCounts((c) => {
        const next = { ...c }
        delete next[idx]
        return next
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleComplete = async () => {
    if (!active || !appUser) return
    const uncounted = active.items.filter((it) => it.countedQty === null).length
    if (uncounted > 0 && !window.confirm(`${uncounted} item(s) not counted. Complete anyway?`)) {
      return
    }
    setSaving(true)
    try {
      const res = await completeStocktake({ stocktakeId: active.id, bookstoreId, user: appUser })
      toast.success(`Completed — ${res.adjusted} adjusted, ${res.totalDiscrepancy} units variance`)
      setActive(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Complete failed')
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = async (id: string) => {
    if (!appUser) return
    if (!window.confirm('Cancel this cycle count? Counts already entered will be discarded.')) return
    try {
      await cancelStocktake(id, appUser)
      if (active?.id === id) setActive(null)
      toast.success('Cancelled')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    }
  }

  const sortedItems = useMemo(() => {
    if (!active) return []
    return [...active.items].sort((a, b) => {
      const al = a.shelfLocation ?? ''
      const bl = b.shelfLocation ?? ''
      if (al !== bl) return al.localeCompare(bl)
      return a.bookName.localeCompare(b.bookName)
    })
  }, [active])

  const countedCount = active ? active.items.filter((i) => i.countedQty !== null).length : 0
  const varianceCount = active
    ? active.items.filter((i) => i.countedQty !== null && i.countedQty !== i.expectedQty).length
    : 0

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {loadError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-sm text-red-700">Could not load cycle counts.</p>
          <Button size="sm" variant="outline" onClick={() => setReloadKey((k) => k + 1)}>Retry</Button>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6 text-accent-600" />
            Cycle Count
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Count Main Warehouse, Backroom, or Bookstore Floor to reconcile inventory with physical cartons.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" />
          New count
        </Button>
      </div>

      {/* Active stocktake */}
      {active && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-gray-900">{active.name}</h2>
              <p className="text-xs text-gray-500">
                {warehouses.find((w) => w.id === active.warehouseId)?.name} ·{' '}
                {active.method === 'by_box' ? 'By box' : 'By location'} ·{' '}
                {countedCount}/{active.items.length} counted · {varianceCount} variances
              </p>
            </div>
            <div className="flex gap-2">
              {active.status === 'in_progress' && (
                <Button variant="outline" size="sm" onClick={handleComplete} loading={saving}>
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  Complete
                </Button>
              )}
              {active.status === 'draft' && (
                <Button size="sm" onClick={() => handleStart(active.id)}>
                  Start
                </Button>
              )}
              {(active.status === 'draft' || active.status === 'in_progress') && (
                <Button variant="outline" size="sm" onClick={() => handleCancel(active.id)}>
                  <XCircle className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
              )}
            </div>
          </div>

          <div className="divide-y divide-gray-100 max-h-[60vh] overflow-auto">
            {sortedItems.map((item) => {
              const key = active.items.indexOf(item)
              const counted = item.countedQty !== null
              const hasVariance = counted && item.countedQty !== item.expectedQty
              return (
                <div key={`${item.bookId}-${key}`} className="px-5 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{item.bookName}</p>
                    <p className="text-xs text-gray-500">
                      {item.shelfLocation ? `Shelf ${item.shelfLocation} · ` : ''}
                      Expected: <span className="font-mono">{item.expectedQty}</span>
                      {counted && (
                        <>
                          {' '}· Counted:{' '}
                          <span className={`font-mono ${hasVariance ? 'text-red-600' : 'text-green-700'}`}>
                            {item.countedQty}
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                  {active.status === 'in_progress' && (
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        className="w-24"
                        placeholder="count"
                        value={counts[key] ?? (counted ? String(item.countedQty) : '')}
                        onChange={(e) => handleCountChange(key, e.target.value)}
                      />
                      <Button size="sm" variant="outline" onClick={() => handleSaveCount(key)} loading={saving}>
                        Save
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
            {sortedItems.length === 0 && (
              <p className="px-5 py-8 text-center text-sm text-gray-400">No items in this count.</p>
            )}
          </div>
        </div>
      )}

      {/* List of stocktakes */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
        <div className="px-5 py-3 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">History</h3>
        </div>
        {loading ? (
          <p className="px-5 py-6 text-sm text-gray-400">Loading…</p>
        ) : stocktakes.length === 0 ? (
          <p className="px-5 py-6 text-sm text-gray-400">No cycle counts yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {stocktakes.map((s) => {
              const counted = s.items.filter((i) => i.countedQty !== null).length
              return (
                <li key={s.id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-gray-900">{s.name}</p>
                    <p className="text-xs text-gray-500">
                      {warehouses.find((w) => w.id === s.warehouseId)?.name} ·{' '}
                      {s.status} · {counted}/{s.items.length} counted · {formatDateTime(s.createdAt)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {s.status !== 'completed' && s.status !== 'cancelled' && (
                      <Button size="sm" variant="outline" onClick={() => setActive(s)}>
                        Open
                      </Button>
                    )}
                    {s.status === 'completed' && (
                      <Button size="sm" variant="outline" onClick={() => setActive(s)}>
                        View
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Cycle Count" size="sm">
        <div className="space-y-4">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
            <select
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.type === 'primary_warehouse' ? 'Main Warehouse' : w.type === 'buffer_warehouse' ? 'Backroom' : w.type === 'bookstore' ? 'Bookstore Floor' : w.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Method</label>
            <select
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={method}
              onChange={(e) => setMethod(e.target.value as StocktakeCountMethod)}
            >
              <option value="by_box">By carton (only titles with stock)</option>
              <option value="by_location">By location (all titles)</option>
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button loading={saving} onClick={handleCreate}>Create</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
