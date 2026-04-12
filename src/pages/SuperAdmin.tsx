import { useState, useEffect } from 'react'
import {
  collection, onSnapshot, getDocs, query, orderBy,
  doc, setDoc, updateDoc, serverTimestamp, limit,
} from 'firebase/firestore'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import {
  BarChart2, Users, Receipt, FileText, BookOpen, Package,
  TrendingUp, AlertTriangle, Plus, Search, UserX, UserCheck,
  ShoppingBag, DollarSign, Download,
} from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { format, subDays } from 'date-fns'
import { db, createUserViaRest } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useBooks } from '@/contexts/BooksContext'
import { writeAuditLog } from '@/lib/auditLog'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import type { AppUser, Sale, AuditLog, UserRole } from '@/types'
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
  { id: 'analytics', label: 'Analytics',  icon: <BarChart2 className="h-4 w-4" /> },
  { id: 'users',     label: 'Users',      icon: <Users className="h-4 w-4" /> },
  { id: 'sales',     label: 'Sales Log',  icon: <Receipt className="h-4 w-4" /> },
  { id: 'audit',     label: 'Audit Log',  icon: <FileText className="h-4 w-4" /> },
]

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'superadmin', label: 'Super Admin' },
  { value: 'admin',      label: 'Admin' },
  { value: 'cashier',    label: 'Cashier' },
]

const userSchema = z.object({
  displayName: z.string().min(1, 'Required'),
  email: z.string().email('Valid email required'),
  password: z.string().min(8, 'Min 8 characters'),
  role: z.enum(['superadmin', 'admin', 'cashier']),
})
type UserFormData = z.infer<typeof userSchema>

