import { useState, useEffect } from 'react'
import type { DailyAnalytics } from '@/lib/analyticsAgg'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import {
  BarChart2, Users, Receipt, FileText, BookOpen, Package,
  TrendingUp, AlertTriangle, Plus, Search, UserX, UserCheck,
  ShoppingBag, DollarSign, Download, Printer, RotateCcw, Minus, RefreshCw,
  KeyRound, Shield,
} from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { format, subDays } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { mapProfile, mapSale, mapSaleItem, mapAuditLog } from '@/lib/mappers'
import { createStaffUser, resetStaffPassword, changeStaffRole, sendStaffResetEmail } from '@/lib/staffUsers'
import { printReceipt } from '@/lib/receipt'
import { reverseDailyAnalytics } from '@/lib/analyticsAgg'
import { useAuth } from '@/contexts/AuthContext'
import { useBooks } from '@/contexts/BooksContext'
import { useWarehouse } from '@/contexts/WarehouseContext'
import { writeAuditLog } from '@/lib/auditLog'
import { applyInventoryDelta, recordReturnMovement } from '@/lib/inventoryService'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import type { AppUser, Sale, SaleItem, AuditLog, UserRole, ReturnStatus } from '@/types'
import { getAuthErrorMessage } from '@/lib/authErrors'
import { roleLabel, STAFF_ROLE_OPTIONS, rolePermissions } from '@/lib/roles'
import { UserAvatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { StatCard } from '@/components/ui/Card'
import { PageSpinner } from '@/components/ui/Spinner'
import { cn } from '@/lib/utils'
import { downloadCSV } from '@/lib/csvUtils'

type Tab = 'analytics' | 'users' | 'sales' | 'audit'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'users',     label: 'Staff',      icon: <Users className="h-4 w-4" /> },
  { id: 'sales',     label: 'Sales',      icon: <Receipt className="h-4 w-4" /> },
  { id: 'analytics', label: 'Analytics',  icon: <BarChart2 className="h-4 w-4" /> },
  { id: 'audit',     label: 'Audit',      icon: <FileText className="h-4 w-4" /> },
]

// Labels match roleLabel() — operator-facing names + permission hints.
const ROLE_OPTIONS = STAFF_ROLE_OPTIONS.map((r) => ({
  value: r.value,
  label: `${r.label} — ${r.desc}`,
}))

const userSchema = z.object({
  displayName: z.string().min(1, 'Required'),
  email: z.string().email('Valid email required'),
  password: z.string().min(8, 'Min 8 characters'),
  role: z.enum(['superadmin', 'admin', 'warehouse', 'cashier', 'receptionist']),
})
type UserFormData = z.infer<typeof userSchema>

const CHART_COLORS = ['#f37023', '#9c090e', '#10b981', '#3b82f6', '#8b5cf6']

const SALES_PAGE_SIZE = 50
const AUDIT_PAGE_SIZE = 20

/** Fetch a page of sales (with their line items joined in) ordered newest-first. */
async function fetchSalesPage(from: number, to: number): Promise<(Sale & { id: string })[]> {
  const { data, error } = await supabase
    .from('sales')
    .select('*')
    .order('created_at', { ascending: false })
    .range(from, to)
  if (error || !data) return []
  const rows = data as Array<Record<string, unknown>>
  const ids = rows.map((r) => r.id as string)
  let itemsBySale: Record<string, SaleItem[]> = {}
  if (ids.length > 0) {
    const { data: itemRows } = await supabase.from('sale_items').select('*').in('sale_id', ids)
    for (const row of (itemRows ?? []) as Array<Record<string, unknown>>) {
      const saleId = row.sale_id as string
      if (!itemsBySale[saleId]) itemsBySale[saleId] = []
      itemsBySale[saleId].push(mapSaleItem(row))
    }
  }
  return rows.map((r) => mapSale(r, itemsBySale[r.id as string] ?? []))
}

