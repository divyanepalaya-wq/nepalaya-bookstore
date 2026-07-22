import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Store } from 'lucide-react'
import { useBooks } from '@/contexts/BooksContext'
import { useWarehouse } from '@/contexts/WarehouseContext'
import { CATEGORY_FILTERS, categoryLabel } from '@/lib/bookCategories'
import type { BookType } from '@/types'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/Input'
import { PageSpinner } from '@/components/ui/Spinner'
import { Badge } from '@/components/ui/Badge'

/** Store shelf: sellable stock for all categories. */
export default function StoreShelf() {
  const navigate = useNavigate()
  const { books, loading } = useBooks()
  const { getRetailStock } = useWarehouse()
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState<'' | BookType>('')

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return books
      .filter((b) => !cat || b.language === cat)
      .map((b) => ({ book: b, qty: getRetailStock(b.id, b.inStock) }))
      .filter((r) => r.qty > 0 || search.trim().length > 0)
      .filter((r) => {
        if (!q) return true
        return (
          r.book.name.toLowerCase().includes(q) ||
          (r.book.author ?? '').toLowerCase().includes(q) ||
          (r.book.isbn ?? '').includes(q)
        )
      })
      .sort((a, b) => a.book.name.localeCompare(b.book.name))
  }, [books, cat, search, getRetailStock])

  const totalPcs = rows.reduce((s, r) => s + r.qty, 0)

  if (loading) return <PageSpinner />

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Store className="h-7 w-7 text-accent-600" />
          Shelf
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          On sale · {rows.length} titles · {totalPcs.toLocaleString()} pcs
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {CATEGORY_FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            onClick={() => setCat(f.value)}
            className={cn(
              'rounded-full px-4 py-2.5 text-sm font-semibold min-h-11 border transition',
              cat === f.value
                ? 'bg-accent-600 text-white border-accent-600'
                : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
        <Input
          className="pl-11 min-h-12 text-base"
          placeholder="Search shelf…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <ul className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100">
        {rows.length === 0 && (
          <li className="px-4 py-12 text-center text-gray-400">Nothing on the shelf for this filter</li>
        )}
        {rows.map(({ book, qty }) => (
          <li key={book.id}>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-accent-50/50 active:bg-accent-50"
              onClick={() => navigate(`/books/${book.id}`)}
            >
              {book.coverUrl ? (
                <img src={book.coverUrl} alt="" className="h-14 w-10 rounded object-cover shrink-0 bg-gray-100" />
              ) : (
                <div className="h-14 w-10 rounded bg-gray-100 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-gray-900 text-[15px] line-clamp-2">{book.name}</p>
                <div className="mt-1 flex items-center gap-2">
                  <Badge variant="gray">{categoryLabel(book.language)}</Badge>
                  {book.author && <span className="text-xs text-gray-400 truncate">{book.author}</span>}
                </div>
              </div>
              <span className="text-2xl font-bold tabular-nums text-green-700 shrink-0">{qty}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
