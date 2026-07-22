import { useMemo, useState } from 'react'
import { Search, Layers, Store, Warehouse, Package, AlertTriangle, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import { useWarehouse } from '@/contexts/WarehouseContext'
import { useBooks } from '@/contexts/BooksContext'
import { formatCurrency, cn } from '@/lib/utils'
import { exportInventoryByLocation } from '@/lib/warehouseExport'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { PageSpinner } from '@/components/ui/Spinner'
import { StatCard } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

export default function Inventory() {
  const {
    warehouses, bookstoreId, inventoryMap, inventoryLoading,
    mode, activeWarehouse, getRetailStock, getWarehouseStock,
  } = useWarehouse()
  const { books, loading: booksLoading } = useBooks()
  const [search, setSearch] = useState('')
  const [filterWarehouse, setFilterWarehouse] = useState(
    mode === 'bookstore' ? bookstoreId : (activeWarehouse?.id ?? ''),
  )

  const warehouseOptions = [
    { value: '', label: 'All locations (totals)' },
    ...warehouses.map((w) => ({ value: w.id, label: `${w.name} (${w.code})` })),
  ]

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
      .map((b) => {
        const inv = inventoryMap[b.id]
        const retail = getRetailStock(b.id, b.inStock)
        const warehouseTotal = inv?.totalWarehouseQty ?? 0
        const atFilter = filterWarehouse
          ? getWarehouseStock(b.id, filterWarehouse)
          : retail + warehouseTotal
        return { book: b, retail, warehouseTotal, atFilter, inv }
      })
      .filter((r) => !filterWarehouse || r.atFilter > 0 || search.trim().length > 0)
      .sort((a, b) => a.book.name.localeCompare(b.book.name))
  }, [books, inventoryMap, search, filterWarehouse, getRetailStock, getWarehouseStock])

  const totals = useMemo(() => {
    let retail = 0
    let warehouse = 0
    books.forEach((b) => {
      retail += getRetailStock(b.id, b.inStock)
      warehouse += inventoryMap[b.id]?.totalWarehouseQty ?? 0
    })
    return { retail, warehouse, units: retail + warehouse, skus: books.length }
  }, [books, inventoryMap, getRetailStock])

  const lowRetail = useMemo(
    () => books.filter((b) => getRetailStock(b.id, b.inStock) <= b.minStockAlert).length,
    [books, getRetailStock],
  )

  const warehouseLowStock = useMemo(() => {
    const result: Record<string, { name: string; code: string; low: number; total: number }> = {}
    warehouses.filter((w) => w.type !== 'bookstore').forEach((w) => {
      let low = 0
      let total = 0
      books.forEach((b) => {
        const qty = getWarehouseStock(b.id, w.id)
        if (qty > 0 || b.minStockAlert > 0) total++
        if (qty > 0 && qty <= b.minStockAlert) low++
      })
      result[w.id] = { name: w.name, code: w.code, low, total }
    })
    return result
  }, [books, warehouses, getWarehouseStock])

  if (booksLoading || inventoryLoading) return <PageSpinner />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Layers className="h-6 w-6 text-accent-600" />
            Stock by place
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            How many copies are for sale vs sitting in the warehouse
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            exportInventoryByLocation({
              books,
              warehouses,
              inventoryMap,
              getRetailStock,
              getWarehouseStock,
              bookstoreId,
            })
            toast.success('Excel downloaded')
          }}
        >
          <Download className="h-4 w-4" />
          Excel
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Bookstore (retail)" value={totals.retail} icon={<Store className="h-5 w-5" />} color="green" />
        <StatCard title="In warehouses" value={totals.warehouse} icon={<Warehouse className="h-5 w-5" />} color="blue" />
        <StatCard title="Total units" value={totals.units} icon={<Package className="h-5 w-5" />} color="accent" />
        <StatCard title="Low retail stock" value={lowRetail} icon={<AlertTriangle className="h-5 w-5" />} color="red" />
      </div>

      {Object.values(warehouseLowStock).some((w) => w.low > 0) && (
        <div className="flex flex-wrap gap-3">
          {Object.entries(warehouseLowStock).map(([id, data]) => (
            data.low > 0 && (
              <div
                key={id}
                className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm"
              >
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                <span>
                  <strong>{data.code}</strong>: {data.low} book{data.low !== 1 ? 's' : ''} running low
                </span>
              </div>
            )
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            className="w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="Search books…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          options={warehouseOptions}
          value={filterWarehouse}
          onChange={(e) => setFilterWarehouse(e.target.value)}
          className="w-56"
        />
      </div>

      {/* Mobile-friendly cards */}
      <div className="md:hidden space-y-2">
        {rows.map(({ book, retail, warehouseTotal }) => {
          const isLow = retail <= book.minStockAlert
          return (
            <div key={book.id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
              <div className="flex justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">{book.name}</p>
                  <p className="text-xs text-gray-400">{book.author}</p>
                </div>
                {isLow && <Badge variant="red">Low</Badge>}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                <div>
                  <p className="text-[10px] uppercase text-gray-400">For sale</p>
                  <p className={cn('font-bold', isLow && 'text-red-600')}>{retail}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase text-gray-400">Warehouse</p>
                  <p className="font-bold text-gray-800">{warehouseTotal}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase text-gray-400">Total</p>
                  <p className="font-bold">{retail + warehouseTotal}</p>
                </div>
              </div>
            </div>
          )
        })}
        {rows.length === 0 && (
          <p className="text-center text-gray-400 py-8 text-sm">No books</p>
        )}
      </div>

      <div className="hidden md:block bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
<tr>
                <th className="px-3 py-2">Book</th>
                <th className="px-3 py-2">MRP</th>
                <th className="px-3 py-2 text-right">Retail</th>
                {warehouses.filter((w) => w.type !== 'bookstore').map((w) => (
                  <th key={w.id} className="px-3 py-2 text-right">{w.code}</th>
                ))}
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(({ book, retail, warehouseTotal }) => {
                const isLow = retail <= book.minStockAlert
                return (
                  <tr key={book.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <p className="font-medium text-gray-900">{book.name}</p>
                      <p className="text-xs text-gray-400">{book.author}</p>
                    </td>
                    <td className="px-3 py-2 text-gray-600">{formatCurrency(book.mrp)}</td>
                    <td className={cn('px-3 py-2 text-right font-semibold', isLow && 'text-red-600')}>
                      {retail}
                    </td>
                    {warehouses.filter((w) => w.type !== 'bookstore').map((w) => {
                        const whStock = getWarehouseStock(book.id, w.id)
                        const whLow = whStock > 0 && whStock <= book.minStockAlert
                        return (
                          <td key={w.id} className={cn('px-3 py-2 text-right', whLow ? 'text-amber-600 font-semibold' : 'text-gray-600')}>
                            {whStock}
                            {whLow && <AlertTriangle className="inline h-3 w-3 ml-0.5" />}
                          </td>
                        )
                      })}
                    <td className="px-3 py-2 text-right font-medium">
                      {retail + warehouseTotal}
                    </td>
                    <td className="px-3 py-2">
                      {isLow && <Badge variant="red">Low retail</Badge>}
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6 + warehouses.filter((w) => w.type !== 'bookstore').length} className="px-3 py-8 text-center text-gray-400">
                    No books
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
