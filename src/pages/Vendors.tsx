import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Truck, Plus, Pencil } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { listVendors, createVendor, updateVendor } from '@/lib/vendors'
import type { Vendor } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner } from '@/components/ui/Spinner'

/** Settings · create and manage book vendors. */
export default function Vendors() {
  const { appUser } = useAuth()
  const [vendors, setVendors] = useState<(Vendor & { id: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<(Vendor & { id: string }) | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [contact, setContact] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [showInactive, setShowInactive] = useState(false)

  const reload = async () => {
    setLoading(true)
    try {
      const rows = await listVendors({ activeOnly: !showInactive })
      setVendors(rows)
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message.includes('relation') || e.message.includes('schema')
            ? 'Vendors table missing — run migration 009_vendors.sql in Supabase'
            : e.message
          : 'Could not load vendors',
      )
      setVendors([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [showInactive])

  const openAdd = () => {
    setEditing(null)
    setName('')
    setPhone('')
    setContact('')
    setNotes('')
    setModal(true)
  }

  const openEdit = (v: Vendor & { id: string }) => {
    setEditing(v)
    setName(v.name)
    setPhone(v.phone ?? '')
    setContact(v.contactPerson ?? '')
    setNotes(v.notes ?? '')
    setModal(true)
  }

  const save = async () => {
    if (!appUser) return
    if (!name.trim()) {
      toast.error('Name required')
      return
    }
    setSaving(true)
    try {
      if (editing) {
        await updateVendor(editing.id, {
          name,
          phone,
          contactPerson: contact,
          notes,
        })
        toast.success('Vendor updated')
      } else {
        await createVendor({ name, phone, contactPerson: contact, notes, user: appUser })
        toast.success('Vendor added')
      }
      setModal(false)
      await reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (v: Vendor & { id: string }) => {
    try {
      await updateVendor(v.id, { isActive: !v.isActive })
      toast.success(v.isActive ? 'Deactivated' : 'Activated')
      await reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed')
    }
  }

  if (loading) return <PageSpinner />

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Truck className="h-7 w-7 text-accent-600" />
            Vendors
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Who you buy Nepali / English books from
          </p>
        </div>
        <Button size="lg" className="min-h-11" onClick={openAdd}>
          <Plus className="h-5 w-5" /> Add vendor
        </Button>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-600">
        <input
          type="checkbox"
          checked={showInactive}
          onChange={(e) => setShowInactive(e.target.checked)}
        />
        Show inactive
      </label>

      <ul className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100">
        {vendors.length === 0 && (
          <li className="px-4 py-10 text-center text-gray-400 text-sm">
            No vendors yet. Add one, then use Stock in → Nepali / English.
          </li>
        )}
        {vendors.map((v) => (
          <li key={v.id} className="flex items-center gap-3 px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-gray-900">{v.name}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {[v.contactPerson, v.phone].filter(Boolean).join(' · ') || '—'}
              </p>
              {!v.isActive && <Badge variant="gray" className="mt-1">Inactive</Badge>}
            </div>
            <Button type="button" variant="outline" size="sm" className="min-h-10 w-10 p-0" onClick={() => openEdit(v)}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button type="button" variant="outline" size="sm" className="min-h-10" onClick={() => void toggleActive(v)}>
              {v.isActive ? 'Off' : 'On'}
            </Button>
          </li>
        ))}
      </ul>

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Edit vendor' : 'Add vendor'} size="sm">
        <div className="space-y-4">
          <Input label="Vendor name *" className="min-h-12" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <Input label="Contact person" className="min-h-12" value={contact} onChange={(e) => setContact(e.target.value)} />
          <Input label="Phone" className="min-h-12" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Input label="Notes" className="min-h-12" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setModal(false)}>Cancel</Button>
            <Button loading={saving} onClick={() => void save()}>{editing ? 'Save' : 'Add'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
