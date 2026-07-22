import { supabase } from '@/lib/supabase'
import { mapVendor } from '@/lib/mappers'
import type { AppUser, Vendor } from '@/types'

export async function listVendors(opts?: { activeOnly?: boolean }): Promise<(Vendor & { id: string })[]> {
  let q = supabase.from('vendors').select('*').order('name')
  if (opts?.activeOnly !== false) q = q.eq('is_active', true)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => mapVendor(r as Record<string, unknown>))
}

export async function createVendor(params: {
  name: string
  phone?: string
  contactPerson?: string
  notes?: string
  user: AppUser
}): Promise<string> {
  const name = params.name.trim()
  if (!name) throw new Error('Vendor name required')
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 20)
  const { error } = await supabase.from('vendors').insert({
    id,
    name,
    phone: params.phone?.trim() || null,
    contact_person: params.contactPerson?.trim() || null,
    notes: params.notes?.trim() || null,
    is_active: true,
    created_by: params.user.uid,
  })
  if (error) throw new Error(error.message)
  return id
}

export async function updateVendor(
  id: string,
  patch: { name?: string; phone?: string; contactPerson?: string; notes?: string; isActive?: boolean },
): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.name !== undefined) row.name = patch.name.trim()
  if (patch.phone !== undefined) row.phone = patch.phone.trim() || null
  if (patch.contactPerson !== undefined) row.contact_person = patch.contactPerson.trim() || null
  if (patch.notes !== undefined) row.notes = patch.notes.trim() || null
  if (patch.isActive !== undefined) row.is_active = patch.isActive
  const { error } = await supabase.from('vendors').update(row).eq('id', id)
  if (error) throw new Error(error.message)
}
