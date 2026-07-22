import { useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'
import { Download, FileUp, Printer, CheckCircle2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useWarehouse } from '@/contexts/WarehouseContext'
import { useBooks } from '@/contexts/BooksContext'
import { receiveBoxes } from '@/lib/inventoryService'
import { printBoxLabels, boxToLabelData } from '@/lib/boxLabel'
import { downloadCSV } from '@/lib/csvUtils'
import { opsErrorMessage } from '@/lib/opsErrors'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { PageSpinner } from '@/components/ui/Spinner'
import type { Book } from '@/types'

const HEADERS = ['Book Title', 'Boxes', 'Pcs/Box', 'Total Pieces', 'Remarks'] as const

const TEMPLATE_ROWS: (string | number)[][] = [
  ['Example Title', 2, 24, 48, 'Optional note'],
  ['Another Book', 1, 20, 20, ''],
]

type ParsedRow = {
  title: string
  boxes: number | null
  pcsPerBox: number | null
  total: number
  remarks: string
  book: Book | null
  matchScore: number
  create: boolean
  valid: boolean
  error?: string
}

function norm(s: string) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u0900-\u097f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function similarity(a: string, b: string) {
  if (!a || !b) return 0
  if (a === b) return 1
  const longer = a.length > b.length ? a : b
  const shorter = a.length > b.length ? b : a
  if (longer.includes(shorter) && shorter.length >= 4) return shorter.length / longer.length
  let matches = 0
  const as = new Set(a.split(' '))
  for (const w of b.split(' ')) if (as.has(w) && w.length > 2) matches++
  const tokens = Math.max(as.size, b.split(' ').length, 1)
  return matches / tokens
}

function bestMatch(title: string, books: Book[]): { book: Book | null; score: number } {
  const n = norm(title)
  let best: Book | null = null
  let score = 0
  // Warehouse import is Nepalaya-only
  const pool = books.filter((b) => b.language === 'Nepalaya' || !b.language)
  for (const b of pool) {
    const s = similarity(n, norm(b.name))
    if (s > score) {
      score = s
      best = b
    }
  }
  return { book: score >= 0.75 ? best : null, score }
}

function parseNum(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

export default function ImportStock() {
  const { appUser } = useAuth()
  const { books, loading: booksLoading } = useBooks()
  const { primaryWarehouse, bufferWarehouse, bookstoreId } = useWarehouse()
  const fileRef = useRef<HTMLInputElement>(null)

  const [warehouseId, setWarehouseId] = useState(primaryWarehouse?.id ?? 'wh-primary')
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [createdLabels, setCreatedLabels] = useState<Array<{ id: string; barcode: string; quantity: number; bookName: string }>>([])

  const warehouseOptions = [
    { value: primaryWarehouse?.id ?? 'wh-primary', label: 'Main Warehouse' },
    { value: bufferWarehouse?.id ?? 'wh-buffer', label: 'Backroom' },
  ]

  const selectedWh = warehouseId === (bufferWarehouse?.id ?? 'wh-buffer')
    ? bufferWarehouse
    : primaryWarehouse

  const preview = useMemo(() => {
    const valid = rows.filter((r) => r.valid)
    const create = valid.filter((r) => r.create).length
    const match = valid.filter((r) => !r.create).length
    const pieces = valid.reduce((s, r) => s + r.total, 0)
    return { valid: valid.length, create, match, pieces, invalid: rows.length - valid.length }
  }, [rows])

  const downloadTemplate = () => {
    downloadCSV('nepalaya_stock_import_template.csv', [...HEADERS], TEMPLATE_ROWS)
  }

  const parseFile = async (file: File) => {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
    if (raw.length === 0) {
      toast.error('Sheet is empty')
      return
    }

    const parsed: ParsedRow[] = raw.map((r) => {
      const title = String(r['Book Title'] ?? r['Title'] ?? r['book title'] ?? r['title'] ?? '').trim()
      const boxes = parseNum(r['Boxes'] ?? r['boxes'])
      const pcsPerBox = parseNum(r['Pcs/Box'] ?? r['Pcs per Box'] ?? r['pcs/box'])
      let total = parseNum(r['Total Pieces'] ?? r['Total'] ?? r['total pieces']) ?? 0
      const remarks = String(r['Remarks'] ?? r['remarks'] ?? '').trim()

      if (!title) {
        return { title: '', boxes, pcsPerBox, total, remarks, book: null, matchScore: 0, create: false, valid: false, error: 'Missing title' }
      }
      if (total <= 0 && boxes && pcsPerBox) total = boxes * pcsPerBox
      if (total <= 0) {
        return { title, boxes, pcsPerBox, total, remarks, book: null, matchScore: 0, create: false, valid: false, error: 'Need Total Pieces (or Boxes × Pcs/Box)' }
      }

      const { book, score } = bestMatch(title, books)
      return {
        title,
        boxes,
        pcsPerBox: pcsPerBox && pcsPerBox > 0 ? pcsPerBox : (boxes && boxes > 0 ? Math.ceil(total / boxes) : total),
        total,
        remarks,
        book,
        matchScore: score,
        create: !book,
        valid: true,
      }
    })

    setRows(parsed)
    setCreatedLabels([])
    toast.success(`Parsed ${parsed.length} rows`)
  }

  const ensureBook = async (title: string): Promise<Book> => {
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 20)
    const row = {
      id,
      name: title,
      author: '',
      isbn: '',
      language: 'Nepalaya',
      category: 'other',
      publisher: 'Nepalaya',
      mrp: 0,
      cost_price: 0,
      in_stock: 0,
      min_stock_alert: 5,
      description: 'Created from stock sheet import',
      is_deleted: false,
      created_by: appUser?.uid ?? '',
    }
    const { error } = await supabase.from('books').insert(row)
    if (error) throw new Error(error.message)
    return {
      id,
      name: title,
      author: '',
      isbn: '',
      language: 'Nepalaya',
      category: 'other',
      publisher: 'Nepalaya',
      mrp: 0,
      costPrice: 0,
      inStock: 0,
      minStockAlert: 5,
      description: row.description,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: appUser?.uid ?? '',
      isDeleted: false,
    } as Book
  }

  const runImport = async () => {
    if (!appUser || !selectedWh) return
    const valid = rows.filter((r) => r.valid)
    if (valid.length === 0) {
      toast.error('No valid rows')
      return
    }
    setImporting(true)
    setProgress({ done: 0, total: valid.length })
    const labels: Array<{ id: string; barcode: string; quantity: number; bookName: string }> = []

    try {
      for (let i = 0; i < valid.length; i++) {
        const row = valid[i]
        let book = row.book
        if (!book || row.create) {
          book = await ensureBook(row.title)
        }
        const perBox = row.pcsPerBox && row.pcsPerBox > 0
          ? row.pcsPerBox
          : row.total
        const result = await receiveBoxes({
          bookId: book.id,
          bookName: book.name,
          warehouseId: selectedWh.id,
          warehouseCode: selectedWh.code,
          bookstoreId,
          totalQuantity: row.total,
          copiesPerBox: perBox,
          batchRef: 'SHEET-IMPORT',
          notes: row.remarks || 'Imported from stock sheet',
          user: appUser,
        })
        for (const b of result.boxes) {
          labels.push({ ...b, bookName: book.name })
        }
        setProgress({ done: i + 1, total: valid.length })
      }
      setCreatedLabels(labels)
      toast.success(`Imported ${valid.length} titles · ${labels.length} cartons`)
    } catch (e) {
      toast.error(opsErrorMessage(e, 'Import failed'))
    } finally {
      setImporting(false)
    }
  }

  if (booksLoading) return <PageSpinner />

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <FileUp className="h-6 w-6 text-accent-600" />
          Import stock
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Nepalaya warehouse only · download template, upload, print labels
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
        <ol className="text-sm text-gray-600 space-y-2 list-decimal list-inside">
          <li>Download the CSV template (Nepalaya titles)</li>
          <li>Fill Book Title, Boxes, Pcs/Box, Total Pieces</li>
          <li>Upload and confirm matches</li>
          <li>Import into Warehouse, then print labels</li>
        </ol>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={downloadTemplate}>
            <Download className="h-4 w-4" /> Download template
          </Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <FileUp className="h-4 w-4" /> Choose sheet
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void parseFile(f)
              e.target.value = ''
            }}
          />
        </div>

        <Select
          label="Import into"
          value={warehouseId}
          onChange={(e) => setWarehouseId(e.target.value)}
          options={warehouseOptions}
        />
      </div>

      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
            <span>{preview.valid} ready</span>
            <span>· {preview.match} matched</span>
            <span>· {preview.create} new books</span>
            <span>· {preview.pieces.toLocaleString()} pieces</span>
            {preview.invalid > 0 && <span className="text-red-600">{preview.invalid} invalid</span>}
            <Button
              className="ml-auto"
              loading={importing}
              disabled={importing || preview.valid === 0}
              onClick={() => void runImport()}
            >
              Import {preview.valid} rows
            </Button>
          </div>
          {progress && (
            <p className="text-xs text-gray-500">
              Progress {progress.done}/{progress.total}
            </p>
          )}

          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white max-h-80 overflow-y-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">Title</th>
                  <th className="px-3 py-2 text-right">Boxes</th>
                  <th className="px-3 py-2 text-right">Pcs/Box</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-left">Match</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r, i) => (
                  <tr key={i} className={!r.valid ? 'bg-red-50' : undefined}>
                    <td className="px-3 py-2">{r.title || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.boxes ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.pcsPerBox ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.total || '—'}</td>
                    <td className="px-3 py-2 text-xs">
                      {!r.valid ? (
                        <span className="text-red-600">{r.error}</span>
                      ) : r.create ? (
                        <span className="text-amber-700">Create new</span>
                      ) : (
                        <span className="text-green-700">{r.book?.name} ({r.matchScore.toFixed(2)})</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {createdLabels.length > 0 && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 space-y-3">
          <p className="text-sm font-medium text-green-900 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            Created {createdLabels.length} cartons
          </p>
          <Button
            onClick={() => {
              const wh = selectedWh ?? { name: 'Main Warehouse', code: 'PW' }
              printBoxLabels(
                createdLabels.map((b) =>
                  boxToLabelData(
                    {
                      barcode: b.barcode,
                      bookName: b.bookName,
                      quantity: b.quantity,
                      batchRef: 'SHEET-IMPORT',
                    },
                    { name: wh.name, code: wh.code },
                  ),
                ),
              )
            }}
          >
            <Printer className="h-4 w-4" /> Print barcode labels
          </Button>
        </div>
      )}
    </div>
  )
}
