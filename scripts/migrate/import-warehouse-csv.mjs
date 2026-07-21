#!/usr/bin/env node
/**
 * Best-effort import of Nepalaya warehouse stock CSV into Supabase.
 * Matches books by title (best score); creates missing books; sets Main Warehouse qty;
 * creates cartons when Boxes + Pcs/Box are clean integers.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate/import-warehouse-csv.mjs [path.csv]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const PRIMARY = 'wh-primary'
const BOOKSTORE = 'wh-bookstore'
const WH_CODE = 'PW'
const csvPath =
  process.argv[2] ||
  '/Users/underhade/Downloads/Nepalaya_Warehouse_Stock_Inventory.xlsx - Stock Inventory.csv'

const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

function parseCsv(text) {
  const rows = []
  let row = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') inQ = false
      else cur += c
    } else if (c === '"') inQ = true
    else if (c === ',') {
      row.push(cur)
      cur = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cur)
      rows.push(row)
      row = []
      cur = ''
    } else cur += c
  }
  if (cur.length || row.length) {
    row.push(cur)
    rows.push(row)
  }
  return rows
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u0900-\u097f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function similarity(a, b) {
  if (!a || !b) return 0
  if (a === b) return 1
  const longer = a.length > b.length ? a : b
  const shorter = a.length > b.length ? b : a
  if (longer.includes(shorter) && shorter.length >= 4) {
    return 0.85 + (0.1 * shorter.length) / longer.length
  }
  // Dice coefficient on bigrams
  const bigrams = (s) => {
    const out = new Map()
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2)
      out.set(g, (out.get(g) || 0) + 1)
    }
    return out
  }
  const A = bigrams(a)
  const B = bigrams(b)
  let inter = 0
  for (const [g, n] of A) inter += Math.min(n, B.get(g) || 0)
  return (2 * inter) / (a.length + b.length - 2 || 1)
}

function parseIntLoose(v) {
  const s = String(v || '')
    .replace(/,/g, '')
    .trim()
  if (!s || s === '-') return null
  if (!/^\d+$/.test(s)) return null
  return parseInt(s, 10)
}

function parseSheet(rows) {
  let start = 0
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === 'S.N.') {
      start = i + 1
      break
    }
  }
  const items = []
  for (const r of rows.slice(start)) {
    if (!r?.[0] || !/^\d+$/.test(String(r[0]).trim())) continue
    const title = String(r[1] || '').trim()
    if (!title) continue
    items.push({
      sn: r[0].trim(),
      title,
      boxes: parseIntLoose(r[2]),
      pcsPerBox: parseIntLoose(r[3]),
      total: parseIntLoose(r[4]) ?? 0,
      remarks: String(r[5] || '').trim(),
    })
  }
  return items
}

async function loadBooks() {
  const all = []
  let from = 0
  for (;;) {
    const { data, error } = await sb
      .from('books')
      .select('id,name,author,isbn,in_stock,is_deleted')
      .range(from, from + 999)
    if (error) throw error
    all.push(...(data ?? []))
    if (!data || data.length < 1000) break
    from += 1000
  }
  return all.filter((b) => !b.is_deleted)
}

function pickBook(title, books) {
  const n = norm(title)
  if (n.includes('loose stock') && n.includes('unspecified')) {
    return { kind: 'skip', book: null, score: 0 }
  }
  let best = null
  let bestScore = 0
  const ties = []
  for (const b of books) {
    const score = similarity(n, norm(b.name))
    if (score > bestScore + 0.001) {
      bestScore = score
      best = b
      ties.length = 0
      ties.push(b)
    } else if (Math.abs(score - bestScore) <= 0.001 && score > 0.75) {
      ties.push(b)
    }
  }
  // Prefer non-empty name exact-ish
  if (bestScore >= 0.78) {
    // Prefer edition-aware: if title has nepali/english/hard, bias
    const t = n
    const ranked = ties
      .map((b) => {
        const bn = norm(b.name)
        let bonus = 0
        if (t.includes('nepali') && bn.includes('nep')) bonus += 0.05
        if (t.includes('english') && (bn.includes('eng') || bn.includes('english'))) bonus += 0.05
        if (t.includes('hard') && bn.includes('hard')) bonus += 0.05
        if (t.includes('paperback') && bn.includes('paper')) bonus += 0.03
        return { b, s: similarity(t, bn) + bonus }
      })
      .sort((a, b) => b.s - a.s)
    return { kind: 'match', book: ranked[0].b, score: ranked[0].s }
  }
  return { kind: 'create', book: null, score: bestScore }
}

async function ensureBook(title, existingBooks) {
  const pick = pickBook(title, existingBooks)
  if (pick.kind === 'skip') return { ...pick, bookId: null }
  if (pick.kind === 'match') return { ...pick, bookId: pick.book.id }

  const id = randomUUID().replace(/-/g, '').slice(0, 20)
  const row = {
    id,
    name: title,
    author: null,
    isbn: '',
    language: 'Nepali',
    category: 'other',
    publisher: 'Nepalaya',
    mrp: 0,
    cost_price: 0,
    in_stock: 0,
    min_stock_alert: 5,
    description: 'Created from warehouse stock inventory import',
    is_deleted: false,
  }
  const { error } = await sb.from('books').insert(row)
  if (error) throw new Error(`create book ${title}: ${error.message}`)
  existingBooks.push({ id, name: title, is_deleted: false })
  return { kind: 'create', book: row, bookId: id, score: 0 }
}

async function setWarehouseQty(bookId, qty) {
  const { data: inv } = await sb.from('book_inventory').select('*').eq('book_id', bookId).maybeSingle()
  const by = { ...(inv?.by_warehouse ?? {}) }
  // Preserve bookstore floor; set primary warehouse to sheet total
  const retail = Number(by[BOOKSTORE] ?? inv?.retail_qty ?? 0)
  by[PRIMARY] = qty
  // Keep other warehouse keys as-is except primary
  let whTotal = 0
  for (const [k, v] of Object.entries(by)) {
    if (k === BOOKSTORE) continue
    whTotal += Number(v) || 0
  }
  const payload = {
    book_id: bookId,
    by_warehouse: by,
    total_warehouse_qty: whTotal,
    retail_qty: retail,
    updated_at: new Date().toISOString(),
  }
  const { error } = await sb.from('book_inventory').upsert(payload)
  if (error) throw new Error(`inventory ${bookId}: ${error.message}`)
}

async function nextSeqs(count) {
  // Allocate via counters table (service role)
  const id = `box-seq-${WH_CODE}`
  await sb.from('counters').upsert({ id, value: 0, updated_at: new Date().toISOString() }, { onConflict: 'id', ignoreDuplicates: true })
  const { data: row, error } = await sb.from('counters').select('value').eq('id', id).single()
  if (error) throw error
  const cur = Number(row.value ?? 0)
  const seqs = Array.from({ length: count }, (_, i) => cur + i + 1)
  const { error: uerr } = await sb
    .from('counters')
    .update({ value: cur + count, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (uerr) throw uerr
  return seqs
}

async function createCartons(bookId, bookName, boxes, pcsPerBox, total) {
  if (!boxes || boxes <= 0 || !pcsPerBox || pcsPerBox <= 0) {
    // Loose / open remainder only
    if (total <= 0) return []
    const [seq] = await nextSeqs(1)
    const barcode = `NPBX-${WH_CODE}-${String(seq).padStart(6, '0')}`
    const id = randomUUID()
    const { error } = await sb.from('boxes').insert({
      id,
      barcode,
      book_id: bookId,
      book_name: bookName,
      warehouse_id: PRIMARY,
      quantity: total,
      initial_quantity: total,
      status: 'open',
      shelf_location: '',
      batch_ref: 'WH-IMPORT',
      notes: 'Loose / open carton from warehouse CSV import',
      opened_at: new Date().toISOString(),
      is_deleted: false,
    })
    if (error) throw error
    return [{ id, barcode, quantity: total, status: 'open' }]
  }

  const fullQty = boxes * pcsPerBox
  const rem = Math.max(0, total - fullQty)
  const created = []
  const need = boxes + (rem > 0 ? 1 : 0)
  const seqs = await nextSeqs(need)

  for (let i = 0; i < boxes; i++) {
    const barcode = `NPBX-${WH_CODE}-${String(seqs[i]).padStart(6, '0')}`
    const id = randomUUID()
    const { error } = await sb.from('boxes').insert({
      id,
      barcode,
      book_id: bookId,
      book_name: bookName,
      warehouse_id: PRIMARY,
      quantity: pcsPerBox,
      initial_quantity: pcsPerBox,
      status: 'sealed',
      shelf_location: '',
      batch_ref: 'WH-IMPORT',
      notes: 'Imported from warehouse stock inventory CSV',
      is_deleted: false,
    })
    if (error) throw error
    created.push({ id, barcode, quantity: pcsPerBox, status: 'sealed' })
  }
  if (rem > 0) {
    const barcode = `NPBX-${WH_CODE}-${String(seqs[boxes]).padStart(6, '0')}`
    const id = randomUUID()
    const { error } = await sb.from('boxes').insert({
      id,
      barcode,
      book_id: bookId,
      book_name: bookName,
      warehouse_id: PRIMARY,
      quantity: rem,
      initial_quantity: rem,
      status: 'open',
      shelf_location: '',
      batch_ref: 'WH-IMPORT',
      notes: 'Remainder open carton from warehouse CSV import',
      opened_at: new Date().toISOString(),
      is_deleted: false,
    })
    if (error) throw error
    created.push({ id, barcode, quantity: rem, status: 'open' })
  }
  return created
}

async function main() {
  const raw = readFileSync(csvPath, 'utf8')
  const items = parseSheet(parseCsv(raw))
  console.log(`Parsed ${items.length} rows from CSV`)

  const books = await loadBooks()
  console.log(`Loaded ${books.length} books from Supabase`)

  const report = []
  let matched = 0
  let created = 0
  let skipped = 0
  let cartons = 0
  let pieces = 0

  for (const item of items) {
    try {
      const resolved = await ensureBook(item.title, books)
      if (resolved.kind === 'skip' || !resolved.bookId) {
        skipped++
        report.push({ ...item, action: 'skipped', reason: 'unspecified loose stock' })
        console.log(`SKIP  ${item.title}`)
        continue
      }

      const bookId = resolved.bookId
      const bookName = resolved.book?.name || item.title
      if (resolved.kind === 'create') {
        created++
        console.log(`NEW   ${item.title} → ${bookId}`)
      } else {
        matched++
        console.log(`MATCH ${item.title} → ${bookName} (${resolved.score.toFixed(2)})`)
      }

      await setWarehouseQty(bookId, item.total)
      pieces += item.total

      // Create cartons when we have usable box math, or always create open carton for loose totals
      const canFull =
        item.boxes != null &&
        item.pcsPerBox != null &&
        item.boxes > 0 &&
        item.pcsPerBox > 0

      const made = await createCartons(
        bookId,
        bookName,
        canFull ? item.boxes : null,
        canFull ? item.pcsPerBox : null,
        item.total,
      )
      cartons += made.length

      await sb.from('inventory_movements').insert({
        type: 'receive',
        book_id: bookId,
        book_name: bookName,
        quantity: item.total,
        warehouse_id: PRIMARY,
        reason: `Warehouse CSV import SN ${item.sn}${item.remarks ? ` — ${item.remarks}` : ''}`,
        performed_by_name: 'CSV Import',
      })

      report.push({
        sn: item.sn,
        title: item.title,
        total: item.total,
        action: resolved.kind,
        matchedTo: bookName,
        bookId,
        score: resolved.score,
        cartons: made.length,
        remarks: item.remarks,
      })
    } catch (e) {
      console.error(`FAIL  ${item.title}:`, e.message || e)
      report.push({ ...item, action: 'error', error: String(e.message || e) })
    }
  }

  const outDir = join(__dirname, 'data')
  mkdirSync(outDir, { recursive: true })
  const outFile = join(outDir, 'warehouse-csv-import-report.json')
  writeFileSync(outFile, JSON.stringify(report, null, 2))

  console.log('\n=== Done ===')
  console.log(`Matched existing: ${matched}`)
  console.log(`Created books:    ${created}`)
  console.log(`Skipped:          ${skipped}`)
  console.log(`Cartons created:  ${cartons}`)
  console.log(`Pieces set @ PW:  ${pieces}`)
  console.log(`Report: ${outFile}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
