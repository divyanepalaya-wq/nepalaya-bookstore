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

export function printReceipt(sale: Sale) {
  const items = sale.items.map((i) => `
    <tr>
      <td>${i.bookName}</td>
      <td class="c">${i.quantity}</td>
      <td class="r">${fmt(i.unitPrice)}</td>
      <td class="r">${i.discountPercent > 0 ? `-${i.discountPercent}%` : '—'}</td>
      <td class="r">${fmt(i.subtotal)}</td>
    </tr>`).join('')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Receipt #${sale.id.slice(-8)}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Courier New',monospace;font-size:11px;max-width:300px;margin:0 auto;padding:12px;color:#111}
  .logo{text-align:center;margin-bottom:10px}
  .logo-name{font-family:Arial,sans-serif;font-size:20px;font-weight:900;letter-spacing:-1px}
  .logo-name span:first-child{color:#f37023}
  .logo-name span:last-child{color:#9c090e}
  .logo-sub{font-family:Arial,sans-serif;font-size:9px;font-weight:700;letter-spacing:4px;text-transform:uppercase;color:#444;margin-top:1px}
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
  @media print{@page{margin:4mm}body{max-width:100%}}
</style>
</head>
<body>
<div class="logo">
  <div class="logo-name"><span>nepa~</span><span>laya</span></div>
  <div class="logo-sub">Books</div>
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
<script>window.onload=()=>{window.print();setTimeout(()=>window.close(),1000)}</script>
</body>
</html>`

  const w = window.open('', '_blank', 'width=380,height=600,toolbar=0,menubar=0')
  if (!w) { alert('Allow popups to print receipt'); return }
  w.document.write(html)
  w.document.close()
}
