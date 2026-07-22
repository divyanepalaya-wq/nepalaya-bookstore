import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Package, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { mapBox } from '@/lib/mappers'
import { useWarehouse } from '@/contexts/WarehouseContext'
import { useBooks } from '@/contexts/BooksContext'
import { isNepalaya } from '@/lib/bookCategories'
import { cartonStatusLabel } from '@/lib/roles'
import type { Box } from '@/types'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { PageSpinner } from '@/components/ui/Spinner'

/** Store: Nepalaya cartons waiting in backroom. */
export default function StoreBackroom() {
  const navigate = useNavigate()
  const { bufferWarehouse } = useWarehouse()
  const { books } = useBooks()
  const [boxes, setBoxes] = useState<(Box & { id: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const bufferId = bufferWarehouse?.id ?? 'wh-buffer'
  const nepalayaIds = useMemo(
    () => new Set(books.filter((b) => isNepalaya(b)).map((b) => b.id)),
    [books],
  )

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data, error } = await supabase
        .from('boxes')
        .select('*')
        .eq('warehouse_id', bufferId)
        .neq('status', 'empty')
        .order('created_at', { ascending: false })
        .limit(500)
      if (cancelled) return
      if (error) {
        setLoading(false)
        return
      }
      setBoxes(
        (data ?? [])
          .map((r) => mapBox(r as Record<string, unknown>))
          .filter((b) => !b.isDeleted && b.quantity > 0 && nepalayaIds.has(b.bookId)),
      )
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [bufferId, nepalayaIds])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return boxes
    return boxes.filter(
      (b) => b.bookName.toLowerCase().includes(q) || b.barcode.toLowerCase().includes(q),
    )
  }, [boxes, search])

  const totalPcs = filtered.reduce((s, b) => s + b.quantity, 0)

  if (loading) return <PageSpinner />

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Package className="h-7 w-7 text-orange-600" />
            Backroom
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Nepalaya ready for shelf · {filtered.length} cartons · {totalPcs.toLocaleString()} pcs
          </p>
        </div>
        <Button size="lg" className="min-h-12" onClick={() => navigate('/put-on-sale')}>
          Put on sale
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
        <Input
          className="pl-11 min-h-12 text-base"
          placeholder="Search carton or title…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <ul className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100">
        {filtered.length === 0 && (
          <li className="px-4 py-12 text-center text-gray-400">No cartons in backroom</li>
        )}
        {filtered.map((b) => (
          <li key={b.id}>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-orange-50/50"
              onClick={() => navigate(`/put-on-sale?box=${encodeURIComponent(b.barcode)}`)}
            >
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-gray-900 text-[15px] line-clamp-2">{b.bookName}</p>
                <p className="text-xs font-mono text-gray-400 mt-0.5">{b.barcode}</p>
                <Badge variant={b.status === 'sealed' ? 'green' : 'yellow'} className="mt-1">
                  {cartonStatusLabel(b.status)}
                </Badge>
              </div>
              <span className="text-2xl font-bold tabular-nums text-orange-700 shrink-0">{b.quantity}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
