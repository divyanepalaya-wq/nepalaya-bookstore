import { useState, useEffect } from 'react'
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, query, orderBy,
} from 'firebase/firestore'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, Tag, ToggleLeft, ToggleRight } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { writeAuditLog } from '@/lib/auditLog'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Discount } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { PageSpinner } from '@/components/ui/Spinner'

const schema = z.object({
  name: z.string().min(1, 'Required'),
  code: z.string().optional(),
  type: z.enum(['percentage', 'fixed']),
  value: z.coerce.number().positive('Must be positive'),
  scope: z.enum(['item', 'order']),
  minPurchaseAmount: z.coerce.number().min(0).optional(),
  maxDiscountAmount: z.coerce.number().min(0).optional(),
})
type FormData = z.infer<typeof schema>

const TYPE_OPTIONS = [
  { value: 'percentage', label: 'Percentage (%)' },
  { value: 'fixed',      label: 'Fixed Amount (Rs.)' },
]
const SCOPE_OPTIONS = [
  { value: 'item',  label: 'Per Item' },
  { value: 'order', label: 'Whole Order' },
]

export default function Discounts() {
  const { appUser } = useAuth()
  const [discounts, setDiscounts] = useState<Discount[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Discount | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<Discount | null>(null)

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { type: 'percentage', scope: 'order' },
  })

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'discounts'), orderBy('createdAt', 'desc')),
      (snap) => {
        setDiscounts(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Discount))
        setLoading(false)
      }
    )
    return unsub
  }, [])

  const openAdd = () => {
    reset({ type: 'percentage', scope: 'order' })
    setEditing(null)
    setModalOpen(true)
  }

  const openEdit = (d: Discount) => {
    reset({
      name: d.name,
      code: d.code ?? '',
      type: d.type,
      value: d.value,
      scope: d.scope,
      minPurchaseAmount: d.minPurchaseAmount ?? 0,
      maxDiscountAmount: d.maxDiscountAmount ?? 0,
    })
    setEditing(d)
    setModalOpen(true)
  }

  const save = async (data: FormData) => {
    if (!appUser) return
    setSubmitting(true)
    try {
      if (editing) {
        await updateDoc(doc(db, 'discounts', editing.id), { ...data, updatedAt: serverTimestamp() })
        await writeAuditLog({
          action: 'discount_updated',
          entity: 'discount',
          entityId: editing.id,
          details: `Updated discount "${data.name}"`,
          performedBy: appUser.uid,
          performedByName: appUser.displayName,
          role: appUser.role,
        })
        toast.success('Discount updated')
      } else {
        const ref = await addDoc(collection(db, 'discounts'), {
          ...data,
          isActive: true,
          createdAt: serverTimestamp(),
          createdBy: appUser.uid,
        })
        await writeAuditLog({
          action: 'discount_created',
          entity: 'discount',
          entityId: ref.id,
          details: `Created discount "${data.name}"`,
          performedBy: appUser.uid,
          performedByName: appUser.displayName,
          role: appUser.role,
        })
        toast.success('Discount created')
      }
      setModalOpen(false)
    } catch {
      toast.error('Failed to save discount')
    } finally {
      setSubmitting(false)
    }
  }

  const toggleActive = async (d: Discount) => {
    if (!appUser) return
    try {
      await updateDoc(doc(db, 'discounts', d.id), { isActive: !d.isActive })
      toast.success(d.isActive ? 'Discount deactivated' : 'Discount activated')
    } catch {
      toast.error('Failed to update discount')
    }
  }

  const remove = async () => {
    if (!deleteConfirm || !appUser) return
    await deleteDoc(doc(db, 'discounts', deleteConfirm.id))
    await writeAuditLog({
      action: 'discount_deleted',
      entity: 'discount',
      entityId: deleteConfirm.id,
      details: `Deleted discount "${deleteConfirm.name}"`,
      performedBy: appUser.uid,
      performedByName: appUser.displayName,
      role: appUser.role,
    })
    toast.success('Discount deleted')
    setDeleteConfirm(null)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Discounts</h1>
          <p className="text-sm text-gray-500">Manage saved discount rules for the POS</p>
        </div>
        <Button onClick={openAdd}><Plus className="h-4 w-4" /> New Discount</Button>
      </div>

      {loading ? (
        <PageSpinner />
      ) : discounts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 py-16 text-center">
          <Tag className="mx-auto h-10 w-10 text-gray-300 mb-3" />
          <p className="text-sm font-medium text-gray-500">No discounts yet</p>
          <p className="text-xs text-gray-400 mt-1">Create discount rules to use in POS</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {discounts.map((d) => (
            <div
              key={d.id}
              className={`rounded-xl border bg-white p-4 space-y-3 ${d.isActive ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-gray-900">{d.name}</p>
                  {d.code && <p className="text-xs text-gray-400 font-mono">{d.code}</p>}
                </div>
                <Badge variant={d.isActive ? 'green' : 'gray'}>
                  {d.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="orange">
                  {d.type === 'percentage' ? `${d.value}% off` : `Rs. ${d.value} off`}
                </Badge>
                <Badge variant="blue">{d.scope === 'order' ? 'Order' : 'Per Item'}</Badge>
              </div>

              {(d.minPurchaseAmount || d.maxDiscountAmount) && (
                <div className="text-xs text-gray-500 space-y-0.5">
                  {d.minPurchaseAmount ? <p>Min purchase: {formatCurrency(d.minPurchaseAmount)}</p> : null}
                  {d.maxDiscountAmount ? <p>Max discount: {formatCurrency(d.maxDiscountAmount)}</p> : null}
                </div>
              )}

              <p className="text-xs text-gray-400">Created {formatDate(d.createdAt)}</p>

              <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
                <button
                  onClick={() => toggleActive(d)}
                  className="text-gray-400 hover:text-brand-600 transition-colors"
                  title={d.isActive ? 'Deactivate' : 'Activate'}
                >
                  {d.isActive
                    ? <ToggleRight className="h-5 w-5 text-green-500" />
                    : <ToggleLeft className="h-5 w-5" />}
                </button>
                <button onClick={() => openEdit(d)} className="ml-auto rounded-lg p-1.5 text-brand-600 hover:bg-brand-50">
                  <Pencil className="h-4 w-4" />
                </button>
                <button onClick={() => setDeleteConfirm(d)} className="rounded-lg p-1.5 text-red-500 hover:bg-red-50">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit Discount' : 'New Discount'}
        size="md"
      >
        <form onSubmit={handleSubmit(save)} className="space-y-4">
          <Input label="Discount Name *" error={errors.name?.message} {...register('name')} />
          <Input label="Code (optional)" placeholder="e.g. STAFF10" {...register('code')} />
          <div className="grid grid-cols-2 gap-4">
            <Select label="Type *" options={TYPE_OPTIONS} error={errors.type?.message} {...register('type')} />
            <Input label="Value *" type="number" step="0.01" error={errors.value?.message} {...register('value')} />
          </div>
          <Select label="Applies to *" options={SCOPE_OPTIONS} error={errors.scope?.message} {...register('scope')} />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Min Purchase (Rs.)"
              type="number"
              hint="Leave 0 for no minimum"
              {...register('minPurchaseAmount')}
            />
            <Input
              label="Max Discount (Rs.)"
              type="number"
              hint="Leave 0 for no cap"
              {...register('maxDiscountAmount')}
            />
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <Button variant="outline" type="button" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button type="submit" loading={submitting}>Save</Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirm */}
      <Modal
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Delete Discount"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Are you sure you want to delete <span className="font-semibold">"{deleteConfirm?.name}"</span>? This cannot be undone.
          </p>
          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="danger" onClick={remove}>Delete</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
