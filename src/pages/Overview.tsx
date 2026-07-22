import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { LayoutDashboard, Boxes, BookOpen, Store, Warehouse, Package, ArrowRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { mapBox } from '@/lib/mappers'
import { fetchAllPages } from '@/lib/fetchAll'
import { useBooks } from '@/contexts/BooksContext'
import { useWarehouse } from '@/contexts/WarehouseContext'
import { isNepalaya, isThirdParty } from '@/lib/bookCategories'
import { PageSpinner } from '@/components/ui/Spinner'
import type { Box } from '@/types'

/** Overall stock picture — cartons, pieces, where they are. */
export default function Overview() {
  const { books, loading: booksLoading } = useBooks()
  const {
    primaryWarehouse, bufferWarehouse,
    getRetailStock, getWarehouseStock, inventoryLoading,
  } = useWarehouse()
  const [boxes, setBoxes] = useState<(Box & { id: string })[]>([])
  const [loadingBoxes, setLoadingBoxes] = useState(true)

  const primaryId = primaryWarehouse?.id ?? 'wh-primary'
  const bufferId = bufferWarehouse?.id ?? 'wh-buffer'

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
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
        setBoxes(rows.map((r) => mapBox(r)).filter((b) => !b.isDeleted && b.quantity > 0))
      } catch (e) {
        console.warn('overview boxes', e)
      } finally {
        if (!cancelled) setLoadingBoxes(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  const stats = useMemo(() => {
    let cartons = 0
    let cartonPcs = 0
    let whPcs = 0
    let backPcs = 0
    let shelfPcs = 0
    let nepalayaTitles = 0
    let thirdTitles = 0
    let shelfTitles = 0

    const booksWithCartons = new Set<string>()
    for (const b of boxes) {
      cartons += 1
      cartonPcs += b.quantity
      booksWithCartons.add(b.bookId)
    }

    for (const book of books) {
      const main = getWarehouseStock(book.id, primaryId)
      const back = getWarehouseStock(book.id, bufferId)
      const shelf = getRetailStock(book.id, book.inStock)
      whPcs += main
      backPcs += back
      shelfPcs += shelf
      if (isNepalaya(book) && (main + back + shelf > 0 || booksWithCartons.has(book.id))) {
        nepalayaTitles += 1
      }
      if (isThirdParty(book) && shelf > 0) thirdTitles += 1
      if (shelf > 0) shelfTitles += 1
    }

    return {
      cartons,
      cartonPcs,
      whPcs,
      backPcs,
      shelfPcs,
      totalPcs: Math.max(whPcs + backPcs + shelfPcs, cartonPcs + shelfPcs),
      bookTitles: books.length,
      nepalayaTitles,
      thirdTitles,
      shelfTitles,
    }
  }, [boxes, books, getRetailStock, getWarehouseStock, primaryId, bufferId])

  if (booksLoading || inventoryLoading || loadingBoxes) return <PageSpinner />

  const cards = [
    { label: 'Cartons', value: stats.cartons.toLocaleString(), sub: `${stats.cartonPcs.toLocaleString()} pcs in cartons`, icon: Boxes, to: '/cartons' },
    { label: 'Warehouse', value: stats.whPcs.toLocaleString(), sub: 'Main warehouse pcs', icon: Warehouse, to: '/cartons' },
    { label: 'Backroom', value: stats.backPcs.toLocaleString(), sub: 'Ready for floor', icon: Package, to: '/send' },
    { label: 'Shelf', value: stats.shelfPcs.toLocaleString(), sub: `${stats.shelfTitles} titles on sale`, icon: Store, to: '/sell' },
  ]

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <LayoutDashboard className="h-7 w-7 text-accent-600" />
          Overview
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Where stock is · {stats.bookTitles.toLocaleString()} books in catalog
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {cards.map((c) => (
          <Link
            key={c.label}
            to={c.to}
            className="rounded-2xl border border-gray-200 bg-white p-4 hover:border-accent-300 hover:bg-accent-50/30 transition"
          >
            <div className="flex items-center gap-2 text-gray-500">
              <c.icon className="h-4 w-4" />
              <span className="text-[11px] font-semibold uppercase tracking-wide">{c.label}</span>
            </div>
            <p className="text-3xl font-bold tabular-nums text-gray-900 mt-2">{c.value}</p>
            <p className="text-xs text-gray-500 mt-1">{c.sub}</p>
          </Link>
        ))}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
        <p className="text-sm font-semibold text-gray-900">By category</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-blue-50 border border-blue-100 p-3">
            <p className="text-xs font-semibold text-blue-700">Nepalaya</p>
            <p className="text-2xl font-bold tabular-nums mt-1">{stats.nepalayaTitles}</p>
            <p className="text-[11px] text-blue-800/70 mt-0.5">titles with stock / cartons</p>
          </div>
          <div className="rounded-xl bg-green-50 border border-green-100 p-3">
            <p className="text-xs font-semibold text-green-700">Nepali / English</p>
            <p className="text-2xl font-bold tabular-nums mt-1">{stats.thirdTitles}</p>
            <p className="text-[11px] text-green-800/70 mt-0.5">titles on shelf</p>
          </div>
        </div>
        <p className="text-sm text-gray-600">
          Total pieces (locations): <strong className="tabular-nums">{stats.totalPcs.toLocaleString()}</strong>
        </p>
      </div>

      <div className="grid gap-2">
        {[
          { to: '/receive', label: 'Stock in', hint: 'Add cartons or vendor books' },
          { to: '/send', label: 'Send', hint: 'Scan · backroom or shelf' },
          { to: '/books', label: 'Books', hint: 'Catalog · cover / ISBN' },
          { to: '/fix', label: 'Undo stock', hint: 'Reverse mistakes' },
        ].map((l) => (
          <Link
            key={l.to}
            to={l.to}
            className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 hover:bg-gray-50"
          >
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-gray-900">{l.label}</p>
              <p className="text-xs text-gray-500">{l.hint}</p>
            </div>
            <ArrowRight className="h-4 w-4 text-gray-400" />
          </Link>
        ))}
        <Link
          to="/books"
          className="inline-flex items-center gap-2 text-sm text-accent-700 px-1 pt-1"
        >
          <BookOpen className="h-4 w-4" /> Browse catalog
        </Link>
      </div>
    </div>
  )
}
