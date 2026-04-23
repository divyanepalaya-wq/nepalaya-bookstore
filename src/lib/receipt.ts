import type { Sale } from '@/types'

function fmt(n: number) {
  return `Rs. ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function dtStr(ts: { toDate: () => Date } | null | undefined) {
  if (!ts) return ''
  const d = ts.toDate()
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
    '  ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

function buildReceiptHtml(sale: Sale, logoUrl: string, autoPrint: boolean): string {
  const items = sale.items.map((i) => `
    <tr>
      <td>${i.bookName}</td>
      <td class="c">${i.quantity}</td>
      <td class="r">${fmt(i.unitPrice)}</td>
      <td class="r">${i.discountPercent > 0 ? `-${i.discountPercent}%` : '—'}</td>
      <td class="r">${fmt(i.subtotal)}</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Receipt #${sale.id.slice(-8)}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Courier New',monospace;font-size:11px;max-width:300px;margin:0 auto;padding:12px;color:#111}
  .logo{text-align:center;margin-bottom:8px}
  .logo img{max-width:160px;height:auto;display:block;margin:0 auto}
  hr{border:none;border-top:1px dashed #999;margin:7px 0}
  .row{display:flex;justify-content:space-between;margin:2px 0}
  .label{color:#666}
  table{width:100%;border-collapse:collapse;margin:4px 0;font-size:10px}
  th{border-bottom:1px solid #aaa;padding:3px 2px;text-align:left;font-size:9px;text-transform:uppercase;color:#666}
  td{padding:3px 2px;vertical-align:top}
  .c{text-align:center}.r{text-align:right}
  .total-row{display:flex;justify-content:space-between;margin:2px 0;font-size:11px}
  .grand{display:flex;justify-content:space-between;font-size:14px;font-weight:700;border-top:2px solid #111;margin-top:5px;padding-top:5px}
  .footer{text-align:center;margin-top:12px;font-size:9px;color:#888;line-height:1.6}
  .print-btn{display:block;width:100%;margin-top:14px;padding:8px;background:#f37023;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer}
  @media print{@page{margin:4mm}body{max-width:100%}.print-btn{display:none}}
</style>
</head>
<body>
<div class="logo">
  <img src="${logoUrl}" alt="Nepalaya Books" />
</div>
<hr>
<div class="row"><span class="label">Receipt</span><span>#${sale.id.slice(-8).toUpperCase()}</span></div>
<div class="row"><span class="label">Date</span><span>${dtStr(sale.createdAt)}</span></div>
<div class="row"><span class="label">Cashier</span><span>${sale.cashierName}</span></div>
<div class="row"><span class="label">Customer</span><span>${sale.customerName}</span></div>
<div class="row"><span class="label">Phone</span><span>${sale.customerPhone}</span></div>
<hr>
<table>
  <thead>
    <tr><th>Item</th><th class="c">Qty</th><th class="r">Price</th><th class="r">Disc</th><th class="r">Total</th></tr>
  </thead>
  <tbody>${items}</tbody>
</table>
<hr>
<div class="total-row"><span>Subtotal</span><span>${fmt(sale.subtotalBeforeDiscount)}</span></div>
${sale.totalDiscountAmount > 0 ? `<div class="total-row"><span>Discount</span><span>-${fmt(sale.totalDiscountAmount)}</span></div>` : ''}
<div class="grand"><span>TOTAL</span><span>${fmt(sale.grandTotal)}</span></div>
<hr>
<div class="row"><span class="label">Payment</span><span>${sale.paymentMethod.replace('_', ' ').toUpperCase()}</span></div>
${sale.paymentMethod === 'cash' ? `
<div class="row"><span class="label">Paid</span><span>${fmt(sale.amountPaid)}</span></div>
<div class="row"><span class="label">Change</span><span>${fmt(sale.changeGiven)}</span></div>` : ''}
${sale.notes ? `<div class="row"><span class="label">Note</span><span>${sale.notes}</span></div>` : ''}
<hr>
<div class="footer">
  Thank you for shopping at Nepalaya Books!<br>
  Exchange within 7 days with receipt.
</div>
${autoPrint
  ? `<script>window.onload=()=>{window.print();setTimeout(()=>window.close(),1200)}<\/script>`
  : `<button class="print-btn" onclick="window.print()">🖨️ Print / Save as PDF</button>`
}
</body>
</html>`
}

function openReceiptWindow(html: string): void {
  const w = window.open('', '_blank', 'width=400,height=650,toolbar=0,menubar=0,scrollbars=1')
  if (!w) { alert('Allow popups to print receipts'); return }
  w.document.write(html)
  w.document.close()
}

/** Opens receipt and immediately triggers the browser print dialog. */
export function printReceipt(sale: Sale): void {
  const logoUrl = `${window.location.origin}/logo.svg`
  openReceiptWindow(buildReceiptHtml(sale, logoUrl, true))
}

/**
 * Opens the receipt in a preview window with a visible Print button.
 * Use this for reprints so the cashier can decide when to print or save as PDF.
 */
export function openReceiptPreview(sale: Sale): void {
  const logoUrl = `${window.location.origin}/logo.svg`
  openReceiptWindow(buildReceiptHtml(sale, logoUrl, false))
}
