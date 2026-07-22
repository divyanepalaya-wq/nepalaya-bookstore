import { useState, useEffect, useMemo } from 'react'
import toast from 'react-hot-toast'
import { MapPin, Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useWarehouse } from '@/contexts/WarehouseContext'
import { createShelfLocation, updateShelfLocation } from '@/lib/inventoryService'
import { mapShelf } from '@/lib/mappers'
import { buildShelfLabel } from '@/lib/barcode'
import type { ShelfLocation } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'

export default function ShelfLocationsPage() {
  const { appUser } = useAuth()
  const { warehouses } = useWarehouse()
  const [shelves, setShelves] = useState<ShelfLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [warehouseId, setWarehouseId] = useState('')
  const [aisle, setAisle] = useState('')
  const [rack, setRack] = useState('')
  const [bin, setBin] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const { data, error } = await supabase.from('shelf_locations').select('*').order('label')
    if (error) {
      setLoading(false)
      return
    }
    setShelves((data ?? []).map((r) => mapShelf(r as Record<string, unknown>)))
    setLoading(false)
  }

  useEffect(() => {
    void load()
    const channel = supabase
      .channel('shelf-locations-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shelf_locations' }, () => void load())
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [])

  useEffect(() => {
    if (warehouses.length > 0 && !warehouseId) setWarehouseId(warehouses[0].id)
  }, [warehouses, warehouseId])

  const filtered = useMemo(
    () => shelves.filter((s) => !warehouseId || s.warehouseId === warehouseId),
    [shelves, warehouseId],
  )

  const label = buildShelfLabel(aisle, rack, bin)

  const handleCreate = async () => {
    if (!appUser) return
    if (!warehouseId) return toast.error('Select a warehouse')
    if (!aisle.trim()) return toast.error('Enter an aisle')
    setSaving(true)
    try {
      await createShelfLocation({
        warehouseId,
        aisle,
        rack,
        bin,
        label,
        description,
        user: appUser,
      })
      toast.success(`Created shelf ${label}`)
      setOpen(false)
      setAisle(''); setRack(''); setBin(''); setDescription('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (s: ShelfLocation) => {
    try {
      await updateShelfLocation(s.id, { isActive: !s.isActive })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed')
    }
  }

  const whName = (id: string) => warehouses.find((w) => w.id === id)?.name ?? id

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <MapPin className="h-6 w-6 text-accent-600" />
            Shelf Locations
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Define structured aisle-rack-bin locations for put-away and pick lists.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Add shelf
        </Button>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3">
          <select
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
        {loading ? (
          <p className="px-5 py-6 text-sm text-gray-400">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="px-5 py-6 text-sm text-gray-400">No shelf locations yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {filtered.map((s) => (
              <li key={s.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="font-mono font-semibold text-gray-900">{s.label}</p>
                  <p className="text-xs text-gray-500">
                    {whName(s.warehouseId)}{s.description ? ` · ${s.description}` : ''}
                    {!s.isActive && ' · (inactive)'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => toggleActive(s)}>
                    {s.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Add Shelf Location" size="sm">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Warehouse</label>
            <select
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input label="Aisle" placeholder="A" value={aisle} onChange={(e) => setAisle(e.target.value)} />
            <Input label="Rack" placeholder="03" value={rack} onChange={(e) => setRack(e.target.value)} />
            <Input label="Bin" placeholder="12" value={bin} onChange={(e) => setBin(e.target.value)} />
          </div>
          <p className="text-xs text-gray-400">
            Label: <span className="font-mono font-semibold text-accent-700">{label}</span>
          </p>
          <Input label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={saving} onClick={handleCreate}>Create</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