export default function SuperAdmin() {
  const { appUser } = useAuth()
  const { books } = useBooks()
  const { bookstoreId } = useWarehouse()
  const [activeTab, setActiveTab] = useState<Tab>('users')

  // ─── Data ──────────────────────────────────────────────────────────────────
  const [users, setUsers]         = useState<AppUser[]>([])
  const [sales, setSales]         = useState<(Sale & { id: string })[]>([])
  const [auditLogs, setAuditLogs] = useState<(AuditLog & { id: string })[]>([])
  const [analyticsDocs, setAnalyticsDocs] = useState<DailyAnalytics[]>([])
  const [loading, setLoading]     = useState(true)

  // Pagination offsets
  const [hasMoreSales, setHasMoreSales]   = useState(false)
  const [loadingMoreSales, setLoadingMoreSales] = useState(false)
  const [hasMoreAudit, setHasMoreAudit]   = useState(false)
  const [loadingMoreAudit, setLoadingMoreAudit] = useState(false)

  // Filters
  const [salesSearch, setSalesSearch] = useState('')
  const [auditSearch, setAuditSearch] = useState('')

  // Modals
  const [userModalOpen, setUserModalOpen] = useState(false)
  const [submittingUser, setSubmittingUser] = useState(false)
  const [voidModal, setVoidModal] = useState<Sale | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [voidSubmitting, setVoidSubmitting] = useState(false)
  const [togglingUserId, setTogglingUserId] = useState<string | null>(null)
  const [resetUser, setResetUser] = useState<AppUser | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [resetSubmitting, setResetSubmitting] = useState(false)
  const [roleUser, setRoleUser] = useState<AppUser | null>(null)
  const [roleValue, setRoleValue] = useState<UserRole>('cashier')
  const [roleSubmitting, setRoleSubmitting] = useState(false)
  const [returnModal, setReturnModal] = useState<Sale | null>(null)
  const [returnQtys, setReturnQtys] = useState<Record<string, number>>({})
  const [returnReason, setReturnReason] = useState('')
  const [returnSubmitting, setReturnSubmitting] = useState(false)

  // ─── Data loading ──────────────────────────────────────────────────────────
  // Strategy (minimises reads):
  //   • Users  — live realtime channel (need real-time for activation/deactivation)
  //   • Analytics — 30 daily-summary rows  ≈ 30 rows (replaces 500-sale load)
  //   • Sales log  — first 50 most recent   ≈ 50 rows  (+ "Load more" pages)
  //   • Audit log  — first 20 most recent   ≈ 20 rows  (+ "Load more" pages)

  useEffect(() => {
    async function loadUsers() {
      const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: false })
      if (error) return
      setUsers((data ?? []).map((r) => mapProfile(r)))
    }
    void loadUsers()
    const channel = supabase
      .channel('profiles-superadmin-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => void loadUsers())
      .subscribe()

    // Build array of the last 30 date strings to fetch analytics rows
    const last30Dates = Array.from({ length: 30 }, (_, i) => {
      const d = subDays(new Date(), i)
      return format(d, 'yyyy-MM-dd')
    })

    Promise.all([
      supabase.from('analytics').select('id, data').in('id', last30Dates),
      fetchSalesPage(0, SALES_PAGE_SIZE - 1),
      supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).range(0, AUDIT_PAGE_SIZE - 1),
    ]).then(([analyticsRes, salesRows, auditRes]) => {
      setAnalyticsDocs(
        (analyticsRes.data ?? []).map((r) => r.data as DailyAnalytics),
      )
      setSales(salesRows)
      setHasMoreSales(salesRows.length === SALES_PAGE_SIZE)

      const auditRows = (auditRes.data ?? []).map((r) => mapAuditLog(r as Record<string, unknown>))
      setAuditLogs(auditRows)
      setHasMoreAudit(auditRows.length === AUDIT_PAGE_SIZE)

      setLoading(false)
    }).catch(() => setLoading(false))

    return () => { void supabase.removeChannel(channel) }
  }, [])

  const loadMoreSales = async () => {
    if (loadingMoreSales) return
    setLoadingMoreSales(true)
    try {
      const next = await fetchSalesPage(sales.length, sales.length + SALES_PAGE_SIZE - 1)
      setSales((prev) => [...prev, ...next])
      setHasMoreSales(next.length === SALES_PAGE_SIZE)
    } finally {
      setLoadingMoreSales(false)
    }
  }

  const loadMoreAudit = async () => {
    if (loadingMoreAudit) return
    setLoadingMoreAudit(true)
    try {
      const { data } = await supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .range(auditLogs.length, auditLogs.length + AUDIT_PAGE_SIZE - 1)
      const next = (data ?? []).map((r) => mapAuditLog(r as Record<string, unknown>))
      setAuditLogs((prev) => [...prev, ...next])
      setHasMoreAudit(next.length === AUDIT_PAGE_SIZE)
    } finally {
      setLoadingMoreAudit(false)
    }
  }

  // ─── Analytics backfill ────────────────────────────────────────────────────
  // One-time operation: reads all historical sales and writes correct analytics
  // rows from scratch so data exists before the live aggregation was deployed.

  const [backfillState, setBackfillState] = useState<
    null | { phase: 'loading'; loaded: number } | { phase: 'writing'; done: number; total: number } | { phase: 'done' }
  >(null)

  const runBackfill = async () => {
    if (!appUser) return
    setBackfillState({ phase: 'loading', loaded: 0 })
    try {
      // 1. Load every sale (with items) — paginate in chunks of 500
      const allSales: (Sale & { id: string })[] = []
      let offset = 0
      const CHUNK = 500
      while (true) {
        // eslint-disable-next-line no-await-in-loop
        const page = await fetchSalesPage(offset, offset + CHUNK - 1)
        allSales.push(...page)
        setBackfillState({ phase: 'loading', loaded: allSales.length })
        if (page.length < CHUNK) break
        offset += CHUNK
      }

      // 2. Aggregate completed sales by day — compute full analytics client-side
      const dayMap: Record<string, DailyAnalytics> = {}
      allSales
        .filter((s) => s.status === 'completed')
        .forEach((sale) => {
          if (!sale.createdAt) return
          const saleDate = new Date(sale.createdAt as string)
          if (Number.isNaN(saleDate.getTime())) return
          const dateStr = format(saleDate, 'yyyy-MM-dd')
          const hourKey = String(saleDate.getHours())

          if (!dayMap[dateStr]) {
            dayMap[dateStr] = {
              date: dateStr, totalRevenue: 0, saleCount: 0,
              cashRevenue: 0, cashSaleCount: 0,
              hourlyRevenue: {}, hourlyCount: {}, topBooks: {}, paymentMethods: {},
            }
          }
          const day = dayMap[dateStr]
          day.totalRevenue  += sale.grandTotal
          day.saleCount     += 1
          if (sale.paymentMethod === 'cash') {
            day.cashRevenue  += sale.grandTotal
            day.cashSaleCount += 1
          }
          day.hourlyRevenue[hourKey] = (day.hourlyRevenue[hourKey] ?? 0) + sale.grandTotal
          day.hourlyCount[hourKey]   = (day.hourlyCount[hourKey]   ?? 0) + 1

          const pm = sale.paymentMethod
          if (!day.paymentMethods[pm]) day.paymentMethods[pm] = { count: 0, revenue: 0 }
          day.paymentMethods[pm].count   += 1
          day.paymentMethods[pm].revenue += sale.grandTotal

          sale.items.forEach((item) => {
            if (!day.topBooks[item.bookId]) day.topBooks[item.bookId] = { name: item.bookName, qty: 0, revenue: 0 }
            day.topBooks[item.bookId].qty     += item.quantity
            day.topBooks[item.bookId].revenue += item.subtotal
          })
        })

      // 3. Write each day's row — full overwrite for accuracy
      const dates = Object.keys(dayMap)
      for (let i = 0; i < dates.length; i++) {
        setBackfillState({ phase: 'writing', done: i, total: dates.length })
        // eslint-disable-next-line no-await-in-loop
        await supabase.from('analytics').upsert({
          id: dates[i],
          data: dayMap[dates[i]] as unknown as Record<string, unknown>,
          updated_at: new Date().toISOString(),
        })
      }

      // 4. Reload analytics into local state
      const last30Dates = Array.from({ length: 30 }, (_, i) => format(subDays(new Date(), i), 'yyyy-MM-dd'))
      const { data: refreshed } = await supabase.from('analytics').select('id, data').in('id', last30Dates)
      setAnalyticsDocs((refreshed ?? []).map((r) => r.data as DailyAnalytics))

      setBackfillState({ phase: 'done' })
      toast.success(`Analytics rebuilt from ${allSales.length} sales across ${dates.length} days`)
    } catch (e) {
      toast.error('Backfill failed — see console for details')
      console.error('[backfill]', e)
      setBackfillState(null)
    }
  }

  // ─── Analytics computations (from pre-aggregated daily rows — 0 extra reads) ──

  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const analyticsMap = new Map(analyticsDocs.map((a) => [a.date, a]))
  const todayAnalytics = analyticsMap.get(todayStr)

  const todayRevenue    = todayAnalytics?.totalRevenue  ?? 0
  const todaySaleCount  = todayAnalytics?.saleCount     ?? 0
  const totalRevenue    = analyticsDocs.reduce((sum, a) => sum + (a.totalRevenue ?? 0), 0)
  const totalSalesCount = analyticsDocs.reduce((sum, a) => sum + (a.saleCount   ?? 0), 0)
  const avgOrderValue   = totalSalesCount > 0 ? totalRevenue / totalSalesCount : 0

  const lowStockBooks = books.filter((b) => b.inStock <= b.minStockAlert)

  // Revenue last 30 days chart — each point is one analytics row (already in memory)
  const revenueChart = Array.from({ length: 30 }, (_, i) => {
    const d       = subDays(new Date(), 29 - i)
    const dateStr = format(d, 'yyyy-MM-dd')
    return { date: format(d, 'MMM d'), revenue: analyticsMap.get(dateStr)?.totalRevenue ?? 0 }
  })

  // Top 5 books — aggregated across all 30 analytics rows
  const bookQtyMap: Record<string, { name: string; qty: number; revenue: number }> = {}
  analyticsDocs.forEach((a) => {
    Object.entries(a.topBooks ?? {}).forEach(([bookId, data]) => {
      if (!bookQtyMap[bookId]) bookQtyMap[bookId] = { name: data.name, qty: 0, revenue: 0 }
      bookQtyMap[bookId].qty     += data.qty     ?? 0
      bookQtyMap[bookId].revenue += data.revenue ?? 0
    })
  })
  const topBooks = Object.values(bookQtyMap).sort((a, b) => b.qty - a.qty).slice(0, 5)

  // Category distribution — from books context (already in memory, 0 reads)
  const categoryMap: Record<string, number> = {}
  books.forEach((b) => { categoryMap[b.category] = (categoryMap[b.category] ?? 0) + 1 })
  const categoryData = Object.entries(categoryMap).map(([name, value]) => ({ name, value }))

  // Payment method distribution — aggregated across 30 analytics rows
  const paymentMap: Record<string, { method: string; count: number; revenue: number }> = {}
  analyticsDocs.forEach((a) => {
    Object.entries(a.paymentMethods ?? {}).forEach(([method, data]) => {
      if (!paymentMap[method]) paymentMap[method] = { method, count: 0, revenue: 0 }
      paymentMap[method].count   += data.count   ?? 0
      paymentMap[method].revenue += data.revenue ?? 0
    })
  })
  const paymentData = Object.values(paymentMap).sort((a, b) => b.revenue - a.revenue)

  // Hourly distribution — from today's analytics row (most relevant for operations)
  const hourlyData = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    label: `${h.toString().padStart(2, '0')}:00`,
    count:   todayAnalytics?.hourlyCount?.[String(h)]   ?? 0,
    revenue: todayAnalytics?.hourlyRevenue?.[String(h)] ?? 0,
  }))

  // ─── User management ───────────────────────────────────────────────────────

  const { register, handleSubmit, reset, formState: { errors } } = useForm<UserFormData>({
    resolver: zodResolver(userSchema),
    defaultValues: { role: 'cashier' },
  })

  const createUser = async (data: UserFormData) => {
    if (!appUser) return
    setSubmittingUser(true)
    try {
      const uid = await createStaffUser({
        email: data.email,
        password: data.password,
        displayName: data.displayName,
        role: data.role,
      })
      await writeAuditLog({
        action: 'user_created',
        entity: 'user',
        entityId: uid,
        details: `Created user "${data.displayName}" (${data.email}) with role: ${data.role}`,
        performedBy: appUser.uid,
        performedByName: appUser.displayName,
        role: appUser.role,
      })
      toast.success('User created successfully')
      setUserModalOpen(false)
      reset()
    } catch (e) {
      toast.error(getAuthErrorMessage(e))
    } finally {
      setSubmittingUser(false)
    }
  }

  const toggleUserActive = async (u: AppUser) => {
    if (!appUser) return
    if (u.uid === appUser.uid) { toast.error("You can't deactivate yourself"); return }
    if (togglingUserId) return   // prevent double-click
    setTogglingUserId(u.uid)
    try {
      const { error } = await supabase.from('profiles').update({ is_active: !u.isActive }).eq('id', u.uid)
      if (error) throw new Error(error.message)
      await writeAuditLog({
        action: 'user_updated',
        entity: 'user',
        entityId: u.uid,
        details: `${u.isActive ? 'Deactivated' : 'Activated'} user "${u.displayName}"`,
        performedBy: appUser.uid,
        performedByName: appUser.displayName,
        role: appUser.role,
      })
      toast.success(u.isActive ? 'User deactivated' : 'User activated')
    } catch {
      toast.error('Failed to update user status')
    } finally {
      setTogglingUserId(null)
    }
  }

  const submitResetPassword = async () => {
    if (!resetUser || !appUser) return
    if (resetPassword.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    setResetSubmitting(true)
    try {
      await resetStaffPassword({ userId: resetUser.uid, password: resetPassword })
      toast.success(`Password updated for ${resetUser.displayName}. Share it securely — it won’t be shown again.`)
      setResetUser(null)
      setResetPassword('')
    } catch (e) {
      toast.error(getAuthErrorMessage(e))
    } finally {
      setResetSubmitting(false)
    }
  }

  const submitChangeRole = async () => {
    if (!roleUser || !appUser) return
    setRoleSubmitting(true)
    try {
      await changeStaffRole({ userId: roleUser.uid, role: roleValue })
      toast.success(`Role updated to ${roleLabel(roleValue)}`)
      setRoleUser(null)
    } catch (e) {
      toast.error(getAuthErrorMessage(e))
    } finally {
      setRoleSubmitting(false)
    }
  }

  // ─── Void sale ─────────────────────────────────────────────────────────────

  const voidSale = async () => {
    if (!voidModal || !appUser) return
    if (voidReason.trim().length < 3) {
      toast.error('Please enter a reason (at least 3 characters)')
      return
    }
    setVoidSubmitting(true)
    try {
      const { error } = await supabase
        .from('sales')
        .update({
          status: 'voided',
          void_reason: voidReason.trim(),
          voided_by: appUser.uid,
          voided_at: new Date().toISOString(),
        })
        .eq('id', voidModal.id)
      if (error) throw new Error(error.message)
      await writeAuditLog({
        action: 'sale_voided',
        entity: 'sale',
        entityId: voidModal.id,
        details: `Voided sale ${voidModal.id.slice(-8)} — ${voidReason.trim()}`,
        performedBy: appUser.uid,
        performedByName: appUser.displayName,
        role: appUser.role,
      })
      // Subtract this sale's numbers from the daily analytics row so voided
      // sales are never counted in revenue/charts
      if (voidModal.createdAt) {
        reverseDailyAnalytics({
          grandTotal:    voidModal.grandTotal,
          paymentMethod: voidModal.paymentMethod,
          items:         voidModal.items.map((i) => ({
            bookId:   i.bookId,
            bookName: i.bookName,
            quantity: i.quantity,
            subtotal: i.subtotal,
          })),
          saleCreatedAt: voidModal.createdAt,
        })
      }
      // Update local state without re-fetching
      setSales((prev) => prev.map((s) =>
        s.id === voidModal.id ? { ...s, status: 'voided', voidReason: voidReason.trim() } : s
      ))
      toast.success('Sale voided')
      setVoidModal(null)
      setVoidReason('')
    } catch {
      toast.error('Failed to void sale')
    } finally {
      setVoidSubmitting(false)
    }
  }

  // ─── Return sale ───────────────────────────────────────────────────────────

  const openReturnModal = (sale: Sale) => {
    setReturnModal(sale)
    const qtys: Record<string, number> = {}
    sale.items.forEach((item) => { qtys[item.bookId] = 0 })
    setReturnQtys(qtys)
    setReturnReason('')
  }

  const processReturn = async () => {
    if (!returnModal || !appUser) return
    const itemsToReturn = returnModal.items.filter((item) => (returnQtys[item.bookId] ?? 0) > 0)
    if (itemsToReturn.length === 0) { toast.error('Select at least one item to return'); return }
    if (!returnReason.trim()) { toast.error('Return reason is required'); return }

    // Safe division guard
    const refundAmount = itemsToReturn.reduce((sum, item) => {
      if (!item.quantity) return sum
      const perUnit = item.subtotal / item.quantity
      return sum + perUnit * (returnQtys[item.bookId] ?? 0)
    }, 0)

    const totalOriginalQty = returnModal.items.reduce((s, i) => s + i.quantity, 0)
    const returnedQty = itemsToReturn.reduce((s, item) => s + (returnQtys[item.bookId] ?? 0), 0)
    const returnStatusValue: ReturnStatus = returnedQty >= totalOriginalQty ? 'full' : 'partial'
    const returnedItemsList = itemsToReturn.map((item) => ({
      bookId: item.bookId,
      bookName: item.bookName,
      quantityReturned: returnQtys[item.bookId],
    }))

    setReturnSubmitting(true)
    try {
      // No client-side transaction primitive in Supabase — apply each item's
      // stock restore sequentially, then update the sale record.
      for (const item of itemsToReturn) {
        const qty = returnQtys[item.bookId]

        // eslint-disable-next-line no-await-in-loop
        const { data: bookRow } = await supabase.from('books').select('in_stock').eq('id', item.bookId).maybeSingle()
        const current = Number(bookRow?.in_stock ?? 0)

        // eslint-disable-next-line no-await-in-loop
        await applyInventoryDelta(item.bookId, bookstoreId, bookstoreId, qty)

        // eslint-disable-next-line no-await-in-loop
        await recordReturnMovement({
          bookId: item.bookId,
          bookName: item.bookName,
          quantity: qty,
          bookstoreId,
          saleId: returnModal.id,
          user: { uid: appUser.uid, displayName: appUser.displayName },
        })

        // eslint-disable-next-line no-await-in-loop
        await supabase.from('stock_transactions').insert({
          book_id: item.bookId,
          book_name: item.bookName,
          type: 'in',
          quantity: qty,
          previous_stock: current,
          new_stock: current + qty,
          reason: `Return — sale ${returnModal.id.slice(-8)}`,
          reference: returnModal.id,
          performed_by: appUser.uid,
          performed_by_name: appUser.displayName,
        })
      }

      const { error: updateError } = await supabase
        .from('sales')
        .update({
          return_status: returnStatusValue,
          returned_items: returnedItemsList,
          return_reason: returnReason.trim(),
          returned_by: appUser.uid,
          returned_at: new Date().toISOString(),
          return_refund_amount: refundAmount,
        })
        .eq('id', returnModal.id)
      if (updateError) throw new Error(updateError.message)

      setSales((prev) => prev.map((s) =>
        s.id === returnModal.id ? {
          ...s,
          returnStatus: returnStatusValue,
          returnedItems: returnedItemsList,
          returnReason: returnReason.trim(),
          returnRefundAmount: refundAmount,
        } : s
      ))

      await writeAuditLog({
        action: 'sale_returned',
        entity: 'sale',
        entityId: returnModal.id,
        details: `Return for sale ${returnModal.id.slice(-8)} · ${returnedQty} item(s) · Refund: ${formatCurrency(refundAmount)}`,
        performedBy: appUser.uid,
        performedByName: appUser.displayName,
        role: appUser.role,
      })

      toast.success(`Return processed · Refund: ${formatCurrency(refundAmount)}`)
      setReturnModal(null)
      setReturnQtys({})
      setReturnReason('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Return failed')
    } finally {
      setReturnSubmitting(false)
    }
  }

  // ─── CSV exports ───────────────────────────────────────────────────────────

  const exportRevenue = () => {
    downloadCSV(
      `revenue_30days_${format(new Date(), 'yyyy-MM-dd')}.csv`,
      ['Date', 'Revenue (Rs.)'],
      revenueChart.map((r) => [r.date, r.revenue])
    )
  }

  const exportTopBooks = () => {
    downloadCSV(
      `top_books_${format(new Date(), 'yyyy-MM-dd')}.csv`,
      ['Book Name', 'Copies Sold', 'Revenue (Rs.)'],
      topBooks.map((b) => [b.name, b.qty, b.revenue])
    )
  }

  const exportLowStock = () => {
    downloadCSV(
      `low_stock_${format(new Date(), 'yyyy-MM-dd')}.csv`,
      ['Book Name', 'Author', 'Category', 'In Stock', 'Alert Threshold', 'MRP (Rs.)'],
      lowStockBooks.map((b) => [b.name, b.author ?? '', b.category, b.inStock, b.minStockAlert, b.mrp])
    )
  }

  const exportSales = () => {
    downloadCSV(
      `sales_log_${format(new Date(), 'yyyy-MM-dd')}.csv`,
      ['Sale ID', 'Date', 'Customer Name', 'Customer Phone', 'Items', 'Total (Rs.)', 'Payment Method', 'Cashier', 'Status'],
      filteredSales.map((s) => [
        s.id.slice(-8),
        s.createdAt ? formatDateTime(s.createdAt) : '',
        s.customerName,
        s.customerPhone,
        s.items.reduce((n, i) => n + i.quantity, 0),
        s.grandTotal,
        s.paymentMethod,
        s.cashierName,
        s.status,
      ])
    )
  }

  const exportAuditLog = () => {
    downloadCSV(
      `audit_log_${format(new Date(), 'yyyy-MM-dd')}.csv`,
      ['Date', 'Action', 'Details', 'Performed By', 'Role'],
      filteredAudit.map((a) => [
        a.createdAt ? formatDateTime(a.createdAt) : '',
        a.action,
        a.details,
        a.performedByName,
        a.role,
      ])
    )
  }

  // ─── Filtered lists ────────────────────────────────────────────────────────

  const filteredSales = sales.filter((s) => {
    const q = salesSearch.toLowerCase()
    return !q || s.customerName.toLowerCase().includes(q) || s.customerPhone.includes(q) || s.cashierName.toLowerCase().includes(q)
  })

  const filteredAudit = auditLogs.filter((a) => {
    const q = auditSearch.toLowerCase()
    return !q || a.details.toLowerCase().includes(q) || a.performedByName.toLowerCase().includes(q) || a.action.includes(q)
  })

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) return <PageSpinner />

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Staff</h1>
        <p className="text-sm text-gray-500">Add people · roles · passwords</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 gap-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
              activeTab === tab.id
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            )}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ── ANALYTICS TAB ── */}
      {activeTab === 'analytics' && (
        <div className="space-y-6">

          {/* Backfill banner */}
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-blue-800">Analytics data missing or outdated?</p>
              <p className="text-xs text-blue-600 mt-0.5">
                Run a one-time rebuild to compute analytics from all historical sales.
                {backfillState?.phase === 'loading' && ` Loading sales… ${backfillState.loaded} so far`}
                {backfillState?.phase === 'writing' && ` Writing ${backfillState.done}/${backfillState.total} days…`}
                {backfillState?.phase === 'done'    && ' ✓ Done — analytics are up to date.'}
              </p>
              {(backfillState?.phase === 'loading' || backfillState?.phase === 'writing') && (
                <div className="mt-2 h-1.5 rounded-full bg-blue-200 overflow-hidden w-48">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all duration-300"
                    style={{
                      width: backfillState.phase === 'writing'
                        ? `${Math.round((backfillState.done / backfillState.total) * 100)}%`
                        : '100%',
                    }}
                  />
                </div>
              )}
            </div>
            <button
              onClick={runBackfill}
              disabled={backfillState?.phase === 'loading' || backfillState?.phase === 'writing'}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${(backfillState?.phase === 'loading' || backfillState?.phase === 'writing') ? 'animate-spin' : ''}`} />
              {backfillState?.phase === 'done' ? 'Rebuild Again' : 'Rebuild Analytics'}
            </button>
          </div>

          {/* Stat cards */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="Today's Revenue"
              value={formatCurrency(todayRevenue)}
              subtitle={`${todaySaleCount} sales today`}
              icon={<DollarSign className="h-5 w-5" />}
              color="accent"
            />
            <StatCard
              title="Revenue (30 days)"
              value={formatCurrency(totalRevenue)}
              subtitle={`${totalSalesCount} sales`}
              icon={<TrendingUp className="h-5 w-5" />}
              color="brand"
            />
            <StatCard
              title="Avg Order Value"
              value={formatCurrency(avgOrderValue)}
              subtitle="Per completed sale"
              icon={<ShoppingBag className="h-5 w-5" />}
              color="brand"
            />
            <StatCard
              title="Low Stock Alert"
              value={lowStockBooks.length}
              subtitle={lowStockBooks.length > 0 ? 'Need restocking' : 'All good'}
              icon={<AlertTriangle className="h-5 w-5" />}
              color={lowStockBooks.length > 0 ? 'red' : 'green'}
            />
          </div>

          {/* Revenue Chart */}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-700">Revenue — Last 30 Days</h2>
              <button onClick={exportRevenue} className="flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-700 font-medium">
                <Download className="h-3.5 w-3.5" /> CSV
              </button>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={revenueChart}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f37023" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f37023" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} interval={4} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
                  tickFormatter={(v) => `Rs.${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => [formatCurrency(v), 'Revenue']} />
                <Area type="monotone" dataKey="revenue" stroke="#f37023" strokeWidth={2}
                  fill="url(#revGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Top Books & Category */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-gray-700">Top 5 Books by Quantity Sold</h2>
                <button onClick={exportTopBooks} className="flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-700 font-medium">
                  <Download className="h-3.5 w-3.5" /> CSV
                </button>
              </div>
              {topBooks.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">No sales data yet</p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={topBooks} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} tickLine={false} />
                    <Tooltip formatter={(v: number) => [v, 'Copies sold']} />
                    <Bar dataKey="qty" fill="#f37023" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-5 flex flex-col">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Books by Category</h2>
              {categoryData.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">No books added yet</p>
              ) : (
                /* Dynamic height: 28px per bar, min 180, max 320, then scroll */
                <div className="overflow-y-auto" style={{ maxHeight: 280 }}>
                  <ResponsiveContainer
                    width="100%"
                    height={Math.max(180, categoryData.length * 28)}
                  >
                    <BarChart
                      data={[...categoryData].sort((a, b) => b.value - a.value)}
                      layout="vertical"
                      margin={{ top: 0, right: 30, bottom: 0, left: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
                      <XAxis
                        type="number"
                        allowDecimals={false}
                        tick={{ fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        tick={{ fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        width={100}
                      />
                      <Tooltip
                        formatter={(v: number) => [v, 'Books']}
                        cursor={{ fill: '#fef3e2' }}
                      />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={18}>
                        {[...categoryData]
                          .sort((a, b) => b.value - a.value)
                          .map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          {/* Hourly Sales + Payment Methods */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Sales by Hour of Day</h2>
              {totalSalesCount === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">No sales data yet</p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={hourlyData} margin={{ top: 0, right: 4, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 9 }} tickLine={false} interval={2} />
                    <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip
                      formatter={(v: number, name: string) =>
                        name === 'count' ? [v, 'Sales'] : [formatCurrency(v as number), 'Revenue']
                      }
                    />
                    <Bar dataKey="count" fill="#9c090e" radius={[3, 3, 0, 0]} name="count" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Revenue by Payment Method</h2>
              {paymentData.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">No sales data yet</p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={paymentData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false}
                      tickFormatter={(v) => `Rs.${(v / 1000).toFixed(0)}k`} />
                    <YAxis type="category" dataKey="method" tick={{ fontSize: 11 }} tickLine={false} width={90} />
                    <Tooltip formatter={(v: number) => [formatCurrency(v), 'Revenue']} />
                    <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                      {paymentData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Low stock table */}
          {lowStockBooks.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-red-700 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" /> Low Stock Books
                </h2>
                <button onClick={exportLowStock} className="flex items-center gap-1.5 text-xs text-red-600 hover:text-red-700 font-medium">
                  <Download className="h-3.5 w-3.5" /> CSV
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-red-600 uppercase">
                      <th className="pb-2 pr-4">Book</th>
                      <th className="pb-2 pr-4">Category</th>
                      <th className="pb-2 pr-4">In Stock</th>
                      <th className="pb-2">Alert Threshold</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-red-100">
                    {lowStockBooks.map((b) => (
                      <tr key={b.id}>
                        <td className="py-2 pr-4 font-medium text-gray-900">{b.name}</td>
                        <td className="py-2 pr-4 text-gray-500">{b.category}</td>
                        <td className="py-2 pr-4 font-bold text-red-600">{b.inStock}</td>
                        <td className="py-2 text-gray-500">{b.minStockAlert}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── USERS TAB ── */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => { reset({ role: 'cashier' }); setUserModalOpen(true) }}>
              <Plus className="h-4 w-4" /> Add User
            </Button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['Name', 'Email', 'Role', 'Status', 'Actions'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map((u) => (
                  <tr key={u.uid} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <UserAvatar name={u.displayName ?? ''} className="h-8 w-8 shrink-0" />
                        <span className="text-sm font-medium text-gray-900">{u.displayName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">{u.email}</td>
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <Badge variant={u.role === 'superadmin' ? 'blue' : u.role === 'admin' || u.role === 'warehouse' ? 'orange' : 'gray'}>
                          {roleLabel(u.role)}
                        </Badge>
                        <p className="text-[11px] text-gray-400 max-w-[12rem]">
                          {rolePermissions(u.role).join(' · ')}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={u.isActive ? 'green' : 'red'}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => { setResetUser(u); setResetPassword('') }}
                          disabled={u.uid === appUser?.uid}
                          title="Reset password"
                          className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                        >
                          <KeyRound className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => { setRoleUser(u); setRoleValue(u.role) }}
                          disabled={u.uid === appUser?.uid}
                          title="Change role"
                          className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                        >
                          <Shield className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (u.email) {
                              void sendStaffResetEmail({ email: u.email })
                                .then(() => toast.success('Reset email sent'))
                                .catch((e) => toast.error(getAuthErrorMessage(e)))
                            }
                          }}
                          disabled={u.uid === appUser?.uid || !u.email}
                          title="Send reset email"
                          className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-30 text-xs font-medium px-2"
                        >
                          Email
                        </button>
                        <button
                          onClick={() => toggleUserActive(u)}
                          disabled={u.uid === appUser?.uid || togglingUserId === u.uid}
                          title={u.isActive ? 'Deactivate user' : 'Activate user'}
                          className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-30 transition-colors"
                        >
                          {togglingUserId === u.uid
                            ? <span className="h-4 w-4 inline-block animate-spin border-2 border-gray-300 border-t-gray-600 rounded-full" />
                            : u.isActive
                            ? <UserX className="h-4 w-4 text-red-500" />
                            : <UserCheck className="h-4 w-4 text-green-500" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Modal open={userModalOpen} onClose={() => setUserModalOpen(false)} title="Add New User" size="sm">
            <form onSubmit={handleSubmit(createUser)} className="space-y-4">
              <Input label="Full Name *" error={errors.displayName?.message} {...register('displayName')} />
              <Input label="Email *" type="email" error={errors.email?.message} {...register('email')} />
              <Input label="Password *" type="password" error={errors.password?.message} hint="Min 8 characters" {...register('password')} />
              <Select label="Role *" options={ROLE_OPTIONS} error={errors.role?.message} {...register('role')} />
              <div className="flex gap-3 justify-end pt-1">
                <Button variant="outline" type="button" onClick={() => setUserModalOpen(false)}>Cancel</Button>
                <Button type="submit" loading={submittingUser}>Create User</Button>
              </div>
            </form>
          </Modal>

          <Modal
            open={!!resetUser}
            onClose={() => { if (!resetSubmitting) { setResetUser(null); setResetPassword('') } }}
            title={`Reset password · ${resetUser?.displayName ?? ''}`}
            size="sm"
          >
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Set a temporary password for {resetUser?.email}. Share it securely — it is shown only once here.
              </p>
              <Input
                label="New password *"
                type="password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                hint="Min 8 characters"
              />
              <div className="flex gap-3 justify-end">
                <Button variant="outline" type="button" disabled={resetSubmitting} onClick={() => setResetUser(null)}>Cancel</Button>
                <Button loading={resetSubmitting} onClick={() => void submitResetPassword()}>Reset password</Button>
              </div>
            </div>
          </Modal>

          <Modal
            open={!!roleUser}
            onClose={() => { if (!roleSubmitting) setRoleUser(null) }}
            title={`Change role · ${roleUser?.displayName ?? ''}`}
            size="sm"
          >
            <div className="space-y-4">
              <Select
                label="Role"
                options={ROLE_OPTIONS}
                value={roleValue}
                onChange={(e) => setRoleValue(e.target.value as UserRole)}
              />
              <div className="flex gap-3 justify-end">
                <Button variant="outline" type="button" disabled={roleSubmitting} onClick={() => setRoleUser(null)}>Cancel</Button>
                <Button loading={roleSubmitting} onClick={() => void submitChangeRole()}>Save role</Button>
              </div>
            </div>
          </Modal>
        </div>
      )}

      {/* ── SALES LOG TAB ── */}
      {activeTab === 'sales' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <input
                value={salesSearch}
                onChange={(e) => setSalesSearch(e.target.value)}
                placeholder="Search by customer, cashier…"
                className="w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <button onClick={exportSales} className="flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700 font-medium whitespace-nowrap">
              <Download className="h-4 w-4" /> Export CSV
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['Sale ID', 'Customer', 'Items', 'Total', 'Payment', 'Cashier', 'Date', 'Status', 'Actions'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredSales.length === 0 ? (
                  <tr><td colSpan={9} className="py-10 text-center text-sm text-gray-400">No sales found</td></tr>
                ) : filteredSales.map((s) => (
                  <tr key={s.id} className={cn('hover:bg-gray-50', s.status === 'voided' && 'opacity-50')}>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{s.id.slice(-8)}</td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-gray-900">{s.customerName}</p>
                      <p className="text-xs text-gray-400">{s.customerPhone}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{s.items.reduce((n, i) => n + i.quantity, 0)}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-gray-900">{formatCurrency(s.grandTotal)}</td>
                    <td className="px-4 py-3">
                      <Badge variant="blue">{s.paymentMethod}</Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">{s.cashierName}</td>
                    <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{formatDateTime(s.createdAt)}</td>
                    <td className="px-4 py-3">
                      <Badge variant={s.status === 'completed' ? 'green' : 'red'}>{s.status}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {s.status === 'completed' && (
                          <>
                            <button
                              onClick={() => printReceipt(s)}
                              title="Print receipt"
                              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
                            >
                              <Printer className="h-3.5 w-3.5" />
                            </button>
                            {s.returnStatus !== 'full' && (
                              <button
                                onClick={() => openReturnModal(s)}
                                title="Process return"
                                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-amber-600 transition-colors"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <button
                              onClick={() => setVoidModal(s)}
                              className="text-xs text-red-500 hover:text-red-700 hover:underline"
                            >
                              Void
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hasMoreSales && (
            <div className="flex justify-center pt-1">
              <Button variant="outline" size="sm" loading={loadingMoreSales} onClick={loadMoreSales}>
                Load more sales
              </Button>
            </div>
          )}

          <Modal open={!!returnModal} onClose={() => { if (!returnSubmitting) { setReturnModal(null); setReturnQtys({}); setReturnReason('') } }} title="Process Return" size="md">
            <div className="space-y-4">
              {returnModal && (
                <>
                  <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
                    Sale <span className="font-mono font-semibold">#{returnModal.id.slice(-8).toUpperCase()}</span> · {returnModal.customerName} · {formatCurrency(returnModal.grandTotal)}
                  </div>
                  <div className="space-y-2">
                    {returnModal.items.map((item) => (
                      <div key={item.bookId} className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{item.bookName}</p>
                          <p className="text-xs text-gray-400">Qty: {item.quantity} · {formatCurrency(item.subtotal)}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button onClick={() => setReturnQtys((p) => ({ ...p, [item.bookId]: Math.max(0, (p[item.bookId] ?? 0) - 1) }))} className="rounded p-1 hover:bg-gray-100"><Minus className="h-3 w-3" /></button>
                          <span className="w-8 text-center text-sm font-medium">{returnQtys[item.bookId] ?? 0}</span>
                          <button onClick={() => setReturnQtys((p) => ({ ...p, [item.bookId]: Math.min(item.quantity, (p[item.bookId] ?? 0) + 1) }))} className="rounded p-1 hover:bg-gray-100"><span className="text-sm font-medium">+</span></button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {Object.values(returnQtys).some((q) => q > 0) && (
                    <div className="rounded-lg bg-brand-50 px-3 py-2 text-sm flex justify-between">
                      <span className="text-brand-700">Refund estimate</span>
                      <span className="font-semibold text-brand-800">
                        {formatCurrency(returnModal.items.reduce((sum, item) => {
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
                  <div className="flex gap-3 justify-end">
                    <Button variant="outline" disabled={returnSubmitting} onClick={() => { setReturnModal(null); setReturnQtys({}); setReturnReason('') }}>Cancel</Button>
                    <Button loading={returnSubmitting} onClick={processReturn}>Confirm Return</Button>
                  </div>
                </>
              )}
            </div>
          </Modal>

          <Modal open={!!voidModal} onClose={() => { if (!voidSubmitting) { setVoidModal(null); setVoidReason('') } }} title="Void Sale" size="sm">
            <div className="space-y-4">
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800">
                <p className="font-semibold">This action cannot be undone.</p>
                <p className="mt-0.5">
                  Sale <span className="font-mono font-semibold">{voidModal?.id.slice(-8)}</span> · {voidModal && formatCurrency(voidModal.grandTotal)} · {voidModal?.customerName}
                </p>
              </div>
              <Input
                label="Void Reason * (min. 3 characters)"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="e.g. Customer returned items, duplicate entry…"
                error={voidReason.length > 0 && voidReason.trim().length < 3 ? 'Too short' : undefined}
              />
              <div className="flex gap-3 justify-end">
                <Button variant="outline" disabled={voidSubmitting} onClick={() => { setVoidModal(null); setVoidReason('') }}>Cancel</Button>
                <Button variant="danger" loading={voidSubmitting} onClick={voidSale}>Confirm Void</Button>
              </div>
            </div>
          </Modal>
        </div>
      )}

      {/* ── AUDIT LOG TAB ── */}
      {activeTab === 'audit' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <input
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                placeholder="Search logs…"
                className="w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <button onClick={exportAuditLog} className="flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700 font-medium whitespace-nowrap">
              <Download className="h-4 w-4" /> Export CSV
            </button>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
            {filteredAudit.length === 0 ? (
              <div className="py-10 text-center text-sm text-gray-400">No audit logs</div>
            ) : filteredAudit.map((log) => (

              <div key={log.id} className="flex items-start gap-3 px-4 py-3">
                <div className="shrink-0 mt-0.5">
                  <ActionIcon action={log.action} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800">{log.details}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-xs text-gray-400">{log.performedByName}</span>
                    <Badge variant={log.role === 'superadmin' ? 'blue' : log.role === 'admin' ? 'orange' : 'gray'} className="text-xs">
                      {log.role}
                    </Badge>
                  </div>
                </div>
                <span className="text-xs text-gray-400 shrink-0 whitespace-nowrap">{formatDateTime(log.createdAt)}</span>
              </div>
            ))}
          </div>

          {hasMoreAudit && (
            <div className="flex justify-center pt-1">
              <Button variant="outline" size="sm" loading={loadingMoreAudit} onClick={loadMoreAudit}>
                Load more logs
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ActionIcon({ action }: { action: string }) {
  const iconMap: Record<string, { icon: React.ReactNode; color: string }> = {
    login:            { icon: <Users className="h-3.5 w-3.5" />,      color: 'bg-blue-100 text-blue-600' },
    logout:           { icon: <Users className="h-3.5 w-3.5" />,      color: 'bg-gray-100 text-gray-600' },
    book_created:     { icon: <BookOpen className="h-3.5 w-3.5" />,   color: 'bg-green-100 text-green-600' },
    book_updated:     { icon: <BookOpen className="h-3.5 w-3.5" />,   color: 'bg-blue-100 text-blue-600' },
    stock_in:         { icon: <Package className="h-3.5 w-3.5" />,    color: 'bg-green-100 text-green-600' },
    stock_out:        { icon: <Package className="h-3.5 w-3.5" />,    color: 'bg-orange-100 text-orange-600' },
    sale_created:     { icon: <ShoppingBag className="h-3.5 w-3.5" />,color: 'bg-brand-100 text-brand-600' },
    sale_voided:      { icon: <ShoppingBag className="h-3.5 w-3.5" />,color: 'bg-red-100 text-red-600' },
    customer_created: { icon: <Users className="h-3.5 w-3.5" />,      color: 'bg-purple-100 text-purple-600' },
    user_created:     { icon: <Users className="h-3.5 w-3.5" />,      color: 'bg-blue-100 text-blue-600' },
  }
  const entry = iconMap[action] ?? { icon: <FileText className="h-3.5 w-3.5" />, color: 'bg-gray-100 text-gray-600' }
  return (
    <span className={cn('inline-flex h-6 w-6 items-center justify-center rounded-full', entry.color)}>
      {entry.icon}
    </span>
  )
}
