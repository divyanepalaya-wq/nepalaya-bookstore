import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Search, Plus, Minus, Trash2, ShoppingCart, User, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useBooks } from '@/contexts/BooksContext'
import { useWarehouse } from '@/contexts/WarehouseContext'
import { formatCurrency, cn } from '@/lib/utils'
import { newRequestId, opsErrorMessage } from '@/lib/opsErrors'
import { categoryLabel } from '@/lib/bookCategories'
import { fuzzyFilterBooks } from '@/lib/fuzzySearch'
import type { Book, CartItem, PaymentMethod } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'

/** Bar-style POS · search · optional customer · cart · pay. */
export default function POS() {
  const { appUser } = useAuth()
  const { books } = useBooks()
  const { bookstoreId, getRetailStock } = useWarehouse()
  const [q, setQ] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [pay, setPay] = useState<PaymentMethod>('cash')
  const [busy, setBusy] = useState(false)
  const [lastLine, setLastLine] = useState('')
  const [customerOpen, setCustomerOpen] = useState(false)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const onShelf = useMemo(() => {
    return books
      .map((b) => ({ book: b, stock: getRetailStock(b.id, b.inStock) }))
      .filter((r) => r.stock > 0)
      .sort((a, b) => a.book.name.localeCompare(b.book.name))
  }, [books, getRetailStock])

  const matches = useMemo(() => {
    const shelfBooks = onShelf.map((r) => r.book)
    const found = fuzzyFilterBooks(shelfBooks, q, { minScore: 0.4, limit: 24 })
    const stockById = new Map(onShelf.map((r) => [r.book.id, r.stock]))
    return found.map((book) => ({ book, stock: stockById.get(book.id) ?? 0 }))
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

    const name = customerName.trim()
    const phone = customerPhone.replace(/\D/g, '')
    if (phone && phone.length < 7) {
      toast.error('Phone looks too short')
      return
    }
    if (phone && !name) {
      toast.error('Add a name with the phone, or clear phone')
      return
    }

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
        p_customer_name: name || 'Walk-in',
        p_customer_phone: phone,
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
      const who = name ? ` · ${name}${phone ? ` (${phone})` : ''}` : ''
      setLastLine(`Sold ${pcs} pcs · ${formatCurrency(total)} · ${pay}${who}`)
      toast.success('Sale done')
      setCart([])
      setCustomerName('')
      setCustomerPhone('')
      setCustomerOpen(false)
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

  const customerHint = customerName.trim() || customerPhone.trim()
    ? [customerName.trim(), customerPhone.trim()].filter(Boolean).join(' · ')
    : 'Optional'

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
          placeholder="Search title, author, ISBN… (EN / नेपाली)"
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
                  <div className="mt-0.5 flex flex-wrap items-center gap-2">
                    <Badge variant="gray">{categoryLabel(b.language)}</Badge>
                    {b.author && (
                      <span className="text-xs text-gray-400 line-clamp-1">{b.author}</span>
                    )}
                  </div>
                </div>
                <span className="text-sm tabular-nums text-gray-500">{stock}</span>
                <span className="font-semibold tabular-nums">{formatCurrency(b.mrp)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {q.trim() && matches.length === 0 && onShelf.length > 0 && (
        <p className="text-sm text-gray-400 text-center py-2">No shelf match for “{q.trim()}”</p>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <button
          type="button"
          className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-gray-50"
          onClick={() => setCustomerOpen((o) => !o)}
        >
          <User className="h-4 w-4 text-accent-600 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900">Customer</p>
            <p className="text-xs text-gray-400 truncate">{customerHint}</p>
          </div>
          {customerOpen ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
        </button>
        {customerOpen && (
          <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
            <Input
              label="Name"
              className="min-h-11"
              placeholder="Walk-in if empty"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              autoComplete="name"
            />
            <Input
              label="Phone"
              className="min-h-11"
              placeholder="Optional · 98XXXXXXXX"
              inputMode="tel"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              autoComplete="tel"
            />
            <p className="text-[11px] text-gray-400">Skip both for a normal walk-in sale.</p>
          </div>
        )}
      </div>

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
