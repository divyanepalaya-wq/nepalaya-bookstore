import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { AuditAction, UserRole } from '@/types'

interface AuditLogInput {
  action: AuditAction
  entity: string
  entityId?: string
  details: string
  performedBy: string
  performedByName: string
  role: UserRole
}

export async function writeAuditLog(input: AuditLogInput): Promise<void> {
  try {
    await addDoc(collection(db, 'auditLogs'), {
      ...input,
      createdAt: serverTimestamp(),
    })
  } catch {
    // Audit log failures should never break the main flow
    console.warn('Failed to write audit log', input)
  }
}
