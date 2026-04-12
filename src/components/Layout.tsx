import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  Package,
  ShoppingCart,
  Tag,
  BarChart2,
  LogOut,
  Menu,
  X,
  ChevronDown,
  User,
  Settings,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import type { ReactNode } from 'react'

interface NavItem {
  to: string
  label: string
  icon: ReactNode
  roles: string[]
}

const navItems: NavItem[] = [
  { to: '/stock',    label: 'Stock',    icon: <Package className="h-5 w-5" />,      roles: ['superadmin', 'admin'] },
  { to: '/pos',      label: 'POS',      icon: <ShoppingCart className="h-5 w-5" />, roles: ['superadmin', 'admin', 'cashier'] },
  { to: '/discounts',label: 'Discounts',icon: <Tag className="h-5 w-5" />,          roles: ['superadmin', 'admin'] },
  { to: '/admin',    label: 'Analytics',icon: <BarChart2 className="h-5 w-5" />,    roles: ['superadmin'] },
  { to: '/account',  label: 'Account',  icon: <Settings className="h-5 w-5" />,     roles: ['superadmin', 'admin', 'cashier'] },
]

export function Layout({ children }: { children: ReactNode }) {
  const { appUser, signOut } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [signOutConfirm, setSignOutConfirm] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const allowedNav = navItems.filter((n) => appUser && n.roles.includes(appUser.role))

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

  const roleBadge = appUser?.role === 'superadmin'
    ? 'bg-purple-100 text-purple-700'
    : appUser?.role === 'admin'
    ? 'bg-blue-100 text-blue-700'
    : 'bg-gray-100 text-gray-600'

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex w-64 flex-col bg-white border-r border-gray-200 transition-transform lg:static lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 px-4 border-b border-gray-200">
          <img src="/logo.svg" alt="Nepalaya Publication" className="h-14 w-auto object-contain" />
          {/* <p className="text-xs font-semibold text-gray-500 truncate">Book Central</p> */}
          <button
            className="ml-auto lg:hidden text-gray-400 hover:text-gray-600"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-3">
          <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Menu
          </p>
          {allowedNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors mb-0.5',
                  isActive
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                )
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* User */}
        <div className="border-t border-gray-200 p-3">
          <div className="relative">
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-gray-100 transition-colors"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-brand-700 font-semibold text-sm shrink-0">
                {appUser?.displayName?.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1 text-left">
                <p className="text-sm font-medium text-gray-900 truncate">{appUser?.displayName}</p>
                <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded-full', roleBadge)}>
                  {appUser?.role}
                </span>
              </div>
              <ChevronDown className="h-4 w-4 text-gray-400" />
            </button>

            {userMenuOpen && (
              <div className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border border-gray-200 bg-white shadow-lg py-1">
                <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 mb-1">
                  <User className="h-4 w-4 text-gray-400" />
                  <span className="text-xs text-gray-500 truncate">{appUser?.email}</span>
                </div>
                <button
                  onClick={() => { setUserMenuOpen(false); setSignOutConfirm(true) }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Topbar (mobile) */}
        <header className="flex h-16 items-center gap-3 border-b border-gray-200 bg-white px-4 lg:hidden">
          <button onClick={() => setSidebarOpen(true)} className="text-gray-500 hover:text-gray-700">
            <Menu className="h-6 w-6" />
          </button>
          <div className="flex items-center gap-2">
            <img src="/logo.svg" alt="Nepalaya" className="h-14 w-auto object-contain" />
            {/* <span className="text-xs font-semibold text-gray-500">Book Central</span> */}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>

      {/* Sign-out confirmation modal */}
      <Modal
        open={signOutConfirm}
        onClose={() => setSignOutConfirm(false)}
        title="Sign Out"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">Are you sure you want to sign out?</p>
          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={() => setSignOutConfirm(false)} disabled={signingOut}>
              Cancel
            </Button>
            <Button variant="danger" loading={signingOut} onClick={handleSignOut}>
              Sign Out
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
