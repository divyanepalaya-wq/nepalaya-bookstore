import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Boxes, PackagePlus, Download } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { mapBox } from '@/lib/mappers'
import { useBooks } from '@/contexts/BooksContext'
import { useWarehouse } from '@/contexts/WarehouseContext'
import { isNepalaya } from '@/lib/bookCategories'
import { downloadCSV } from '@/lib/csvUtils'
import { cn } from '@/lib/utils'
import type { Box } from '@/types'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { PageSpinner } from '@/components/ui/Spinner'

/** Spreadsheet-style Nepalaya carton stock for warehouse. */
export default function CartonSheet() {
  const navigate = useNavigate()
  const { books, loading: booksLoading } = useBooks()
  const { primaryWarehouse, bufferWarehouse, getWarehouseStock } = useWarehouse()
  const [boxes, setBoxes] = useState<(Box & { id: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const primaryId = primaryWarehouse?.id ?? 'wh-primary'
  const bufferId = bufferWarehouse?.id ?? 'wh-buffer'

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data, error } = await supabase
        .from('boxes')
        .select('*')
        .in('warehouse_id', [primaryId, bufferId])
        .neq('status', 'empty')
        .limit(5000)
      if (cancelled) return
      if (error) {
        setLoading(false)
        return
      }
      setBoxes(
        (data ?? [])
          .map((r) => mapBox(r as Record<string, unknown>))
          .filter((b) => !b.isDeleted && b.quantity > 0),
      )
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [primaryId, bufferId])

  const rows = useMemo(() => {
    const nepalaya = books.filter((b) => isNepalaya(b))
    const q = search.trim().toLowerCase()
    return nepalaya
      .map((book) => {
        const bookBoxes = boxes.filter((b) => b.bookId === book.id)
        const cartonCount = bookBoxes.length
        const pieceFromCartons = bookBoxes.reduce((s, b) => s + b.quantity, 0)
        const pcsPerBox =
          cartonCount > 0
            ? Math.round(pieceFromCartons / cartonCount)
            : null
        const whPcs = getWarehouseStock(book.id, primaryId)
        const brPcs = getWarehouseStock(book.id, bufferId)
        const total = Math.max(whPcs + brPcs, pieceFromCartons)
        return {
          book,
          boxes: cartonCount,
          pcsPerBox,
          total,
          whPcs,
          brPcs,
        }
      })
      .filter((r) => r.total > 0 || r.boxes > 0)
      .filter((r) => !q || r.book.name.toLowerCase().includes(q) || (r.book.author ?? '').toLowerCase().includes(q))
      .sort((a, b) => a.book.name.localeCompare(b.book.name))
  }, [books, boxes, search, getWarehouseStock, primaryId, bufferId])

  const totals = useMemo(() => {
    let boxesN = 0
    let pcs = 0
    for (const r of rows) {
      boxesN += r.boxes
      pcs += r.total
    }
    return { boxesN, pcs, titles: rows.length }
  }, [rows])

  const exportExcel = () => {
    downloadCSV(
      `nepalaya-cartons-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Book', 'Author', 'Cartons', 'Pcs per carton', 'Warehouse pcs', 'Backroom pcs', 'Total pcs'],
      rows.map((r) => [
        r.book.name,
        r.book.author ?? '',
        r.boxes,
        r.pcsPerBox ?? '',
        r.whPcs,
        r.brPcs,
        r.total,
      ]),
    )
  }

  if (booksLoading || loading) return <PageSpinner />

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cartons</h1>
          <p className="text-sm text-gray-500 mt-0.5">Nepalaya warehouse sheet</p>
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

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Titles', value: totals.titles },
          { label: 'Cartons', value: totals.boxesN },
          { label: 'Pieces', value: totals.pcs.toLocaleString() },
        ].map((c) => (
          <div key={c.label} className="rounded-2xl border border-gray-200 bg-white p-4 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{c.label}</p>
            <p className="text-2xl font-bold tabular-nums text-gray-900 mt-1">{c.value}</p>
          </div>
        ))}
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
              No Nepalaya stock yet. Tap Stock in.
            </li>
          )}
          {rows.map((r) => (
            <li key={r.book.id}>
              <button
                type="button"
                onClick={() => navigate(`/books/${r.book.id}`)}
                className="grid w-full grid-cols-[1fr_4.5rem_4.5rem_5rem] gap-1 px-3 py-3.5 text-left hover:bg-accent-50/40 active:bg-accent-50"
              >
                <div className="min-w-0 flex items-center gap-2">
                  {r.book.coverUrl ? (
                    <img src={r.book.coverUrl} alt="" className="h-10 w-7 rounded object-cover shrink-0 bg-gray-100" />
                  ) : (
                    <div className="h-10 w-7 rounded bg-gray-100 shrink-0 flex items-center justify-center">
                      <Boxes className="h-3.5 w-3.5 text-gray-300" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 text-[15px] leading-snug line-clamp-2">{r.book.name}</p>
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
    </div>
  )
}
