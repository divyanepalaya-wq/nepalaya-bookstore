import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { Plus, Warehouse as WarehouseIcon, Pencil, MapPin } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useWarehouse } from '@/contexts/WarehouseContext'
import { writeAuditLog } from '@/lib/auditLog'
import type { Warehouse, WarehouseType } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { PageSpinner } from '@/components/ui/Spinner'

const schema = z.object({
  name: z.string().min(1, 'Required'),
  code: z.string().min(1, 'Required').max(4, 'Max 4 chars').regex(/^[A-Za-z0-9]+$/, 'Letters/numbers only'),
  type: z.enum(['bookstore', 'primary_warehouse', 'buffer_warehouse']),
  address: z.string().optional(),
})
type FormData = z.infer<typeof schema>

const TYPE_OPTIONS = [
  { value: 'primary_warehouse', label: 'Primary Warehouse' },
  { value: 'buffer_warehouse', label: 'Small / Buffer Warehouse' },
  { value: 'bookstore', label: 'Bookstore Floor' },
]

const TYPE_BADGE: Record<WarehouseType, 'blue' | 'orange' | 'green'> = {
  primary_warehouse: 'blue',
  buffer_warehouse: 'orange',
  bookstore: 'green',
}

export default function Warehouses() {
  const { appUser } = useAuth()
  const { warehouses, loading } = useWarehouse()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Warehouse | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { type: 'primary_warehouse' },
  })

  const openCreate = () => {
    setEditing(null)
    form.reset({ name: '', code: '', type: 'primary_warehouse', address: '' })
    setModalOpen(true)
  }

  const openEdit = (w: Warehouse) => {
    setEditing(w)
    form.reset({ name: w.name, code: w.code, type: w.type, address: w.address ?? '' })
    setModalOpen(true)
  }

  const onSubmit = async (data: FormData) => {
    if (!appUser) return
    setSubmitting(true)
    try {
      const code = data.code.toUpperCase()
      if (editing) {
        const { error } = await supabase
          .from('warehouses')
          .update({ name: data.name, code, type: data.type, address: data.address ?? '' })
          .eq('id', editing.id)
        if (error) throw new Error(error.message)
        await writeAuditLog({
          action: 'warehouse_updated',
          entity: 'warehouse',
          entityId: editing.id,
          details: `Updated warehouse "${data.name}" (${code})`,
          performedBy: appUser.uid,
          performedByName: appUser.displayName,
          role: appUser.role,
        })
        toast.success('Warehouse updated')
      } else {
        const id = crypto.randomUUID?.() ?? `wh-${Date.now()}`
        const { error } = await supabase.from('warehouses').insert({
          id,
          name: data.name,
          code,
          type: data.type,
          address: data.address ?? '',
          is_active: true,
          is_default: false,
          created_by: appUser.uid,
        })
        if (error) throw new Error(error.message)
        await writeAuditLog({
          action: 'warehouse_created',
          entity: 'warehouse',
          entityId: id,
          details: `Created warehouse "${data.name}" (${code})`,
          performedBy: appUser.uid,
          performedByName: appUser.displayName,
          role: appUser.role,
        })
        toast.success('Warehouse created')
      }
      setModalOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSubmitting(false)
    }
  }

  const toggleActive = async (w: Warehouse) => {
    if (!appUser) return
    try {
      const { error } = await supabase.from('warehouses').update({ is_active: !w.isActive }).eq('id', w.id)
      if (error) throw new Error(error.message)
      toast.success(w.isActive ? 'Deactivated' : 'Activated')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed')
    }
  }

  if (loading) return <PageSpinner />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <WarehouseIcon className="h-6 w-6 text-accent-600" />
            Warehouses
          </h1>
          <p className="text-sm text-gray-500 mt-1">Manage bookstore and warehouse locations</p>
        </div>
        {(appUser?.role === 'superadmin' || appUser?.role === 'admin') && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Add warehouse
          </Button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {warehouses.map((w) => (
          <div key={w.id} className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-semibold text-gray-900">{w.name}</h2>
                <p className="text-xs font-mono text-gray-500 mt-0.5">{w.code}</p>
              </div>
              <Badge variant={TYPE_BADGE[w.type]}>
                {TYPE_OPTIONS.find((o) => o.value === w.type)?.label ?? w.type}
              </Badge>
            </div>
            {w.address && (
              <p className="mt-3 text-sm text-gray-500 flex items-start gap-1.5">
                <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                {w.address}
              </p>
            )}
            <div className="mt-4 flex items-center gap-2">
              {w.isDefault && <Badge variant="blue">Default</Badge>}
              {!w.isActive && <Badge variant="red">Inactive</Badge>}
            </div>
            <div className="mt-4 flex gap-2">
              <Button variant="outline" size="sm" onClick={() => openEdit(w)}>
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
              <Button variant="ghost" size="sm" onClick={() => toggleActive(w)}>
                {w.isActive ? 'Deactivate' : 'Activate'}
              </Button>
            </div>
          </div>
        ))}
        {warehouses.length === 0 && (
          <p className="text-sm text-gray-500 col-span-full">No warehouses yet. Defaults seed on first admin login.</p>
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit Warehouse' : 'Add Warehouse'}
      >
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <Input label="Name" error={form.formState.errors.name?.message} {...form.register('name')} />
          <Input
            label="Code (for barcodes)"
            hint="Short code like PW, SW, BS — used in NPBX-XX-00000001"
            error={form.formState.errors.code?.message}
            {...form.register('code')}
          />
          <Select
            label="Type"
            options={TYPE_OPTIONS}
            error={form.formState.errors.type?.message}
            {...form.register('type')}
          />
          <Input label="Address (optional)" {...form.register('address')} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button type="submit" loading={submitting}>{editing ? 'Save' : 'Create'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
