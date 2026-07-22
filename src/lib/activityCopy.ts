/** Human-readable stock log line (expense-app style). */
export function movementLine(m: {
  type: string
  quantity: number
  bookName?: string
  reason?: string
  warehouseId?: string
  fromWarehouseId?: string
  toWarehouseId?: string
  performedByName?: string
}): string {
  const who = m.performedByName || 'Staff'
  const qty = Math.abs(m.quantity)
  const reason = (m.reason || '').toLowerCase()

  if (m.type === 'receive' || reason.includes('vendor')) {
    if (reason.includes('vendor')) {
      return `${who} · ${qty} pcs came from vendor → bookstore`
    }
    return `${who} · ${qty} pcs received into warehouse cartons`
  }
  if (m.type === 'transfer' || m.type === 'transfer_out' || m.type === 'transfer_in') {
    if (m.toWarehouseId === 'wh-buffer' || reason.includes('backroom')) {
      return `${who} · took carton → backroom (${qty} pcs)`
    }
    if (m.toWarehouseId === 'wh-bookstore' || reason.includes('store')) {
      return `${who} · took carton → store (${qty} pcs)`
    }
    return `${who} · moved ${qty} pcs`
  }
  if (m.type === 'replenish' || reason.includes('sale') || reason.includes('replenish') || reason.includes('shelf')) {
    return `${who} · put ${qty} pcs on shelf`
  }
  if (m.type === 'sale') {
    return `${who} · sold ${qty} pcs`
  }
  if (m.type === 'return') {
    return `${who} · returned ${qty} pcs to shelf`
  }
  return `${who} · ${m.type.replace(/_/g, ' ')} · ${m.quantity} pcs${m.reason ? ` · ${m.reason}` : ''}`
}
