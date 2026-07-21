/**
 * Client-side idempotency helpers for stock/money RPCs.
 */
export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** Map Postgres / Supabase errors to short operator guidance. */
export function opsErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  const raw =
    (error as { message?: string })?.message ??
    (error instanceof Error ? error.message : '') ??
    ''
  const msg = String(raw)

  if (/Insufficient stock/i.test(msg)) {
    return 'Not enough stock at that location. Check inventory, then try again.'
  }
  if (/Cannot pick transfer|status draft/i.test(msg)) {
    return 'This transfer was already sent. Open Transfers → Receive.'
  }
  if (/Cannot receive transfer/i.test(msg)) {
    return 'This transfer cannot be received yet (wrong status). Refresh Transfers.'
  }
  if (/Box is (empty|in_transit)/i.test(msg)) {
    return 'That carton is empty or already in transit. Scan again or open Transfers.'
  }
  if (/Box not at source/i.test(msg)) {
    return 'Carton is not at the source location for this transfer.'
  }
  if (/Not authorized/i.test(msg)) {
    return 'You do not have permission for this action.'
  }
  if (/already fully returned/i.test(msg)) {
    return 'This sale was already fully returned.'
  }
  if (/Idempotency/i.test(msg)) {
    return 'This action was already submitted. Refresh to see the result.'
  }
  if (msg && msg.length < 180 && !msg.includes('PGRST')) return msg
  return fallback
}
