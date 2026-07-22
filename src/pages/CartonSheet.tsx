import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Search, Boxes, PackagePlus, Download, ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { mapBox } from '@/lib/mappers'
import { fetchAllPages } from '@/lib/fetchAll'
import { useBooks } from '@/contexts/BooksContext'
import { useWarehouse } from '@/contexts/WarehouseContext'
import { isNepalaya } from '@/lib/bookCategories'
import { downloadCSV } from '@/lib/csvUtils'
import { cn } from '@/lib/utils'
import type { Box, Book } from '@/types'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { PageSpinner } from '@/components/ui/Spinner'

type Row = {
  bookId: string
  book: Book | null
  name: string
  author: string
  coverUrl?: string
  boxes: number
  pcsPerBox: number | null
  total: number
  whPcs: number
  brPcs: number
}

/** Spreadsheet-style Nepalaya carton stock — loads ALL cartons (paginated). */
export default function CartonSheet() {
  const navigate = useNavigate()
  const { books, loading: booksLoading } = useBooks()
  const { primaryWarehouse, bufferWarehouse, getWarehouseStock, inventoryLoading } = useWarehouse()
  const [boxes, setBoxes] = useState<(Box & { id: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [page, setPage] = useState(1)

  const PAGE_SIZE = 30

  const primaryId = primaryWarehouse?.id ?? 'wh-primary'
  const bufferId = bufferWarehouse?.id ?? 'wh-buffer'
  const bookById = useMemo(() => new Map(books.map((b) => [b.id, b])), [books])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        // Load every non-empty carton (not only primary/buffer — import may use other ids)
        const rows = await fetchAllPages<Record<string, unknown>>(async (from, to) => {
          const res = await supabase
            .from('boxes')
            .select('id,barcode,book_id,book_name,warehouse_id,quantity,initial_quantity,status,is_deleted,created_at')
            .neq('status', 'empty')
            .order('created_at', { ascending: true })
            .range(from, to)
          return { data: res.data as Record<string, unknown>[] | null, error: res.error }
        })
        if (cancelled) return
        setBoxes(
          rows
            .map((r) => mapBox(r))
            .filter((b) => !b.isDeleted && b.quantity > 0),
        )
      } catch (e) {
        if (!cancelled) {
          console.warn('cartons load failed', e)
          toast.error(e instanceof Error ? e.message : 'Could not load cartons')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  const rows = useMemo(() => {
    const byBook = new Map<string, (Box & { id: string })[]>()
    for (const b of boxes) {
      // Prefer warehouse + backroom; still count others so nothing is silently dropped
      const list = byBook.get(b.bookId) ?? []
      list.push(b)
      byBook.set(b.bookId, list)
    }

    const out: Row[] = []
    const seen = new Set<string>()

    for (const [bookId, bookBoxes] of byBook) {
      seen.add(bookId)
      const book = bookById.get(bookId) ?? null
      // Skip pure third-party shelf books with no warehouse cartons in primary/buffer
      // but always show if they have any carton rows
      const cartonCount = bookBoxes.length
      const pieceFromCartons = bookBoxes.reduce((s, b) => s + b.quantity, 0)
      const whPcs = getWarehouseStock(bookId, primaryId)
      const brPcs = getWarehouseStock(bookId, bufferId)
      const total = Math.max(whPcs + brPcs, pieceFromCartons)
      const pcsPerBox = cartonCount > 0 ? Math.round(pieceFromCartons / cartonCount) : null
      out.push({
        bookId,
        book,
        name: book?.name ?? bookBoxes[0]?.bookName ?? 'Unknown book',
        author: book?.author ?? '',
        coverUrl: book?.coverUrl,
        boxes: cartonCount,
        pcsPerBox,
        total,
        whPcs,
        brPcs,
      })
    }

    // Nepalaya titles with warehouse qty but no carton rows yet
    for (const book of books) {
      if (seen.has(book.id)) continue
      if (!isNepalaya(book)) continue
      const whPcs = getWarehouseStock(book.id, primaryId)
      const brPcs = getWarehouseStock(book.id, bufferId)
      if (whPcs + brPcs <= 0) continue
      out.push({
        bookId: book.id,
        book,
        name: book.name,
        author: book.author ?? '',
        coverUrl: book.coverUrl,
        boxes: 0,
        pcsPerBox: null,
        total: whPcs + brPcs,
        whPcs,
        brPcs,
      })
    }

    const q = deferredSearch.trim().toLowerCase()
    return out
      .filter((r) => r.total > 0 || r.boxes > 0)
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.author.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [boxes, books, bookById, deferredSearch, getWarehouseStock, primaryId, bufferId])

  const totals = useMemo(() => {
    let boxesN = 0
    let pcs = 0
    let wh = 0
    let br = 0
    for (const r of rows) {
      boxesN += r.boxes
      pcs += r.total
      wh += r.whPcs
      br += r.brPcs
    }
    return { boxesN, pcs, titles: rows.length, wh, br }
  }, [rows])

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const pageSafe = Math.min(page, pageCount)
  const pageRows = rows.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE)

  useEffect(() => {
    setPage(1)
  }, [deferredSearch])

  const exportExcel = () => {
    downloadCSV(
      `nepalaya-cartons-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Book', 'Author', 'Cartons', 'Pcs per carton', 'Warehouse pcs', 'Backroom pcs', 'Total pcs'],
      rows.map((r) => [
        r.name,
        r.author,
        r.boxes,
        r.pcsPerBox ?? '',
        r.whPcs,
        r.brPcs,
        r.total,
      ]),
    )
  }

  if (booksLoading || loading || inventoryLoading) return <PageSpinner />

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cartons</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            All warehouse cartons · {totals.titles} titles · {totals.boxesN.toLocaleString()} cartons
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="lg" variant="outline" className="min-h-12" onClick={exportExcel}>
            <Download className="h-5 w-5" /> Excel
          </Button>
          <Button size="lg" className="min-h-12 px-5 text-base" onClick={() => navigate('/receive/warehouse')}>
            <PackagePlus className="h-5 w-5" /> Stock in
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'Titles', value: totals.titles },
          { label: 'Cartons', value: totals.boxesN.toLocaleString() },
          { label: 'Warehouse', value: totals.wh.toLocaleString() },
          { label: 'Backroom', value: totals.br.toLocaleString() },
        ].map((c) => (
          <div key={c.label} className="rounded-2xl border border-gray-200 bg-white p-3 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{c.label}</p>
            <p className="text-xl font-bold tabular-nums text-gray-900 mt-1">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-accent-100 bg-accent-50/50 px-4 py-3 text-sm text-accent-900">
        Total pieces: <strong className="tabular-nums">{totals.pcs.toLocaleString()}</strong>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
        <Input
          className="pl-11 min-h-12 text-base"
          placeholder="Search book title…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <div className="grid grid-cols-[1fr_4.5rem_4.5rem_5rem] gap-1 border-b border-gray-100 bg-gray-50 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          <span>Book</span>
          <span className="text-right">Cartons</span>
          <span className="text-right">Pcs/box</span>
          <span className="text-right">Total</span>
        </div>
        <ul className="divide-y divide-gray-100">
          {rows.length === 0 && (
            <li className="px-4 py-12 text-center text-gray-400">
              No carton stock yet. Tap Stock in.
            </li>
          )}
          {pageRows.map((r) => (
            <li key={r.bookId}>
              <button
                type="button"
                onClick={() => navigate(`/books/${r.bookId}`)}
                className="grid w-full grid-cols-[1fr_4.5rem_4.5rem_5rem] gap-1 px-3 py-3.5 text-left hover:bg-accent-50/40 active:bg-accent-50"
              >
                <div className="min-w-0 flex items-center gap-2">
                  {r.coverUrl ? (
                    <img src={r.coverUrl} alt="" className="h-10 w-7 rounded object-cover shrink-0 bg-gray-100" />
                  ) : (
                    <div className="h-10 w-7 rounded bg-gray-100 shrink-0 flex items-center justify-center">
                      <Boxes className="h-3.5 w-3.5 text-gray-300" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 text-[15px] leading-snug line-clamp-2">{r.name}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      WH {r.whPcs} · Back {r.brPcs}
                    </p>
                  </div>
                </div>
                <span className={cn('self-center text-right text-lg font-bold tabular-nums', r.boxes ? 'text-gray-900' : 'text-gray-300')}>
                  {r.boxes || '—'}
                </span>
                <span className={cn('self-center text-right text-lg font-bold tabular-nums', r.pcsPerBox ? 'text-gray-900' : 'text-gray-300')}>
                  {r.pcsPerBox ?? '—'}
                </span>
                <span className="self-center text-right text-lg font-bold tabular-nums text-accent-800">
                  {r.total.toLocaleString()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {rows.length > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-gray-500">
            {(pageSafe - 1) * PAGE_SIZE + 1}–{Math.min(pageSafe * PAGE_SIZE, rows.length)} of {rows.length}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-10"
              disabled={pageSafe <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-4 w-4" /> Prev
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-10"
              disabled={pageSafe >= pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
