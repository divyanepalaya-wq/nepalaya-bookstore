import { useMemo, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Search, AlertTriangle, BookOpen, Plus } from 'lucide-react'
import { useBooks } from '@/contexts/BooksContext'
import { useWarehouse } from '@/contexts/WarehouseContext'
import { useAuth } from '@/contexts/AuthContext'
import { canWarehouse } from '@/lib/roles'
import { formatCurrency, cn } from '@/lib/utils'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { PageSpinner } from '@/components/ui/Spinner'

export default function Books() {
  const navigate = useNavigate()
  const { appUser } = useAuth()
  const { books, loading } = useBooks()
  const { getRetailStock, getWarehouseStock, primaryWarehouse, bufferWarehouse } = useWarehouse()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'low' | 'out'>('all')

  const wh = canWarehouse(appUser?.role)

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return books
      .filter((b) => {
        if (!q) return true
        return (
          b.name.toLowerCase().includes(q) ||
          (b.author ?? '').toLowerCase().includes(q) ||
          (b.isbn ?? '').toLowerCase().includes(q)
        )
      })
      .map((b) => {
        const store = getRetailStock(b.id, b.inStock)
        const main = primaryWarehouse ? getWarehouseStock(b.id, primaryWarehouse.id) : 0
        const back = bufferWarehouse ? getWarehouseStock(b.id, bufferWarehouse.id) : 0
        const total = store + main + back
        return { book: b, store, main, back, total }
      })
      .filter((r) => {
        if (filter === 'low') return r.store > 0 && r.store <= r.book.minStockAlert
        if (filter === 'out') return r.store === 0
        return true
      })
      .sort((a, b) => a.book.name.localeCompare(b.book.name))
  }, [books, search, filter, getRetailStock, getWarehouseStock, primaryWarehouse, bufferWarehouse])

  if (loading) return <PageSpinner />

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BookOpen className="h-7 w-7 text-accent-600" />
            Books
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Catalog & stock by location · {rows.length} shown
          </p>
        </div>
        {wh && (
          <Button variant="outline" size="sm" onClick={() => navigate('/books/manage')}>
            <Plus className="h-4 w-4" /> Manage catalog
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            className="pl-9"
            placeholder="Search title, author, ISBN…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          options={[
            { value: 'all', label: 'All books' },
            { value: 'low', label: 'Low on store' },
            { value: 'out', label: 'Out on store' },
          ]}
        />
      </div>

      {/* Mobile cards */}
      <div className="grid gap-2 sm:hidden">
        {rows.map(({ book, store, main, back, total }) => (
          <Link
            key={book.id}
            to={`/books/${book.id}`}
            className="rounded-xl border border-gray-200 bg-white p-3 active:bg-gray-50"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-gray-900 truncate">{book.name}</p>
                <p className="text-xs text-gray-500 truncate">{book.author || '—'}</p>
              </div>
              {store <= book.minStockAlert && (
                <Badge variant={store === 0 ? 'red' : 'yellow'}>
                  <AlertTriangle className="h-3 w-3" /> {store}
                </Badge>
              )}
            </div>
            <div className="mt-2 flex gap-3 text-[11px] text-gray-500">
              <span>Store <strong className="text-gray-800">{store}</strong></span>
              <span>Back <strong className="text-gray-800">{back}</strong></span>
              <span>Main <strong className="text-gray-800">{main}</strong></span>
              <span>Total <strong className="text-gray-800">{total}</strong></span>
            </div>
          </Link>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden sm:block overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Store</th>
              <th className="px-4 py-3">Backroom</th>
              <th className="px-4 py-3">Main WH</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">MRP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(({ book, store, main, back, total }) => (
              <tr
                key={book.id}
                className="hover:bg-accent-50/40 cursor-pointer"
                onClick={() => navigate(`/books/${book.id}`)}
              >
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-900">{book.name}</p>
                  <p className="text-xs text-gray-500">{book.author || '—'} {book.isbn ? `· ${book.isbn}` : ''}</p>
                </td>
                <td className="px-4 py-3">
                  <span className={cn(
                    'font-semibold tabular-nums',
                    store === 0 ? 'text-red-600' : store <= book.minStockAlert ? 'text-amber-600' : 'text-gray-900',
                  )}>
                    {store}
                  </span>
                </td>
                <td className="px-4 py-3 tabular-nums text-gray-700">{back}</td>
                <td className="px-4 py-3 tabular-nums text-gray-700">{main}</td>
                <td className="px-4 py-3 tabular-nums font-medium text-gray-900">{total}</td>
                <td className="px-4 py-3 text-gray-600">{formatCurrency(book.mrp)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-gray-500">No books match</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
