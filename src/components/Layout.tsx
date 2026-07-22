import { useMemo, useState, useCallback } from 'react'
import { NavLink, useNavigate, useLocation, Outlet } from 'react-router-dom'
import {
  ShoppingCart, LogOut, Menu, X, ChevronDown, User, Settings,
  Boxes, Send, Inbox, BookOpen, PanelLeftClose, PanelLeft, LayoutDashboard,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'
import { roleLabel, canWarehouse, canPOS, isWarehouseOperator, canVendorReceive } from '@/lib/roles'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { UserAvatar } from '@/components/ui/Avatar'
import { WorkflowGuide, HelpButton, useFirstRunGuide } from '@/components/WorkflowGuide'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import type { ReactNode } from 'react'

const COLLAPSE_KEY = 'nepalaya-sidebar-collapsed'

interface NavLinkItem {
  to: string
  label: string
  sub?: string
  icon: ReactNode
  show: boolean
}

export function Layout({ children }: { children?: ReactNode }) {
  const { appUser, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false }
  })
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [signOutConfirm, setSignOutConfirm] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const guide = useFirstRunGuide()

  const role = appUser?.role
  const wh = canWarehouse(role)
  const pos = canPOS(role)
  const vendor = canVendorReceive(role)
  const warehouseOnly = isWarehouseOperator(role)

  const toggleCollapse = useCallback(() => {
    setCollapsed((v) => {
      const next = !v
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }, [])

  const mainNav: NavLinkItem[] = [
    { to: '/overview', label: 'Overview', sub: 'Totals', icon: <LayoutDashboard className="h-5 w-5" />, show: wh || pos },
    { to: '/receive', label: 'Stock in', sub: 'Add stock', icon: <Inbox className="h-5 w-5" />, show: wh || vendor },
    { to: '/send', label: 'Send', sub: 'Scan · move', icon: <Send className="h-5 w-5" />, show: wh },
    { to: '/sell', label: 'Sell', sub: 'POS', icon: <ShoppingCart className="h-5 w-5" />, show: pos },
    { to: '/books', label: 'Books', sub: 'Catalog', icon: <BookOpen className="h-5 w-5" />, show: true },
    { to: '/cartons', label: 'Cartons', sub: 'Nepalaya sheet', icon: <Boxes className="h-5 w-5" />, show: wh },
    { to: '/settings', label: 'Settings', icon: <Settings className="h-5 w-5" />, show: true },
  ].filter((n) => n.show)

  const mobileTabs = warehouseOnly
    ? [
        { to: '/overview', label: 'Home', icon: <LayoutDashboard className="h-5 w-5" /> },
        { to: '/send', label: 'Send', icon: <Send className="h-5 w-5" /> },
        { to: '/cartons', label: 'Cartons', icon: <Boxes className="h-5 w-5" /> },
        { to: '/books', label: 'Books', icon: <BookOpen className="h-5 w-5" /> },
      ]
    : [
        { to: '/overview', label: 'Home', icon: <LayoutDashboard className="h-5 w-5" /> },
        { to: '/sell', label: 'Sell', icon: <ShoppingCart className="h-5 w-5" /> },
        { to: '/receive', label: 'Stock in', icon: <Inbox className="h-5 w-5" /> },
        { to: '/books', label: 'Books', icon: <BookOpen className="h-5 w-5" /> },
      ]

  const openGuide = guide.openGuide
  const closeGuide = guide.close
  const guideIsOpen = guide.open

  useKeyboardShortcuts(useMemo(() => ({
    '?': () => openGuide(),
    '[': () => toggleCollapse(),
    'g h': () => navigate('/overview'),
    'g r': () => navigate('/receive'),
    'g n': () => navigate('/send'),
    'g p': () => navigate('/sell'),
    'g b': () => navigate('/books'),
    'g c': () => navigate('/cartons'),
    escape: () => {
      setSidebarOpen(false)
      setUserMenuOpen(false)
      if (guideIsOpen) closeGuide()
    },
  }), [openGuide, closeGuide, guideIsOpen, toggleCollapse, navigate]))

  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      await signOut()
      navigate('/login')
    } finally {
      setSigningOut(false)
      setSignOutConfirm(false)
    }
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex flex-col bg-white border-r border-accent-100 transition-all duration-200 lg:static lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          collapsed ? 'w-[4.25rem]' : 'w-64',
        )}
      >
        <div className={cn('flex h-14 shrink-0 items-center border-b border-accent-100', collapsed ? 'px-2' : 'gap-2 px-3')}>
          <img src="/logo.jpeg" alt="Nepalaya" className={cn('object-contain shrink-0', collapsed ? 'h-8 w-8' : 'h-9 w-auto max-w-[120px]')} />
          <button type="button" onClick={toggleCollapse} className="hidden lg:inline-flex ml-auto h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100">
            {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
          <button type="button" className="ml-auto lg:hidden p-1 text-gray-400" onClick={() => setSidebarOpen(false)}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className={cn('flex-1 overflow-y-auto py-3', collapsed ? 'px-1.5' : 'px-3')}>
          {!collapsed && (
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-accent-400">
              Stock in · Send · Sell
            </p>
          )}
          {mainNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setSidebarOpen(false)}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-xl px-3 py-3 mb-1 transition',
                  collapsed && 'justify-center px-2',
                  isActive ? 'bg-accent-50 text-accent-800 font-semibold' : 'text-gray-600 hover:bg-gray-100',
                )
              }
            >
              {item.icon}
              {!collapsed && (
                <span className="min-w-0">
                  <span className="block text-base font-semibold leading-tight">{item.label}</span>
                  {item.sub && <span className="block text-[11px] font-normal text-gray-400">{item.sub}</span>}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className={cn('border-t border-gray-200', collapsed ? 'p-1.5' : 'p-3')}>
          {!collapsed && <HelpButton onClick={guide.openGuide} />}
          <div className="relative mt-1">
            <button
              type="button"
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className={cn('flex w-full items-center gap-3 rounded-lg py-2.5 text-sm hover:bg-gray-100', collapsed ? 'justify-center px-2' : 'px-3')}
            >
              <UserAvatar name={appUser?.displayName ?? ''} className="h-8 w-8 shrink-0" />
              {!collapsed && (
                <>
                  <div className="min-w-0 flex-1 text-left">
                    <p className="text-sm font-medium truncate">{appUser?.displayName}</p>
                    <span className="text-xs text-gray-500">{roleLabel(role)}</span>
                  </div>
                  <ChevronDown className="h-4 w-4 text-gray-400" />
                </>
              )}
            </button>
            {userMenuOpen && (
              <div className={cn('absolute bottom-full mb-1 rounded-lg border bg-white shadow-lg py-1 z-40', collapsed ? 'left-full ml-1 w-56' : 'left-0 right-0')}>
                <div className="flex items-center gap-2 px-4 py-2 border-b text-xs text-gray-500">
                  <User className="h-4 w-4" />
                  <span className="truncate">{appUser?.email}</span>
                </div>
                <button type="button" onClick={() => { setUserMenuOpen(false); setSignOutConfirm(true) }} className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50">
                  <LogOut className="h-4 w-4" /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-white px-3 lg:hidden">
          <button type="button" onClick={() => setSidebarOpen(true)} className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-gray-100">
            <Menu className="h-5 w-5" />
          </button>
          <img src="/logo.jpeg" alt="Nepalaya" className="h-7 w-auto object-contain" />
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6 pb-24 lg:pb-6">
          {children ?? <Outlet />}
        </main>

        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-20 bg-white border-t safe-area-pb">
          <div className="grid grid-cols-4">
            {mobileTabs.map((tab) => {
              const active = location.pathname === tab.to || location.pathname.startsWith(tab.to + '/')
              return (
                <button
                  key={tab.to}
                  type="button"
                  onClick={() => navigate(tab.to)}
                  className={cn('flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold', active ? 'text-accent-700' : 'text-gray-400')}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              )
            })}
          </div>
        </nav>
      </div>

      <WorkflowGuide open={guide.open} onClose={guide.close} />
      <Modal open={signOutConfirm} onClose={() => setSignOutConfirm(false)} title="Sign Out" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">Sign out?</p>
          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={() => setSignOutConfirm(false)}>Cancel</Button>
            <Button variant="danger" loading={signingOut} onClick={handleSignOut}>Sign Out</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