const CHART_COLORS = ['#f79e0a', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6']

export default function SuperAdmin() {
  const { appUser } = useAuth()
  const { books } = useBooks()
  const [activeTab, setActiveTab] = useState<Tab>('analytics')

  // ─── Data ──────────────────────────────────────────────────────────────────
  const [users, setUsers]     = useState<AppUser[]>([])
  const [sales, setSales]     = useState<Sale[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)

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

  // ─── Data loading ──────────────────────────────────────────────────────────
  // Users and books use live listeners (need real-time for toggling/stock alerts)
  // Sales and audit logs use one-time fetch to minimize Firestore reads

  useEffect(() => {
    const unsubs = [
      onSnapshot(query(collection(db, 'users'), orderBy('createdAt', 'desc')), (s) =>
        setUsers(s.docs.map((d) => ({ uid: d.id, ...d.data() }) as AppUser))),
    ]
    // One-time fetch for sales and audit logs
    Promise.all([
      getDocs(query(collection(db, 'sales'), orderBy('createdAt', 'desc'), limit(500))),
      getDocs(query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc'), limit(500))),
    ]).then(([salesSnap, auditSnap]) => {
      setSales(salesSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Sale))
      setAuditLogs(auditSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as AuditLog))
      setLoading(false)
    }).catch(() => setLoading(false))
    return () => unsubs.forEach((u) => u())
  }, [])

  // ─── Analytics computations ────────────────────────────────────────────────

  const completedSales = sales.filter((s) => s.status === 'completed')

  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const todaySales = completedSales.filter((s) => {
    if (!s.createdAt) return false
    return format(s.createdAt.toDate(), 'yyyy-MM-dd') === todayStr
  })
  const todayRevenue = todaySales.reduce((sum, s) => sum + s.grandTotal, 0)

  const totalRevenue = completedSales.reduce((sum, s) => sum + s.grandTotal, 0)
  const totalSalesCount = completedSales.length

  const lowStockBooks = books.filter((b) => b.inStock <= b.minStockAlert)

  // Revenue last 30 days chart data
  const revenueChart = Array.from({ length: 30 }, (_, i) => {
    const d = subDays(new Date(), 29 - i)
    const dateStr = format(d, 'yyyy-MM-dd')
    const rev = completedSales
      .filter((s) => s.createdAt && format(s.createdAt.toDate(), 'yyyy-MM-dd') === dateStr)
      .reduce((sum, s) => sum + s.grandTotal, 0)
    return { date: format(d, 'MMM d'), revenue: rev }
  })

  // Top 5 books by qty sold
  const bookQtyMap: Record<string, { name: string; qty: number; revenue: number }> = {}
  completedSales.forEach((sale) => {
    sale.items.forEach((item) => {
      if (!bookQtyMap[item.bookId]) bookQtyMap[item.bookId] = { name: item.bookName, qty: 0, revenue: 0 }
      bookQtyMap[item.bookId].qty += item.quantity
      bookQtyMap[item.bookId].revenue += item.subtotal
    })
  })
  const topBooks = Object.values(bookQtyMap)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5)

  // Category distribution
  const categoryMap: Record<string, number> = {}
  books.forEach((b) => { categoryMap[b.category] = (categoryMap[b.category] ?? 0) + 1 })
  const categoryData = Object.entries(categoryMap).map(([name, value]) => ({ name, value }))

  // Payment method distribution
  const paymentMap: Record<string, { method: string; count: number; revenue: number }> = {}
  completedSales.forEach((s) => {
    if (!paymentMap[s.paymentMethod]) paymentMap[s.paymentMethod] = { method: s.paymentMethod, count: 0, revenue: 0 }
    paymentMap[s.paymentMethod].count += 1
    paymentMap[s.paymentMethod].revenue += s.grandTotal
  })
  const paymentData = Object.values(paymentMap).sort((a, b) => b.revenue - a.revenue)

  // Hourly sales distribution (all time)
  const hourlyMap: Record<number, { hour: number; label: string; count: number; revenue: number }> = {}
  for (let h = 0; h < 24; h++) hourlyMap[h] = { hour: h, label: `${h.toString().padStart(2, '0')}:00`, count: 0, revenue: 0 }
  completedSales.forEach((s) => {
    if (!s.createdAt) return
    const h = s.createdAt.toDate().getHours()
    hourlyMap[h].count += 1
    hourlyMap[h].revenue += s.grandTotal
  })
  const hourlyData = Object.values(hourlyMap)

  // Average order value (last 30 days)
  const avgOrderValue = totalSalesCount > 0 ? totalRevenue / totalSalesCount : 0

  // ─── User management ───────────────────────────────────────────────────────

  const { register, handleSubmit, reset, formState: { errors } } = useForm<UserFormData>({
    resolver: zodResolver(userSchema),
    defaultValues: { role: 'cashier' },
  })

  const createUser = async (data: UserFormData) => {
    if (!appUser) return
    setSubmittingUser(true)
    try {
      const uid = await createUserViaRest(data.email, data.password)
      await setDoc(doc(db, 'users', uid), {
        email: data.email,
        displayName: data.displayName,
        role: data.role,
        isActive: true,
        createdAt: serverTimestamp(),
        createdBy: appUser.uid,
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
      toast.error(e instanceof Error ? e.message : 'Failed to create user')
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
      await updateDoc(doc(db, 'users', u.uid), { isActive: !u.isActive })
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

  // ─── Void sale ─────────────────────────────────────────────────────────────

  const voidSale = async () => {
    if (!voidModal || !appUser) return
    if (voidReason.trim().length < 3) {
      toast.error('Please enter a reason (at least 3 characters)')
      return
    }
    setVoidSubmitting(true)
    try {
      await updateDoc(doc(db, 'sales', voidModal.id), {
        status: 'voided',
        voidReason: voidReason.trim(),
        voidedBy: appUser.uid,
        voidedAt: serverTimestamp(),
      })
      await writeAuditLog({
        action: 'sale_voided',
        entity: 'sale',
        entityId: voidModal.id,
        details: `Voided sale ${voidModal.id.slice(-8)} — ${voidReason.trim()}`,
        performedBy: appUser.uid,
        performedByName: appUser.displayName,
        role: appUser.role,
      })
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
      lowStockBooks.map((b) => [b.name, b.author, b.category, b.inStock, b.minStockAlert, b.mrp])
    )
  }

  const exportSales = () => {
    downloadCSV(
      `sales_log_${format(new Date(), 'yyyy-MM-dd')}.csv`,
      ['Sale ID', 'Date', 'Customer Name', 'Customer Phone', 'Items', 'Total (Rs.)', 'Payment Method', 'Cashier', 'Status'],
      filteredSales.map((s) => [
        s.id.slice(-8),
        s.createdAt ? format(s.createdAt.toDate(), 'yyyy-MM-dd HH:mm') : '',
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
        a.createdAt ? format(a.createdAt.toDate(), 'yyyy-MM-dd HH:mm') : '',
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
        <h1 className="text-xl font-bold text-gray-900">Super Admin</h1>
        <p className="text-sm text-gray-500">Full system overview and controls</p>
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
          {/* Stat cards */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="Today's Revenue"
              value={formatCurrency(todayRevenue)}
              subtitle={`${todaySales.length} sales today`}
              icon={<DollarSign className="h-5 w-5" />}
              color="green"
            />
            <StatCard
              title="Total Revenue"
              value={formatCurrency(totalRevenue)}
              subtitle={`${totalSalesCount} total sales`}
              icon={<TrendingUp className="h-5 w-5" />}
              color="blue"
            />
            <StatCard
              title="Avg Order Value"
              value={formatCurrency(avgOrderValue)}
              subtitle="Per completed sale"
              icon={<ShoppingBag className="h-5 w-5" />}
              color="orange"
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
                    <stop offset="5%" stopColor="#f79e0a" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f79e0a" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} interval={4} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
                  tickFormatter={(v) => `Rs.${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => [formatCurrency(v), 'Revenue']} />
                <Area type="monotone" dataKey="revenue" stroke="#f79e0a" strokeWidth={2}
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
                    <Bar dataKey="qty" fill="#f79e0a" radius={[0, 4, 4, 0]} />
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
              {completedSales.length === 0 ? (
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
                    <Bar dataKey="count" fill="#f79e0a" radius={[3, 3, 0, 0]} name="count" />
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
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-brand-700 text-sm font-bold shrink-0">
                          {u.displayName?.charAt(0)}
                        </div>
                        <span className="text-sm font-medium text-gray-900">{u.displayName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">{u.email}</td>
                    <td className="px-4 py-3">
                      <Badge variant={u.role === 'superadmin' ? 'blue' : u.role === 'admin' ? 'orange' : 'gray'}>
                        {u.role}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={u.isActive ? 'green' : 'red'}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
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
                  {['Sale ID', 'Customer', 'Items', 'Total', 'Payment', 'Cashier', 'Date', 'Status', ''].map((h) => (
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
                      {s.status === 'completed' && (
                        <button
                          onClick={() => setVoidModal(s)}
                          className="text-xs text-red-500 hover:text-red-700 hover:underline"
                        >
                          Void
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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
