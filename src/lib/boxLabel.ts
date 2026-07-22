/**
 * Box label printing — open a print window, with iframe fallback if popups fail.
 */

import JsBarcode from 'jsbarcode'
import type { Box } from '@/types'

export interface BoxLabelData {
  barcode: string
  bookName: string
  author?: string
  isbn?: string
  quantity: number
  warehouseName: string
  warehouseCode: string
  shelfLocation?: string
  batchRef?: string
}

function barcodeSvgDataUrl(barcode: string): string {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  try {
    JsBarcode(svg, barcode, {
      format: 'CODE128',
      width: 1.6,
      height: 48,
      displayValue: true,
      fontSize: 12,
      margin: 4,
    })
  } catch {
    // fallback text-only
  }
  const xml = new XMLSerializer().serializeToString(svg)
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`
}

function buildLabelHtml(labels: BoxLabelData[], logoUrl: string, autoPrint: boolean): string {
  const cards = labels.map((l) => {
    const bc = barcodeSvgDataUrl(l.barcode)
    return `
    <div class="label">
      <div class="header">
        <img src="${logoUrl}" alt="Nepalaya" class="logo" onerror="this.style.display='none'" />
        <div class="wh">${escapeHtml(l.warehouseName)} <span class="code">(${escapeHtml(l.warehouseCode)})</span></div>
      </div>
      <div class="title">${escapeHtml(l.bookName)}</div>
      ${l.author ? `<div class="meta">${escapeHtml(l.author)}</div>` : ''}
      ${l.isbn ? `<div class="meta">ISBN: ${escapeHtml(l.isbn)}</div>` : ''}
      <div class="qty">Qty: <strong>${l.quantity}</strong>${l.shelfLocation ? ` · Shelf: ${escapeHtml(l.shelfLocation)}` : ''}</div>
      ${l.batchRef ? `<div class="meta">Batch: ${escapeHtml(l.batchRef)}</div>` : ''}
      <div class="barcode-wrap">
        <img src="${bc}" alt="${escapeHtml(l.barcode)}" class="barcode" />
      </div>
    </div>`
  }).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Carton Labels (${labels.length})</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:system-ui,-apple-system,sans-serif;color:#111;padding:8px;background:#fff}
  .sheet{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-start}
  .label{
    width:3.5in;min-height:2.2in;border:1px solid #333;border-radius:4px;
    padding:10px 12px;page-break-inside:avoid;break-inside:avoid;
  }
  .header{display:flex;align-items:center;gap:8px;margin-bottom:6px}
  .logo{height:28px;width:auto;object-fit:contain}
  .wh{font-size:11px;font-weight:600;color:#444}
  .code{font-weight:400;color:#888}
  .title{font-size:13px;font-weight:700;line-height:1.25;margin-bottom:2px}
  .meta{font-size:10px;color:#666;margin:1px 0}
  .qty{font-size:12px;margin:6px 0 4px}
  .barcode-wrap{text-align:center;margin-top:4px}
  .barcode{max-width:100%;height:auto}
  .print-btn{
    display:inline-block;margin:8px 0 12px;padding:8px 14px;font-size:13px;
    border:1px solid #333;border-radius:6px;background:#111;color:#fff;cursor:pointer;
  }
  @media print{
    body{padding:0}
    .label{border-color:#000}
    .print-btn{display:none!important}
  }
</style>
</head>
<body>
  ${autoPrint ? '' : '<button class="print-btn" onclick="window.print()">Print labels</button>'}
  <div class="sheet">${cards}</div>
  ${autoPrint ? '<script>window.onload=function(){setTimeout(function(){window.print()},100)}<\/script>' : ''}
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Prefer a real window (like receipts). Do NOT pass noopener — it makes
 * window.open() return null even when the tab opens successfully.
 * Fall back to a hidden iframe so print still works if popups are blocked.
 */
function openPrintWindow(html: string) {
  // No noopener/noreferrer — we need the Window handle to write HTML.
  const w = window.open('', '_blank', 'width=800,height=700,toolbar=0,menubar=0,scrollbars=1')
  if (w) {
    try { w.opener = null } catch { /* ignore */ }
    w.document.open()
    w.document.write(html)
    w.document.close()
    try { w.focus() } catch { /* ignore */ }
    return
  }

  // Popup truly blocked — print via temporary iframe (no new tab needed)
  printViaIframe(html)
}

function printViaIframe(html: string) {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('title', 'Print labels')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none'
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument ?? iframe.contentWindow?.document
  if (!doc) {
    document.body.removeChild(iframe)
    throw new Error('Could not open print view. Try again, or allow pop-ups for this site.')
  }

  doc.open()
  doc.write(html)
  doc.close()

  const cleanup = () => {
    setTimeout(() => {
      try { document.body.removeChild(iframe) } catch { /* ignore */ }
    }, 1500)
  }

  const win = iframe.contentWindow
  if (!win) {
    cleanup()
    throw new Error('Could not open print view. Try again, or allow pop-ups for this site.')
  }

  // Wait a tick so barcode images render, then print
  setTimeout(() => {
    try {
      win.focus()
      win.print()
    } finally {
      cleanup()
    }
  }, 250)
}

export function printBoxLabels(labels: BoxLabelData[], autoPrint = true) {
  if (labels.length === 0) throw new Error('No labels to print')
  const logoUrl = `${window.location.origin}/logo.jpeg`
  const html = buildLabelHtml(labels, logoUrl, autoPrint)
  openPrintWindow(html)
}

export function boxToLabelData(
  box: Pick<Box, 'barcode' | 'bookName' | 'quantity' | 'shelfLocation' | 'batchRef'> & { id?: string },
  warehouse: { name: string; code: string },
  extras?: { author?: string; isbn?: string },
): BoxLabelData {
  return {
    barcode: box.barcode,
    bookName: box.bookName,
    quantity: box.quantity,
    warehouseName: warehouse.name,
    warehouseCode: warehouse.code,
    shelfLocation: box.shelfLocation,
    batchRef: box.batchRef,
    author: extras?.author,
    isbn: extras?.isbn,
  }
}
