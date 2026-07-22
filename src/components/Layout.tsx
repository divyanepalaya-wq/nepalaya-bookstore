import { useMemo, useState, useCallback } from 'react'
import { NavLink, useNavigate, useLocation, Outlet } from 'react-router-dom'
import {
  ShoppingCart,
  LogOut,
  Menu,
  X,
  ChevronDown,
  User,
  Settings,
  Boxes,
  ArrowRightLeft,
  ScanBarcode,
  Store,
  PanelLeftClose,
  PanelLeft,
  Package,
  PackagePlus,
  Truck,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'
import {
  roleLabel,
  canWarehouse,
  canPOS,
  isFullAdmin,
  isWarehouseOperator,
  isStoreOperator,
} from '@/lib/roles'
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
  icon: ReactNode
  show: boolean
  end?: boolean
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
  const warehouseOnly = isWarehouseOperator(role)
  const storeOnly = isStoreOperator(role)
  const admin = isFullAdmin(role)
  const wh = canWarehouse(role)
  const pos = canPOS(role)

  const toggleCollapse = useCallback(() => {
    setCollapsed((v) => {
      const next = !v
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }, [])

  // Warehouse (Ramesh): Cartons, Add stock, Move, Scan
  const warehouseNav: NavLinkItem[] = [
    { to: '/cartons', label: 'Cartons', icon: <Boxes className="h-5 w-5" />, show: wh },
    { to: '/add-stock', label: 'Add stock', icon: <PackagePlus className="h-5 w-5" />, show: wh },
    { to: '/move', label: 'Move', icon: <ArrowRightLeft className="h-5 w-5" />, show: wh },
    { to: '/warehouse/scan', label: 'Scan', icon: <ScanBarcode className="h-5 w-5" />, show: wh },
  ]

  // Store: Shelf, Backroom, Put on sale, Receive vendor, Sell
  const storeNav: NavLinkItem[] = [
    { to: '/shelf', label: 'Shelf', icon: <Store className="h-5 w-5" />, show: pos },
    { to: '/backroom', label: 'Backroom', icon: <Package className="h-5 w-5" />, show: pos },
    { to: '/put-on-sale', label: 'Put on sale', icon: <Store className="h-5 w-5" />, show: pos },
    { to: '/vendor', label: 'Receive vendor', icon: <Truck className="h-5 w-5" />, show: pos },
    { to: '/pos', label: 'Sell', icon: <ShoppingCart className="h-5 w-5" />, show: pos },
  ]

  const mainNav: NavLinkItem[] = (
    warehouseOnly
      ? warehouseNav
      : storeOnly
        ? storeNav
        : [...storeNav, ...warehouseNav]
  )
    .filter((n) => n.show)
    .concat([{ to: '/settings', label: 'Settings', icon: <Settings className="h-5 w-5" />, show: true }])

  const mobileTabs = warehouseOnly
    ? [
        { to: '/cartons', label: 'Cartons', icon: <Boxes className="h-5 w-5" /> },
        { to: '/add-stock', label: 'Add', icon: <PackagePlus className="h-5 w-5" /> },
        { to: '/move', label: 'Move', icon: <ArrowRightLeft className="h-5 w-5" /> },
        { to: '/warehouse/scan', label: 'Scan', icon: <ScanBarcode className="h-5 w-5" /> },
      ]
    : [
        { to: '/shelf', label: 'Shelf', icon: <Store className="h-5 w-5" /> },
        { to: '/backroom', label: 'Back', icon: <Package className="h-5 w-5" /> },
        { to: '/vendor', label: 'Vendor', icon: <Truck className="h-5 w-5" /> },
        { to: '/pos', label: 'Sell', icon: <ShoppingCart className="h-5 w-5" /> },
      ]

  const openGuide = guide.openGuide
  const closeGuide = guide.close
  const guideIsOpen = guide.open

  const shortcuts = useMemo(() => ({
    '?': () => openGuide(),
    '[': () => toggleCollapse(),
    escape: () => {
      setSidebarOpen(false)
      setUserMenuOpen(false)
      if (guideIsOpen) closeGuide()
    },
    'g h': () => navigate(warehouseOnly ? '/cartons' : '/shelf'),
    'g s': () => navigate('/warehouse/scan'),
    'g m': () => navigate('/move'),
    'g p': () => navigate('/pos'),
  }), [openGuide, closeGuide, guideIsOpen, navigate, toggleCollapse, warehouseOnly])

  useKeyboardShortcuts(shortcuts)

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

  const linkClass = (isActive: boolean) =>
    cn(
      'flex items-center gap-3 rounded-xl px-3 py-3 text-base font-semibold transition-colors mb-0.5',
      collapsed && 'justify-center px-2',
      isActive
        ? 'bg-accent-50 text-accent-700'
        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
    )

  const renderLink = (item: NavLinkItem) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.end}
      title={collapsed ? item.label : undefined}
      onClick={() => setSidebarOpen(false)}
      className={({ isActive }) => linkClass(isActive)}
    >
      {item.icon}
      {!collapsed && item.label}
    </NavLink>
  )

  const logoSrc = '/logo.jpeg'
  const modeLabel = warehouseOnly
    ? 'Warehouse · Nepalaya cartons'
    : storeOnly
      ? 'Store · Shelf & sell'
      : 'Admin · Store + Warehouse'

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
        <div className={cn(
          'flex h-14 shrink-0 items-center border-b border-accent-100',
          collapsed ? 'justify-between px-2 gap-1' : 'gap-2 px-3',
        )}>
          <img
            src={logoSrc}
            alt="Nepalaya"
            className={cn('object-contain shrink-0', collapsed ? 'h-8 w-8' : 'h-9 w-auto max-w-[120px]')}
          />
          <button
            type="button"
            onClick={toggleCollapse}
            className="hidden lg:inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
            title={collapsed ? 'Expand ([)' : 'Collapse ([)'}
          >
            {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
          <button type="button" className="ml-auto lg:hidden p-1 text-gray-400" onClick={() => setSidebarOpen(false)}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className={cn('flex-1 overflow-y-auto py-3', collapsed ? 'px-1.5' : 'px-3')}>
          {!collapsed && (
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-accent-400">
              {modeLabel}
            </p>
          )}
          {mainNav.map(renderLink)}
          {admin && !collapsed && (
            <p className="mt-4 px-3 text-[10px] text-gray-400">
              Books & Data live under Settings
            </p>
          )}
        </nav>

        <div className={cn('border-t border-gray-200 space-y-1', collapsed ? 'p-1.5' : 'p-3')}>
          {!collapsed && (
            <div className="px-1 pb-1">
              <HelpButton onClick={guide.openGuide} />
            </div>
          )}
          <div className="relative">
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg py-2.5 text-sm hover:bg-gray-100',
                collapsed ? 'justify-center px-2' : 'px-3',
              )}
            >
              <UserAvatar name={appUser?.displayName ?? ''} className="h-8 w-8 shrink-0" />
              {!collapsed && (
                <>
                  <div className="min-w-0 flex-1 text-left">
                    <p className="text-sm font-medium text-gray-900 truncate">{appUser?.displayName}</p>
                    <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
                      {roleLabel(role)}
                    </span>
                  </div>
                  <ChevronDown className="h-4 w-4 text-gray-400" />
                </>
              )}
            </button>
            {userMenuOpen && (
              <div className={cn(
                'absolute bottom-full mb-1 rounded-lg border border-gray-200 bg-white shadow-lg py-1 z-40',
                collapsed ? 'left-full ml-1 w-56' : 'left-0 right-0',
              )}>
                <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 mb-1">
                  <User className="h-4 w-4 text-gray-400" />
                  <span className="text-xs text-gray-500 truncate">{appUser?.email}</span>
                </div>
                <button type="button" onClick={guide.openGuide} className="flex w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                  Help & guide
                </button>
                <button
                  onClick={() => { setUserMenuOpen(false); setSignOutConfirm(true) }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-3 lg:hidden">
          <button type="button" onClick={() => setSidebarOpen(true)} className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-gray-100">
            <Menu className="h-5 w-5" />
          </button>
          <img src={logoSrc} alt="Nepalaya" className="h-7 w-auto object-contain" />
          <div className="ml-auto">
            <HelpButton onClick={guide.openGuide} />
          </div>
        </header>

        <div className="hidden lg:flex h-10 shrink-0 items-center justify-between border-b border-gray-100 bg-white px-4">
          <p className="text-xs text-gray-500">{modeLabel}</p>
          <HelpButton onClick={guide.openGuide} />
        </div>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6 pb-24 lg:pb-6">
          {children ?? <Outlet />}
        </main>

        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-20 bg-white border-t border-gray-200 safe-area-pb">
          <div className={cn('grid', mobileTabs.length === 5 ? 'grid-cols-5' : 'grid-cols-4')}>
            {mobileTabs.map((tab) => {
              const active = location.pathname === tab.to || location.pathname.startsWith(tab.to + '/')
              return (
                <button
                  key={tab.to}
                  type="button"
                  onClick={() => navigate(tab.to)}
                  className={cn(
                    'flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold',
                    active ? 'text-accent-700' : 'text-gray-400',
                  )}
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
          <p className="text-sm text-gray-600">Are you sure you want to sign out?</p>
          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={() => setSignOutConfirm(false)} disabled={signingOut}>Cancel</Button>
            <Button variant="danger" loading={signingOut} onClick={handleSignOut}>Sign Out</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
