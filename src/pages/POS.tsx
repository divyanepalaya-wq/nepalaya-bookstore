import { useState, useEffect, useRef } from 'react'
import {
  collection, query, where, runTransaction, Timestamp,
  doc, addDoc, updateDoc, setDoc, getDocs, serverTimestamp, increment,
} from 'firebase/firestore'
import toast from 'react-hot-toast'
import {
  Search, ShoppingCart, Trash2, Plus, Minus, UserSearch,
  X, CheckCircle, Receipt, Tag, AlertCircle, Printer, RotateCcw, Clock,
} from 'lucide-react'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useBooks } from '@/contexts/BooksContext'
import { writeAuditLog } from '@/lib/auditLog'
import { formatCurrency, cn } from '@/lib/utils'
import { printReceipt } from '@/lib/receipt'
import { updateDailyAnalytics } from '@/lib/analyticsAgg'
import type { Book, Customer, CartItem, PaymentMethod, Discount, Sale } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { UserAvatar } from '@/components/ui/Avatar'

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash',          label: 'Cash' },
  { value: 'esewa',         label: 'eSewa' },
  { value: 'khalti',        label: 'Khalti' },
  { value: 'card',          label: 'Card' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'credit',        label: 'Credit (Record)' },
]

export default function POS() {
  const { appUser } = useAuth()
  const { books } = useBooks()

  // Books
  const [bookSearch, setBookSearch] = useState('')

  // Cart
  const [cart, setCart] = useState<CartItem[]>([])
  const [orderDiscountPercent, setOrderDiscountPercent] = useState(0)

  // Customer
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [allCustomers, setAllCustomers] = useState<Customer[]>([])
  const [customerSuggestions, setCustomerSuggestions] = useState<Customer[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)

  // Discounts (saved)
  const [discounts, setDiscounts] = useState<Discount[]>([])
  const [showDiscountPicker, setShowDiscountPicker] = useState(false)

  // Payment
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [amountPaid, setAmountPaid] = useState('')
  const [notes, setNotes] = useState('')

  // UI state
  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false)
  const [successModalOpen, setSuccessModalOpen] = useState(false)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [lastSaleId, setLastSaleId] = useState('')
  const [successCountdown, setSuccessCountdown] = useState(4)
  const [lastSaleData, setLastSaleData] = useState<Sale | null>(null)

  // Shift close
  const [shiftModalOpen, setShiftModalOpen] = useState(false)
  const [shiftLoading, setShiftLoading] = useState(false)
  const [shiftStats, setShiftStats] = useState<{
    saleCount: number; totalRevenue: number; cashRevenue: number; cashSaleCount: number
  } | null>(null)
  const [openingFloat, setOpeningFloat] = useState('')
  const [actualCash, setActualCash] = useState('')
  const [shiftNotes, setShiftNotes] = useState('')
  const [shiftSubmitting, setShiftSubmitting] = useState(false)

  // Return
  const [returnModalOpen, setReturnModalOpen] = useState(false)
  const [returnPhoneSearch, setReturnPhoneSearch] = useState('')
  const [returnResults, setReturnResults] = useState<Sale[]>([])
  const [returnSearching, setReturnSearching] = useState(false)
  const [selectedReturnSale, setSelectedReturnSale] = useState<Sale | null>(null)
  const [returnQtys, setReturnQtys] = useState<Record<string, number>>({})
  const [returnReason, setReturnReason] = useState('')
  const [returnSubmitting, setReturnSubmitting] = useState(false)

  const phoneRef = useRef<HTMLInputElement>(null)

  // Sync cart maxStock whenever live books update (BooksContext keeps books fresh)
  useEffect(() => {
    setCart((prev) => prev.map((item) => {
      const live = books.find((b) => b.id === item.bookId)
      if (!live) return item
      return { ...item, maxStock: live.inStock, quantity: Math.min(item.quantity, live.inStock) }
    }))
  }, [books])

  // Auto-close success modal with countdown
  useEffect(() => {
    if (!successModalOpen) return
    setSuccessCountdown(4)
    const interval = setInterval(() => {
      setSuccessCountdown((n) => {
        if (n <= 1) { clearInterval(interval); setSuccessModalOpen(false); return 0 }
        return n - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [successModalOpen])

  // Load discounts once (they rarely change, no need for live listener)
  useEffect(() => {
    getDocs(query(collection(db, 'discounts'), where('isActive', '==', true)))
      .then((snap) => setDiscounts(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Discount)))
      .catch(() => console.warn('Failed to load discounts'))
  }, [])

  // Load all customers once for client-side search (far fewer Firestore reads)
  useEffect(() => {
    getDocs(collection(db, 'customers'))
      .then((snap) => setAllCustomers(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Customer)))
      .catch(() => {/* silently ignore */})
  }, [])

  const [customerSearch, setCustomerSearch] = useState('')

  const handleCustomerSearch = (val: string) => {
    setCustomerSearch(val)
    setCustomerId(null)
    if (/^\d/.test(val)) setCustomerPhone(val)
    if (val.length >= 2) {
      const term = val.toLowerCase()
      const isPhone = /^\d/.test(val)
      const matches = allCustomers.filter((c) =>
        isPhone
          ? c.phone.startsWith(val)
          : c.name.toLowerCase().includes(term) || c.phone.startsWith(val)
      ).slice(0, 8)
      setCustomerSuggestions(matches)
      setShowSuggestions(matches.length > 0)
    } else {
      setCustomerSuggestions([])
      setShowSuggestions(false)
    }
  }

  const handlePhoneChange = (val: string) => {
    setCustomerPhone(val)
    setCustomerId(null)
    if (val.length >= 2) {
      const matches = allCustomers.filter((c) => c.phone.startsWith(val)).slice(0, 8)
      setCustomerSuggestions(matches)
      setShowSuggestions(matches.length > 0)
    } else {
      setCustomerSuggestions([])
      setShowSuggestions(false)
    }
  }

  const selectCustomer = (c: Customer) => {
    setCustomerPhone(c.phone)
    setCustomerName(c.name)
    setCustomerId(c.id)
    setCustomerSuggestions([])
    setShowSuggestions(false)
  }

  // ─── Cart operations ───────────────────────────────────────────────────────

  const addToCart = (book: Book) => {
    if (book.inStock === 0) { toast.error('Out of stock'); return }
    setCart((prev) => {
      const existing = prev.find((i) => i.bookId === book.id)
      if (existing) {
        if (existing.quantity >= book.inStock) { toast.error('Max stock reached'); return prev }
        return prev.map((i) => i.bookId === book.id ? { ...i, quantity: i.quantity + 1 } : i)
      }
      return [...prev, {
        bookId: book.id,
        bookName: book.name,
        unitPrice: book.mrp,
        quantity: 1,
        discountPercent: 0,
        maxStock: book.inStock,
      }]
    })
  }

  const removeFromCart = (bookId: string) => setCart((prev) => prev.filter((i) => i.bookId !== bookId))

  const updateQty = (bookId: string, delta: number) => {
    setCart((prev) => prev.map((i) => {
      if (i.bookId !== bookId) return i
      const newQty = i.quantity + delta
      if (newQty < 1) return i
      if (newQty > i.maxStock) { toast.error('Max stock reached'); return i }
      return { ...i, quantity: newQty }
    }))
  }

  const setItemDiscount = (bookId: string, pct: number) => {
    const clamped = Math.min(100, Math.max(0, pct))
    setCart((prev) => prev.map((i) => i.bookId === bookId ? { ...i, discountPercent: clamped } : i))
  }

  const clearCart = () => {
    setCart([])
    setCustomerPhone('')
    setCustomerName('')
    setCustomerId(null)
    setCustomerSearch('')
    setOrderDiscountPercent(0)
    setAmountPaid('')
    setNotes('')
    setPaymentMethod('cash')
  }

  // ─── Shift close ──────────────────────────────────────────────────────────

  const openShiftModal = async () => {
    if (!appUser) return
    setShiftModalOpen(true)
    setShiftLoading(true)
    setShiftStats(null)
    let active = true   // guard against stale setState if modal is closed while loading
    try {
      const snap = await getDocs(query(
        collection(db, 'sales'),
        where('cashierId', '==', appUser.uid),
      ))
      if (!active) return
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
      const todaySales = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as Sale)
        .filter((s) => s.status === 'completed' && s.createdAt && s.createdAt.toDate() >= dayStart)
      const cashSales = todaySales.filter((s) => s.paymentMethod === 'cash')
      setShiftStats({
        saleCount: todaySales.length,
        totalRevenue: todaySales.reduce((sum, s) => sum + s.grandTotal, 0),
        cashRevenue: cashSales.reduce((sum, s) => sum + s.grandTotal, 0),
        cashSaleCount: cashSales.length,
      })
    } catch {
      if (active) toast.error('Could not load today\'s sales data')
    } finally {
      if (active) setShiftLoading(false)
    }
    return () => { active = false }
  }

  const closeShift = async () => {
    if (!appUser || !shiftStats) return
    const float = parseFloat(openingFloat || '0')
    const actual = parseFloat(actualCash || '0')
    const expected = float + shiftStats.cashRevenue
    const variance = actual - expected
    setShiftSubmitting(true)
    try {
      await addDoc(collection(db, 'shiftCloses'), {
        cashierId: appUser.uid,
        cashierName: appUser.displayName,
        openingFloat: float,
        expectedCash: expected,
        actualCash: actual,
        variance,
        saleCount: shiftStats.saleCount,
        totalRevenue: shiftStats.totalRevenue,
        cashSaleCount: shiftStats.cashSaleCount,
        cashRevenue: shiftStats.cashRevenue,
        notes: shiftNotes.trim() || null,
        closedAt: serverTimestamp(),
      })
      await writeAuditLog({
        action: 'shift_closed',
        entity: 'shiftClose',
        details: `Shift closed · ${shiftStats.saleCount} sales · Total: ${formatCurrency(shiftStats.totalRevenue)} · Variance: ${formatCurrency(variance)}`,
        performedBy: appUser.uid,
        performedByName: appUser.displayName,
        role: appUser.role,
      })
      toast.success('Shift closed successfully')
      setShiftModalOpen(false)
      setOpeningFloat('')
      setActualCash('')
      setShiftNotes('')
      setShiftStats(null)
    } catch {
      toast.error('Failed to close shift')
    } finally {
      setShiftSubmitting(false)
    }
  }

  // ─── Return flow ───────────────────────────────────────────────────────────

  const searchReturnSale = async () => {
    if (!returnPhoneSearch.trim()) return
    setReturnSearching(true)
    try {
      const snap = await getDocs(query(
        collection(db, 'sales'),
        where('customerPhone', '==', returnPhoneSearch.trim()),
      ))
      const results = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as Sale)
        .filter((s) => s.status === 'completed' && s.returnStatus !== 'full')
        .sort((a, b) => (b.createdAt?.toDate().getTime() ?? 0) - (a.createdAt?.toDate().getTime() ?? 0))
        .slice(0, 10)
      setReturnResults(results)
      if (results.length === 0) toast('No eligible sales found for this phone number', { icon: 'ℹ️' })
    } catch {
      toast.error('Search failed')
    } finally {
      setReturnSearching(false)
    }
  }

  const selectReturnSale = (sale: Sale) => {
    setSelectedReturnSale(sale)
    const qtys: Record<string, number> = {}
    sale.items.forEach((item) => { qtys[item.bookId] = 0 })
    setReturnQtys(qtys)
  }

  const processReturn = async () => {
    if (!selectedReturnSale || !appUser) return
    const itemsToReturn = selectedReturnSale.items.filter((item) => (returnQtys[item.bookId] ?? 0) > 0)
    if (itemsToReturn.length === 0) { toast.error('Select at least one item to return'); return }
    if (!returnReason.trim()) { toast.error('Return reason is required'); return }

    // Safe division — skip items with quantity 0 (corrupted data guard)
    const refundAmount = itemsToReturn.reduce((sum, item) => {
      if (!item.quantity) return sum
      const perUnit = item.subtotal / item.quantity
      return sum + perUnit * (returnQtys[item.bookId] ?? 0)
    }, 0)

    const totalOriginalQty = selectedReturnSale.items.reduce((s, i) => s + i.quantity, 0)
    const returnedQty = itemsToReturn.reduce((s, item) => s + (returnQtys[item.bookId] ?? 0), 0)
    const returnStatusValue: 'full' | 'partial' = returnedQty >= totalOriginalQty ? 'full' : 'partial'

    setReturnSubmitting(true)
    try {
      // Single transaction: restore stock + update sale atomically
      await runTransaction(db, async (tx) => {
        for (const item of itemsToReturn) {
          const qty = returnQtys[item.bookId]
          const bookRef = doc(db, 'books', item.bookId)
          const bookSnap = await tx.get(bookRef)
          const current = (bookSnap.data()?.inStock ?? 0) as number
          tx.update(bookRef, { inStock: increment(qty), updatedAt: serverTimestamp() })
          const txRef = doc(collection(db, 'stockTransactions'))
          tx.set(txRef, {
            bookId: item.bookId,
            bookName: item.bookName,
            type: 'in',
            quantity: qty,
            previousStock: current,
            newStock: current + qty,
            reason: `Return — sale ${selectedReturnSale.id.slice(-8)}`,
            reference: selectedReturnSale.id,
            performedBy: appUser.uid,
            performedByName: appUser.displayName,
            createdAt: serverTimestamp(),
          })
        }
        // Update sale record inside the same transaction — fully atomic
        tx.update(doc(db, 'sales', selectedReturnSale.id), {
          returnStatus: returnStatusValue,
          returnedItems: itemsToReturn.map((item) => ({
            bookId: item.bookId,
            bookName: item.bookName,
            quantityReturned: returnQtys[item.bookId],
          })),
          returnReason: returnReason.trim(),
          returnedBy: appUser.uid,
          returnedAt: serverTimestamp(),
          returnRefundAmount: refundAmount,
        })
      })

      await writeAuditLog({
        action: 'sale_returned',
        entity: 'sale',
        entityId: selectedReturnSale.id,
        details: `Return for sale ${selectedReturnSale.id.slice(-8)} · ${returnedQty} item(s) · Refund: ${formatCurrency(refundAmount)}`,
        performedBy: appUser.uid,
        performedByName: appUser.displayName,
        role: appUser.role,
      })

      toast.success(`Return processed · Refund: ${formatCurrency(refundAmount)}`)
      setReturnModalOpen(false)
      setReturnPhoneSearch('')
      setReturnResults([])
      setSelectedReturnSale(null)
      setReturnQtys({})
      setReturnReason('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Return failed')
    } finally {
      setReturnSubmitting(false)
    }
  }

  // ─── Pricing calculations ──────────────────────────────────────────────────

  const itemRows = cart.map((item) => {
    const lineBeforeDiscount = item.unitPrice * item.quantity
    const discountAmt = lineBeforeDiscount * (item.discountPercent / 100)
    const subtotal = lineBeforeDiscount - discountAmt
    return { ...item, lineBeforeDiscount, discountAmt, subtotal }
  })

  const subtotalBeforeDiscount = itemRows.reduce((s, r) => s + r.lineBeforeDiscount, 0)
  const totalItemDiscounts     = itemRows.reduce((s, r) => s + r.discountAmt, 0)
  const subtotalAfterItemDisc  = subtotalBeforeDiscount - totalItemDiscounts
  const orderDiscountAmount    = subtotalAfterItemDisc * (orderDiscountPercent / 100)
  const grandTotal             = subtotalAfterItemDisc - orderDiscountAmount
  const totalDiscountAmount    = totalItemDiscounts + orderDiscountAmount
  const changeDue              = Math.max(0, parseFloat(amountPaid || '0') - grandTotal)

  // Apply a saved discount to order
  const applyDiscount = (d: Discount) => {
    if (d.scope === 'order') {
      if (d.type === 'percentage') {
        const clamped = Math.min(100, Math.max(0, d.value))
        setOrderDiscountPercent(clamped)
        toast.success(`Applied "${d.name}" — ${clamped}% off`)
      } else {
        // Fixed amount: convert to % of current subtotal for order-level
        if (subtotalBeforeDiscount > 0) {
          const pct = Math.min(100, (d.value / subtotalBeforeDiscount) * 100)
          setOrderDiscountPercent(parseFloat(pct.toFixed(2)))
          toast.success(`Applied "${d.name}" — ${formatCurrency(d.value)} off`)
        }
      }
    }
    setShowDiscountPicker(false)
  }

  // ─── Checkout ──────────────────────────────────────────────────────────────

  const checkout = async () => {
    if (!appUser) return
    if (cart.length === 0) { toast.error('Cart is empty'); return }
    if (!customerName.trim()) { toast.error('Customer name is required'); return }
    if (!customerPhone.trim()) { toast.error('Customer phone is required'); return }

    // For cash: validate the entered amount. For all other methods: record exact total as paid.
    const paid = paymentMethod === 'cash'
      ? parseFloat(amountPaid || '0')
      : grandTotal
    if (paymentMethod === 'cash' && paid < grandTotal) {
      toast.error(`Amount paid (${formatCurrency(paid)}) is less than the total (${formatCurrency(grandTotal)})`)
      return
    }

    setSubmitting(true)
    try {
      const saleItems = itemRows.map((r) => ({
        bookId:          r.bookId,
        bookName:        r.bookName,
        quantity:        r.quantity,
        unitPrice:       r.unitPrice,
        discountPercent: r.discountPercent,
        discountAmount:  r.discountAmt,
        subtotal:        r.subtotal,
      }))

      // Deduct stock atomically
      await runTransaction(db, async (tx) => {
        // Read all books first
        const bookRefs = cart.map((i) => doc(db, 'books', i.bookId))
        const bookSnaps = await Promise.all(bookRefs.map((r) => tx.get(r)))

        // Validate stock
        bookSnaps.forEach((snap, idx) => {
          const current = (snap.data()?.inStock ?? 0) as number
          if (current < cart[idx].quantity) {
            throw new Error(`Insufficient stock for "${cart[idx].bookName}"`)
          }
        })

        // Deduct
        bookRefs.forEach((ref, idx) => {
          tx.update(ref, {
            inStock: increment(-cart[idx].quantity),
            updatedAt: serverTimestamp(),
          })
        })

        // Create stock-out transactions
        bookSnaps.forEach((snap, idx) => {
          const current = (snap.data()?.inStock ?? 0) as number
          const txRef = doc(collection(db, 'stockTransactions'))
          tx.set(txRef, {
            bookId: cart[idx].bookId,
            bookName: cart[idx].bookName,
            type: 'out',
            quantity: cart[idx].quantity,
            previousStock: current,
            newStock: current - cart[idx].quantity,
            reason: `POS Sale`,
            performedBy: appUser.uid,
            performedByName: appUser.displayName,
            createdAt: serverTimestamp(),
          })
        })
      })

      // Upsert customer — phone is the document ID (prevents duplicates).
      // Check against already-loaded local state — no extra Firestore read needed.
      const customerRef = doc(db, 'customers', customerPhone)
      const isNewCustomer = !allCustomers.some((c) => c.phone === customerPhone)
      if (isNewCustomer) {
        await setDoc(customerRef, {
          name: customerName,
          phone: customerPhone,
          email: '',
          totalPurchases: 1,
          totalSpent: grandTotal,
          createdAt: serverTimestamp(),
          lastPurchaseAt: serverTimestamp(),
        })
        await writeAuditLog({
          action: 'customer_created',
          entity: 'customer',
          details: `New customer: ${customerName} (${customerPhone})`,
          performedBy: appUser.uid,
          performedByName: appUser.displayName,
          role: appUser.role,
        })
      } else {
        await updateDoc(customerRef, {
          name: customerName,
          totalPurchases: increment(1),
          totalSpent: increment(grandTotal),
          lastPurchaseAt: serverTimestamp(),
        })
      }
      // Phone is always the document ID — use it as the resolved customer ID
      const resolvedCustomerId = customerPhone

      // Create sale record
      const saleRef = await addDoc(collection(db, 'sales'), {
        customerId: resolvedCustomerId ?? null,
        customerName,
        customerPhone,
        items: saleItems,
        subtotalBeforeDiscount,
        totalItemDiscounts,
        orderDiscountPercent,
        orderDiscountAmount,
        totalDiscountAmount,
        grandTotal,
        paymentMethod,
        amountPaid: paid,
        changeGiven: changeDue,
        notes,
        cashierId: appUser.uid,
        cashierName: appUser.displayName,
        status: 'completed',
        createdAt: serverTimestamp(),
      })

      await writeAuditLog({
        action: 'sale_created',
        entity: 'sale',
        entityId: saleRef.id,
        details: `Sale of ${cart.length} item(s) · Total: ${formatCurrency(grandTotal)} · Customer: ${customerName}`,
        performedBy: appUser.uid,
        performedByName: appUser.displayName,
        role: appUser.role,
      })

      setLastSaleId(saleRef.id)
      setLastSaleData({
        id: saleRef.id,
        customerId: resolvedCustomerId ?? undefined,
        customerName,
        customerPhone,
        items: saleItems,
        subtotalBeforeDiscount,
        totalItemDiscounts,
        orderDiscountPercent,
        orderDiscountAmount,
        totalDiscountAmount,
        grandTotal,
        paymentMethod,
        amountPaid: paid,
        changeGiven: changeDue,
        notes: notes || undefined,
        cashierId: appUser.uid,
        cashierName: appUser.displayName,
        status: 'completed',
        createdAt: Timestamp.now(),
      })
      setCheckoutModalOpen(false)
      setSuccessModalOpen(true)
      clearCart()

      // Update local customer list without a Firestore read
      setAllCustomers((prev) => {
        if (isNewCustomer) {
          return [...prev, {
            id: customerPhone, name: customerName, phone: customerPhone,
            email: '', totalPurchases: 1, totalSpent: grandTotal,
          } as Customer]
        }
        return prev.map((c) => c.phone === customerPhone
          ? { ...c, name: customerName, totalPurchases: c.totalPurchases + 1, totalSpent: c.totalSpent + grandTotal }
          : c
        )
      })

      // Fire-and-forget analytics update (errors are swallowed inside the helper)
      updateDailyAnalytics({ grandTotal, paymentMethod, items: saleItems })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Checkout failed')
    } finally {
      setSubmitting(false)
    }
  }

  // ─── Filtered books ────────────────────────────────────────────────────────

  const filteredBooks = books.filter((b) => {
    const q = bookSearch.toLowerCase()
    return !q || b.name.toLowerCase().includes(q) || (b.author ?? '').toLowerCase().includes(q) || (b.isbn ?? '').includes(q)
  })

  const inCartIds = new Set(cart.map((i) => i.bookId))

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-full">
      {/* ── LEFT: Book Search ── */}
      <div className="flex-1 flex flex-col gap-3 min-h-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Point of Sale</h1>
            <p className="text-sm text-gray-500">Search and add books to the cart</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => { setSelectedReturnSale(null); setReturnResults([]); setReturnPhoneSearch(''); setReturnModalOpen(true) }}>
              <RotateCcw className="h-4 w-4" /> Return
            </Button>
            <Button variant="outline" size="sm" onClick={openShiftModal}>
              <Clock className="h-4 w-4" /> Close Shift
            </Button>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input
            value={bookSearch}
            onChange={(e) => setBookSearch(e.target.value)}
            placeholder="Search books by name, author or ISBN…"
            className="w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div className="overflow-y-auto rounded-xl border border-gray-200 bg-white divide-y divide-gray-100 max-h-[calc(100vh-220px)]">
          {filteredBooks.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">No books found</div>
          ) : (
            filteredBooks.map((book) => {
              const inCart = inCartIds.has(book.id)
              return (
                <button
                  key={book.id}
                  onClick={() => addToCart(book)}
                  disabled={book.inStock === 0}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors',
                    book.inStock === 0
                      ? 'opacity-40 cursor-not-allowed'
                      : 'hover:bg-brand-50',
                    inCart && 'bg-brand-50'
                  )}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 text-brand-700 text-sm font-bold shrink-0">
                    {book.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{book.name}</p>
                    <p className="text-xs text-gray-400 truncate">{book.author}</p>
                    {book.language && (
                      <span className={cn(
                        'inline-block mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold',
                        book.language === 'Nepalaya' ? 'bg-brand-100 text-brand-700'
                          : book.language === 'Nepali' ? 'bg-accent-100 text-accent-700'
                          : 'bg-gray-100 text-gray-600'
                      )}>
                        {book.language}
                      </span>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-gray-800">{formatCurrency(book.mrp)}</p>
                    <p className={cn('text-xs', book.inStock <= 5 ? 'text-red-500' : 'text-gray-400')}>
                      {book.inStock} left
                    </p>
                  </div>
                  {inCart && <Badge variant="green" className="shrink-0">In cart</Badge>}
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* ── RIGHT: Cart ── */}
      <div className="w-full lg:w-96 xl:w-[420px] flex flex-col gap-3">
        {/* Customer */}
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
          <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <UserSearch className="h-4 w-4" /> Customer
          </h2>

          {/* Combined name OR phone search */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              value={customerSearch}
              onChange={(e) => handleCustomerSearch(e.target.value)}
              onFocus={() => customerSuggestions.length > 0 && setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              placeholder="Search by name or phone…"
              className="w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            {showSuggestions && customerSuggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-lg border border-gray-200 bg-white shadow-lg divide-y divide-gray-100">
                {customerSuggestions.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { selectCustomer(c); setCustomerSearch('') }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors"
                  >
                    <UserAvatar name={c.name} className="h-8 w-8 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">{c.name}</p>
                      <p className="text-xs text-gray-400">{c.phone} · {c.totalPurchases} purchase{c.totalPurchases !== 1 ? 's' : ''}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Manual phone + name entry */}
          <div className="grid grid-cols-2 gap-2">
            <input
              ref={phoneRef}
              value={customerPhone}
              onChange={(e) => handlePhoneChange(e.target.value)}
              placeholder="Phone *"
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Name *"
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          {customerId && (
            <p className="text-xs text-green-600 flex items-center gap-1">
              <CheckCircle className="h-3 w-3" /> Returning customer
            </p>
          )}
        </div>

        {/* Cart items */}
        <div className="rounded-xl border border-gray-200 bg-white flex flex-col flex-1 min-h-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <ShoppingCart className="h-4 w-4" /> Cart
              {cart.length > 0 && (
                <span className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-white text-xs font-bold">
                  {cart.reduce((s, i) => s + i.quantity, 0)}
                </span>
              )}
            </h2>
            {cart.length > 0 && (
              clearConfirmOpen ? (
                <span className="flex items-center gap-1 text-xs">
                  <span className="text-gray-500">Clear cart?</span>
                  <button onClick={() => { clearCart(); setClearConfirmOpen(false) }} className="text-red-600 font-semibold hover:underline">Yes</button>
                  <span className="text-gray-300">·</span>
                  <button onClick={() => setClearConfirmOpen(false)} className="text-gray-500 hover:underline">No</button>
                </span>
              ) : (
                <button onClick={() => setClearConfirmOpen(true)} className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1">
                  <X className="h-3.5 w-3.5" /> Clear
                </button>
              )
            )}
          </div>

          <div className="overflow-y-auto divide-y divide-gray-100 max-h-64">
            {cart.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-400">
                <ShoppingCart className="mx-auto h-8 w-8 mb-2 opacity-30" />
                Cart is empty
              </div>
            ) : (
              cart.map((item) => (
                <div key={item.bookId} className="px-4 py-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-gray-900 leading-tight">{item.bookName}</p>
                    <button onClick={() => removeFromCart(item.bookId)} className="text-gray-300 hover:text-red-500 transition-colors shrink-0">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-3">
                    {/* Qty */}
                    <div className="flex items-center gap-1 rounded-lg border border-gray-200 p-0.5">
                      <button onClick={() => updateQty(item.bookId, -1)} className="rounded p-1 hover:bg-gray-100">
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="w-6 text-center text-sm font-medium">{item.quantity}</span>
                      <button onClick={() => updateQty(item.bookId, 1)} className="rounded p-1 hover:bg-gray-100">
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    {/* Per-item discount */}
                    <div className="flex items-center gap-1 text-xs text-gray-500">
                      <Tag className="h-3 w-3" />
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={item.discountPercent}
                        onChange={(e) => setItemDiscount(item.bookId, parseFloat(e.target.value) || 0)}
                        className="w-12 rounded border border-gray-200 px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-brand-400"
                      />
                      <span>% off</span>
                    </div>
                    {/* Line total */}
                    <span className="ml-auto text-sm font-semibold text-gray-800">
                      {formatCurrency(item.unitPrice * item.quantity * (1 - item.discountPercent / 100))}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400">{formatCurrency(item.unitPrice)} × {item.quantity}</p>
                </div>
              ))
            )}
          </div>

          {/* Order-level discount */}
          {cart.length > 0 && (
            <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 space-y-2">
              <div className="flex items-center gap-2">
                <Tag className="h-3.5 w-3.5 text-gray-400" />
                <span className="text-xs text-gray-600">Order discount</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={orderDiscountPercent}
                  onChange={(e) => setOrderDiscountPercent(Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))}
                  className="w-14 rounded border border-gray-200 px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-brand-400"
                />
                <span className="text-xs text-gray-500">%</span>
                <button
                  onClick={() => setShowDiscountPicker(!showDiscountPicker)}
                  className="ml-auto text-xs text-brand-600 hover:text-brand-700 underline"
                >
                  Saved discounts
                </button>
              </div>

              {showDiscountPicker && discounts.length > 0 && (
                <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
                  {discounts.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => applyDiscount(d)}
                      className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-brand-50 transition-colors"
                    >
                      <span className="text-sm text-gray-800">{d.name}</span>
                      <Badge variant="orange">
                        {d.type === 'percentage' ? `${d.value}%` : formatCurrency(d.value)} {d.scope}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
              {showDiscountPicker && discounts.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-2">No active saved discounts</p>
              )}
            </div>
          )}

          {/* Totals */}
          {cart.length > 0 && (
            <div className="px-4 py-3 border-t border-gray-200 space-y-1.5">
              <div className="flex justify-between text-sm text-gray-500">
                <span>Subtotal</span>
                <span>{formatCurrency(subtotalBeforeDiscount)}</span>
              </div>
              {totalDiscountAmount > 0 && (
                <div className="flex justify-between text-sm text-green-600">
                  <span>Discount</span>
                  <span>−{formatCurrency(totalDiscountAmount)}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-bold text-gray-900 pt-1 border-t border-gray-200">
                <span>Total</span>
                <span>{formatCurrency(grandTotal)}</span>
              </div>
            </div>
          )}

          {/* Checkout button */}
          <div className="p-4 pt-2">
            <Button
              className="w-full"
              size="lg"
              disabled={cart.length === 0}
              onClick={() => setCheckoutModalOpen(true)}
            >
              <Receipt className="h-4 w-4" /> Checkout
            </Button>
          </div>
        </div>
      </div>

      {/* ── Checkout Modal ── */}
      <Modal
        open={checkoutModalOpen}
        onClose={() => setCheckoutModalOpen(false)}
        title="Complete Sale"
        size="md"
      >
        <div className="space-y-4">
          {/* Summary */}
          <div className="rounded-lg bg-gray-50 p-3 space-y-1">
            <div className="flex justify-between text-sm text-gray-600">
              <span>Items</span>
              <span>{cart.reduce((s, i) => s + i.quantity, 0)}</span>
            </div>
            <div className="flex justify-between text-sm text-gray-600">
              <span>Subtotal</span>
              <span>{formatCurrency(subtotalBeforeDiscount)}</span>
            </div>
            {totalDiscountAmount > 0 && (
              <div className="flex justify-between text-sm text-green-600">
                <span>Discount</span>
                <span>−{formatCurrency(totalDiscountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-bold text-gray-900 border-t border-gray-200 pt-1 mt-1">
              <span>Grand Total</span>
              <span>{formatCurrency(grandTotal)}</span>
            </div>
          </div>

          {/* Customer */}
          <div className="rounded-lg bg-brand-50 p-3 text-sm">
            <p className="font-medium text-brand-800">{customerName || '—'}</p>
            <p className="text-brand-600">{customerPhone || '—'}</p>
          </div>

          {/* Payment method */}
          <div className="grid grid-cols-3 gap-2">
            {PAYMENT_METHODS.map((m) => (
              <button
                key={m.value}
                onClick={() => setPaymentMethod(m.value)}
                className={cn(
                  'rounded-lg border px-2 py-2 text-xs font-medium transition-colors',
                  paymentMethod === m.value
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Amount paid (cash) */}
          {paymentMethod === 'cash' && (
            <div className="space-y-2">
              <Input
                label="Amount Paid"
                type="number"
                step="0.01"
                min={grandTotal}
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value)}
              />
              {parseFloat(amountPaid) >= grandTotal && (
                <div className="flex justify-between text-sm font-medium text-green-700 bg-green-50 rounded-lg px-3 py-2">
                  <span>Change due</span>
                  <span>{formatCurrency(changeDue)}</span>
                </div>
              )}
              {amountPaid && parseFloat(amountPaid) < grandTotal && (
                <p className="flex items-center gap-1 text-xs text-red-500">
                  <AlertCircle className="h-3.5 w-3.5" />
                  Short by {formatCurrency(grandTotal - parseFloat(amountPaid))}
                </p>
              )}
            </div>
          )}

          <Input
            label="Notes (optional)"
            placeholder="Any remarks…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />

          <div className="flex gap-3 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => setCheckoutModalOpen(false)}>
              Back
            </Button>
            <Button className="flex-1" loading={submitting} onClick={checkout}>
              Confirm Sale
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Shift Close Modal ── */}
      <Modal open={shiftModalOpen} onClose={() => { if (!shiftSubmitting) { setShiftModalOpen(false); setShiftStats(null); setOpeningFloat(''); setActualCash(''); setShiftNotes('') } }} title="Close Shift" size="sm">
        <div className="space-y-4">
          {shiftLoading ? (
            <div className="py-6 text-center text-sm text-gray-400">Loading today's stats…</div>
          ) : shiftStats ? (
            <div className="rounded-lg bg-gray-50 p-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Sales today</span><span className="font-medium">{shiftStats.saleCount}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Total revenue</span><span className="font-medium">{formatCurrency(shiftStats.totalRevenue)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Cash sales ({shiftStats.cashSaleCount})</span><span className="font-medium">{formatCurrency(shiftStats.cashRevenue)}</span></div>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Opening Float (Rs.)</label>
              <input type="number" min={0} step="0.01" value={openingFloat} onChange={(e) => setOpeningFloat(e.target.value)}
                placeholder="0.00" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Actual Cash in Drawer</label>
              <input type="number" min={0} step="0.01" value={actualCash} onChange={(e) => setActualCash(e.target.value)}
                placeholder="0.00" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
          </div>
          {shiftStats && actualCash && openingFloat !== '' && (
            (() => {
              const expected = parseFloat(openingFloat || '0') + shiftStats.cashRevenue
              const actual = parseFloat(actualCash || '0')
              const variance = actual - expected
              return (
                <div className={cn('rounded-lg p-3 text-sm', variance === 0 ? 'bg-green-50' : Math.abs(variance) < 50 ? 'bg-yellow-50' : 'bg-red-50')}>
                  <div className="flex justify-between"><span className="text-gray-600">Expected cash</span><span className="font-medium">{formatCurrency(expected)}</span></div>
                  <div className="flex justify-between font-semibold mt-1">
                    <span>Variance</span>
                    <span className={variance > 0 ? 'text-green-700' : variance < 0 ? 'text-red-700' : 'text-gray-700'}>
                      {variance >= 0 ? '+' : ''}{formatCurrency(variance)}
                    </span>
                  </div>
                </div>
              )
            })()
          )}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Notes (optional)</label>
            <input value={shiftNotes} onChange={(e) => setShiftNotes(e.target.value)} placeholder="Any remarks about this shift…"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" disabled={shiftSubmitting} onClick={() => setShiftModalOpen(false)}>Cancel</Button>
            <Button className="flex-1" loading={shiftSubmitting} disabled={!shiftStats} onClick={closeShift}>Close Shift</Button>
          </div>
        </div>
      </Modal>

      {/* ── Return Modal ── */}
      <Modal open={returnModalOpen} onClose={() => { if (!returnSubmitting) { setReturnModalOpen(false); setSelectedReturnSale(null); setReturnResults([]); setReturnPhoneSearch(''); setReturnReason('') } }} title={selectedReturnSale ? 'Select Items to Return' : 'Process Return'} size="md">
        {!selectedReturnSale ? (
          <div className="space-y-4">
            <div className="flex gap-2">
              <input
                value={returnPhoneSearch}
                onChange={(e) => setReturnPhoneSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchReturnSale()}
                placeholder="Customer phone number…"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <Button onClick={searchReturnSale} loading={returnSearching}>Search</Button>
            </div>
            {returnResults.length > 0 && (
              <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
                {returnResults.map((s) => (
                  <button key={s.id} onClick={() => selectReturnSale(s)} className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-brand-50 transition-colors">
                    <div>
                      <p className="text-sm font-medium text-gray-900">#{s.id.slice(-8).toUpperCase()} · {s.customerName}</p>
                      <p className="text-xs text-gray-400">{s.items.reduce((n, i) => n + i.quantity, 0)} items · {formatCurrency(s.grandTotal)} · {s.paymentMethod}</p>
                    </div>
                    {s.returnStatus === 'partial' && <span className="text-xs text-amber-600 font-medium">Partial return</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm flex items-center justify-between">
              <span className="text-gray-600">Sale #{selectedReturnSale.id.slice(-8).toUpperCase()} · {selectedReturnSale.customerName}</span>
              <button onClick={() => { setSelectedReturnSale(null); setReturnQtys({}) }} className="text-xs text-brand-600 hover:underline">Change</button>
            </div>
            <div className="space-y-2">
              {selectedReturnSale.items.map((item) => (
                <div key={item.bookId} className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{item.bookName}</p>
                    <p className="text-xs text-gray-400">Qty: {item.quantity} · {formatCurrency(item.subtotal)}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setReturnQtys((p) => ({ ...p, [item.bookId]: Math.max(0, (p[item.bookId] ?? 0) - 1) }))} className="rounded p-1 hover:bg-gray-100"><Minus className="h-3 w-3" /></button>
                    <span className="w-8 text-center text-sm font-medium">{returnQtys[item.bookId] ?? 0}</span>
                    <button onClick={() => setReturnQtys((p) => ({ ...p, [item.bookId]: Math.min(item.quantity, (p[item.bookId] ?? 0) + 1) }))} className="rounded p-1 hover:bg-gray-100"><Plus className="h-3 w-3" /></button>
                  </div>
                </div>
              ))}
            </div>
            {Object.values(returnQtys).some((q) => q > 0) && (
              <div className="rounded-lg bg-brand-50 px-3 py-2 text-sm flex justify-between">
                <span className="text-brand-700">Refund estimate</span>
                <span className="font-semibold text-brand-800">
                  {formatCurrency(selectedReturnSale.items.reduce((sum, item) => {
                    const qty = returnQtys[item.bookId] ?? 0
                    return sum + (item.subtotal / item.quantity) * qty
                  }, 0))}
                </span>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Return Reason *</label>
              <input value={returnReason} onChange={(e) => setReturnReason(e.target.value)}
                placeholder="e.g. Damaged book, wrong title…"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" disabled={returnSubmitting} onClick={() => { setSelectedReturnSale(null); setReturnQtys({}) }}>Back</Button>
              <Button className="flex-1" loading={returnSubmitting} onClick={processReturn}>Confirm Return</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Success Modal ── */}
      <Modal
        open={successModalOpen}
        onClose={() => setSuccessModalOpen(false)}
        title="Sale Complete"
        size="sm"
      >
        <div className="text-center py-4 space-y-3">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <CheckCircle className="h-8 w-8 text-green-600" />
          </div>
          <p className="text-lg font-semibold text-gray-900">Sale recorded!</p>
          <p className="text-sm text-gray-500">Sale ID: <span className="font-mono text-xs">{lastSaleId.slice(-8)}</span></p>
          <div className="flex gap-2 w-full">
            <Button variant="outline" className="flex-1" onClick={() => lastSaleData && printReceipt(lastSaleData)}>
              <Printer className="h-4 w-4" /> Print Receipt
            </Button>
            <Button className="flex-1" onClick={() => setSuccessModalOpen(false)}>
              New Sale ({successCountdown}s)
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
