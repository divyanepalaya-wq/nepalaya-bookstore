import { supabase } from '@/lib/supabase'
import type { AuditAction, UserRole } from '@/types'

export async function writeAuditLog(params: {
  action: AuditAction
  entity: string
  entityId?: string
  details: string
  performedBy: string
  performedByName: string
  role: UserRole
}) {
  try {
    await supabase.from('audit_logs').insert({
      action: params.action,
      entity: params.entity,
      entity_id: params.entityId ?? null,
      details: params.details,
      performed_by: params.performedBy,
      performed_by_name: params.performedByName,
      role: params.role,
    })
  } catch (e) {
    console.warn('audit log failed', e)
  }
}
