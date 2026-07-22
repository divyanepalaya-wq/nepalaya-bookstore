import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search, Boxes, Package, Store, Warehouse, ArrowRightLeft, ScanBarcode, FileUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { mapBox } from '@/lib/mappers'
import { useWarehouse } from '@/contexts/WarehouseContext'
import { useBooks } from '@/contexts/BooksContext'
import { useAuth } from '@/contexts/AuthContext'
import { canWarehouse, canPOS } from '@/lib/roles'
import { cn } from '@/lib/utils'
import type { Box } from '@/types'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { PageSpinner } from '@/components/ui/Spinner'
import { StatCard } from '@/components/ui/Card'

type LocKey = 'warehouse' | 'backroom' | 'store'

export default function StockOverview() {
  const navigate = useNavigate()
  const { appUser } = useAuth()
  const {
    inventoryLoading, getRetailStock, getWarehouseStock,
    primaryWarehouse, bufferWarehouse, bookstoreId,
  } = useWarehouse()
  const { books, loading: booksLoading } = useBooks()
  const [boxes, setBoxes] = useState<(Box & { id: string })[]>([])
  const [boxesLoading, setBoxesLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [onlyInStock, setOnlyInStock] = useState(true)

  const wh = canWarehouse(appUser?.role)
  const pos = canPOS(appUser?.role)
  const primaryId = primaryWarehouse?.id ?? 'wh-primary'
  const bufferId = bufferWarehouse?.id ?? 'wh-buffer'

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data, error } = await supabase
        .from('boxes')
        .select('*')
        .neq('status', 'empty')
        .order('created_at', { ascending: false })
        .limit(5000)
      if (cancelled) return
      if (error) {
        setBoxesLoading(false)
        return
      }
      setBoxes(
        (data ?? [])
          .map((r) => mapBox(r as Record<string, unknown>))
          .filter((b) => !b.isDeleted && b.status !== 'empty' && b.quantity > 0),
      )
      setBoxesLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [])

  const cartonStats = useMemo(() => {
    const byBook: Record<string, Record<LocKey, { cartons: number; pieces: number }>> = {}
    const empty = (): Record<LocKey, { cartons: number; pieces: number }> => ({
      warehouse: { cartons: 0, pieces: 0 },
      backroom: { cartons: 0, pieces: 0 },
      store: { cartons: 0, pieces: 0 },
    })
    for (const b of boxes) {
      if (!byBook[b.bookId]) byBook[b.bookId] = empty()
      let loc: LocKey = 'warehouse'
      if (b.warehouseId === bufferId) loc = 'backroom'
      else if (b.warehouseId === bookstoreId || b.warehouseId === 'wh-bookstore') loc = 'store'
      else if (b.warehouseId === primaryId) loc = 'warehouse'
      byBook[b.bookId][loc].cartons += 1
      byBook[b.bookId][loc].pieces += b.quantity
    }
    return byBook
  }, [boxes, primaryId, bufferId, bookstoreId])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return books
      .filter((b) => {
        if (!q) return true
        return (
          b.name.toLowerCase().includes(q) ||
          (b.author ?? '').toLowerCase().includes(q) ||
          (b.isbn ?? '').includes(q)
        )
      })
      .map((book) => {
        const cartons = cartonStats[book.id] ?? {
          warehouse: { cartons: 0, pieces: 0 },
          backroom: { cartons: 0, pieces: 0 },
          store: { cartons: 0, pieces: 0 },
        }
        const warehousePcs = getWarehouseStock(book.id, primaryId)
        const backroomPcs = getWarehouseStock(book.id, bufferId)
        const storePcs = getRetailStock(book.id, book.inStock)
        const total = warehousePcs + backroomPcs + storePcs
        return { book, cartons, warehousePcs, backroomPcs, storePcs, total }
      })
      .filter((r) => !onlyInStock || r.total > 0 || (cartonStats[r.book.id] && (
        r.cartons.warehouse.cartons + r.cartons.backroom.cartons + r.cartons.store.cartons > 0
      )))
      .sort((a, b) => a.book.name.localeCompare(b.book.name))
  }, [books, search, onlyInStock, cartonStats, getWarehouseStock, getRetailStock, primaryId, bufferId])

  const totals = useMemo(() => {
    let warehousePcs = 0
    let backroomPcs = 0
    let storePcs = 0
    for (const b of books) {
      warehousePcs += getWarehouseStock(b.id, primaryId)
      backroomPcs += getWarehouseStock(b.id, bufferId)
      storePcs += getRetailStock(b.id, b.inStock)
    }
    return {
      warehousePcs,
      backroomPcs,
      storePcs,
      cartons: boxes.length,
      titles: rows.length,
    }
  }, [books, boxes, rows.length, getWarehouseStock, getRetailStock, primaryId, bufferId])

  if (booksLoading || inventoryLoading || boxesLoading) return <PageSpinner />

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Stock</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Cartons and pieces in Warehouse → Backroom → Store
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {wh && (
            <>
              <Button variant="outline" size="sm" onClick={() => navigate('/move')}>
                <ArrowRightLeft className="h-4 w-4" /> Move
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate('/import')}>
                <FileUp className="h-4 w-4" /> Import
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={() => navigate('/warehouse/scan')}>
            <ScanBarcode className="h-4 w-4" /> Scan
          </Button>
          {pos && (
            <Button size="sm" onClick={() => navigate('/pos')}>
              <Store className="h-4 w-4" /> Sell
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title="Warehouse" value={totals.warehousePcs.toLocaleString()} subtitle="pieces" icon={<Warehouse className="h-5 w-5" />} color="blue" />
        <StatCard title="Backroom" value={totals.backroomPcs.toLocaleString()} subtitle="pieces" icon={<Package className="h-5 w-5" />} color="orange" />
        <StatCard title="Store (on sale)" value={totals.storePcs.toLocaleString()} subtitle="pieces" icon={<Store className="h-5 w-5" />} color="green" />
        <StatCard title="Cartons" value={totals.cartons.toLocaleString()} subtitle="non-empty" icon={<Boxes className="h-5 w-5" />} color="accent" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px] max-w-md relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            className="pl-9"
            placeholder="Search title, author, ISBN…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={onlyInStock}
            onChange={(e) => setOnlyInStock(e.target.checked)}
            className="rounded border-gray-300"
          />
          Only with stock
        </label>
        <Link to="/warehouse/cartons" className="text-sm text-accent-700 font-medium hover:underline">
          View all cartons →
        </Link>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2.5 font-semibold">Book</th>
              <th className="px-3 py-2.5 font-semibold text-right" colSpan={2}>Warehouse</th>
              <th className="px-3 py-2.5 font-semibold text-right" colSpan={2}>Backroom</th>
              <th className="px-3 py-2.5 font-semibold text-right">Store</th>
              <th className="px-3 py-2.5 font-semibold text-right">Total</th>
            </tr>
            <tr className="border-t border-gray-100 text-[10px] text-gray-400">
              <th />
              <th className="px-3 py-1 text-right font-medium">Cartons</th>
              <th className="px-3 py-1 text-right font-medium">Pcs</th>
              <th className="px-3 py-1 text-right font-medium">Cartons</th>
              <th className="px-3 py-1 text-right font-medium">Pcs</th>
              <th className="px-3 py-1 text-right font-medium">Pcs</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-gray-400">
                  No books match. Import a sheet or add titles under Books.
                </td>
              </tr>
            )}
            {rows.map(({ book, cartons, warehousePcs, backroomPcs, storePcs, total }) => (
              <tr
                key={book.id}
                className="hover:bg-gray-50 cursor-pointer"
                onClick={() => navigate(`/books/${book.id}`)}
              >
                <td className="px-3 py-2.5">
                  <p className="font-medium text-gray-900 line-clamp-1">{book.name}</p>
                  {book.author && <p className="text-xs text-gray-400 line-clamp-1">{book.author}</p>}
                </td>
                <td className={cn('px-3 py-2.5 text-right tabular-nums', cartons.warehouse.cartons ? 'text-gray-900' : 'text-gray-300')}>
                  {cartons.warehouse.cartons || '—'}
                </td>
                <td className={cn('px-3 py-2.5 text-right tabular-nums', warehousePcs ? 'text-gray-900' : 'text-gray-300')}>
                  {warehousePcs || '—'}
                </td>
                <td className={cn('px-3 py-2.5 text-right tabular-nums', cartons.backroom.cartons ? 'text-gray-900' : 'text-gray-300')}>
                  {cartons.backroom.cartons || '—'}
                </td>
                <td className={cn('px-3 py-2.5 text-right tabular-nums', backroomPcs ? 'text-gray-900' : 'text-gray-300')}>
                  {backroomPcs || '—'}
                </td>
                <td className={cn('px-3 py-2.5 text-right tabular-nums font-medium', storePcs ? 'text-green-700' : 'text-gray-300')}>
                  {storePcs || '—'}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-gray-900">
                  {total.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400">
        Pieces follow inventory; carton counts are physical cartons still at that location.
        Store stock is sellable floor quantity (put on sale from a carton).
      </p>
    </div>
  )
}
