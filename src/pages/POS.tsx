import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Search, Plus, Minus, Trash2, ShoppingCart } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useBooks } from '@/contexts/BooksContext'
import { useWarehouse } from '@/contexts/WarehouseContext'
import { formatCurrency, cn } from '@/lib/utils'
import { newRequestId, opsErrorMessage } from '@/lib/opsErrors'
import { categoryLabel } from '@/lib/bookCategories'
import type { Book, CartItem, PaymentMethod } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'

/** Bar-style POS · search · cart · pay. */
export default function POS() {
  const { appUser } = useAuth()
  const { books } = useBooks()
  const { bookstoreId, getRetailStock } = useWarehouse()
  const [q, setQ] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [pay, setPay] = useState<PaymentMethod>('cash')
  const [busy, setBusy] = useState(false)
  const [lastLine, setLastLine] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const onShelf = useMemo(() => {
    return books
      .map((b) => ({ book: b, stock: getRetailStock(b.id, b.inStock) }))
      .filter((r) => r.stock > 0)
      .sort((a, b) => a.book.name.localeCompare(b.book.name))
  }, [books, getRetailStock])

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return onShelf.slice(0, 20)
    return onShelf
      .filter(({ book: b }) =>
        b.name.toLowerCase().includes(s) ||
        (b.author ?? '').toLowerCase().includes(s) ||
        (b.isbn ?? '').includes(s),
      )
      .slice(0, 20)
  }, [onShelf, q])

  const add = (book: Book) => {
    const stock = getRetailStock(book.id, book.inStock)
    if (stock <= 0) {
      toast.error('Not on shelf')
      return
    }
    setCart((prev) => {
      const i = prev.findIndex((c) => c.bookId === book.id)
      if (i >= 0) {
        const next = [...prev]
        if (next[i].quantity >= stock) {
          toast.error('Not enough on shelf')
          return prev
        }
        next[i] = { ...next[i], quantity: next[i].quantity + 1 }
        return next
      }
      return [
        ...prev,
        {
          bookId: book.id,
          bookName: book.name,
          unitPrice: book.mrp,
          quantity: 1,
          discountPercent: 0,
          maxStock: stock,
        },
      ]
    })
    setQ('')
    searchRef.current?.focus()
  }

  const setQty = (bookId: string, quantity: number) => {
    setCart((prev) =>
      prev
        .map((c) => {
          if (c.bookId !== bookId) return c
          const stock = getRetailStock(bookId, books.find((b) => b.id === bookId)?.inStock)
          const qn = Math.max(0, Math.min(quantity, stock))
          return { ...c, quantity: qn, maxStock: stock }
        })
        .filter((c) => c.quantity > 0),
    )
  }

  const total = cart.reduce((s, c) => s + c.unitPrice * c.quantity, 0)

  const checkout = async () => {
    if (!appUser || cart.length === 0) return
    setBusy(true)
    try {
      const items = cart.map((c) => ({
        bookId: c.bookId,
        bookName: c.bookName,
        quantity: c.quantity,
        unitPrice: c.unitPrice,
        discountPercent: 0,
        discountAmount: 0,
        subtotal: c.unitPrice * c.quantity,
      }))
      const totals = {
        subtotalBeforeDiscount: total,
        totalItemDiscounts: 0,
        orderDiscountPercent: 0,
        orderDiscountAmount: 0,
        totalDiscountAmount: 0,
        grandTotal: total,
      }
      const { data, error } = await supabase.rpc('complete_sale', {
        p_customer_name: 'Walk-in',
        p_customer_phone: '',
        p_items: items,
        p_totals: totals,
        p_payment_method: pay,
        p_amount_paid: total,
        p_change_given: 0,
        p_notes: '',
        p_bookstore_id: bookstoreId,
        p_client_request_id: newRequestId(),
      } as never)
      if (error) throw error
      const pcs = cart.reduce((s, c) => s + c.quantity, 0)
      setLastLine(`Sold ${pcs} pcs · ${formatCurrency(total)} · ${pay}`)
      toast.success('Sale done')
      setCart([])
      void data
      searchRef.current?.focus()
    } catch (e) {
      toast.error(opsErrorMessage(e, 'Sale failed'))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  return (
    <div className="mx-auto max-w-lg space-y-4 pb-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ShoppingCart className="h-7 w-7 text-accent-600" />
          Sell
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          From shelf · {onShelf.length} titles in stock
        </p>
      </div>

      {lastLine && (
        <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
          {lastLine}
        </div>
      )}

      {onShelf.length === 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Nothing on the shelf yet. Use <strong>Send → Store shelf</strong> or <strong>Stock in → Nepali / English</strong> first.
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
        <Input
          ref={searchRef}
          className="pl-11 min-h-12 text-base"
          placeholder="Search shelf books…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {matches.length > 0 && (
        <ul className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100 max-h-56 overflow-y-auto">
          {matches.map(({ book: b, stock }) => (
            <li key={b.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent-50"
                onClick={() => add(b)}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900 line-clamp-1">{b.name}</p>
                  <Badge variant="gray" className="mt-0.5">{categoryLabel(b.language)}</Badge>
                </div>
                <span className="text-sm tabular-nums text-gray-500">{stock}</span>
                <span className="font-semibold tabular-nums">{formatCurrency(b.mrp)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-100 text-xs font-semibold uppercase tracking-wide text-gray-400">
          Cart · {cart.length}
        </div>
        {cart.length === 0 ? (
          <p className="px-4 py-10 text-center text-gray-400 text-sm">Tap a book to add</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {cart.map((c) => (
              <li key={c.bookId} className="flex items-center gap-2 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900 text-sm line-clamp-1">{c.bookName}</p>
                  <p className="text-xs text-gray-400">{formatCurrency(c.unitPrice)} each</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button type="button" variant="outline" size="sm" className="h-10 w-10 p-0" onClick={() => setQty(c.bookId, c.quantity - 1)}>
                    <Minus className="h-4 w-4" />
                  </Button>
                  <span className="w-8 text-center font-bold tabular-nums">{c.quantity}</span>
                  <Button type="button" variant="outline" size="sm" className="h-10 w-10 p-0" onClick={() => setQty(c.bookId, c.quantity + 1)}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <Button type="button" variant="outline" size="sm" className="h-10 w-10 p-0 text-red-600" onClick={() => setQty(c.bookId, 0)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {cart.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-4 sticky bottom-20 lg:bottom-4 shadow-lg">
          <div className="flex justify-between items-baseline">
            <span className="text-sm text-gray-500">Total</span>
            <span className="text-3xl font-bold tabular-nums text-gray-900">{formatCurrency(total)}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {(['cash', 'esewa', 'khalti', 'card'] as PaymentMethod[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setPay(m)}
                className={cn(
                  'rounded-full px-4 py-2 text-sm font-semibold border capitalize',
                  pay === m ? 'bg-accent-600 text-white border-accent-600' : 'bg-white border-gray-200',
                )}
              >
                {m === 'esewa' ? 'eSewa' : m}
              </button>
            ))}
          </div>
          <Button size="lg" className="w-full min-h-14 text-lg" loading={busy} disabled={busy} onClick={() => void checkout()}>
            Take payment · {formatCurrency(total)}
          </Button>
        </div>
      )}
    </div>
  )
}
