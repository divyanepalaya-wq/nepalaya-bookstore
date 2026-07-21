import { Link } from 'react-router-dom'
import {
  User, Percent, Users, Warehouse, MapPin, ChevronRight, Package,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { roleLabel, isFullAdmin, canWarehouse } from '@/lib/roles'

const links = [
  {
    to: '/settings/account',
    label: 'Account',
    desc: 'Password and profile',
    icon: User,
    show: () => true,
  },
  {
    to: '/settings/discounts',
    label: 'Discounts',
    desc: 'Store discount rules',
    icon: Percent,
    show: (role?: string) => role === 'admin' || role === 'superadmin',
  },
  {
    to: '/settings/users',
    label: 'Staff accounts',
    desc: 'Add staff, reset passwords, change roles',
    icon: Users,
    show: (role?: string) => role === 'superadmin',
  },
  {
    to: '/settings/warehouses',
    label: 'Locations setup',
    desc: 'Main Warehouse, Backroom, Bookstore Floor',
    icon: Warehouse,
    show: (role?: string) => role === 'admin' || role === 'superadmin',
  },
  {
    to: '/warehouse/locations',
    label: 'Shelf locations',
    desc: 'Bins and shelf codes',
    icon: MapPin,
    show: (role?: string) => role === 'admin' || role === 'superadmin',
  },
  {
    to: '/settings/inventory',
    label: 'Stock by place (legacy)',
    desc: 'Inventory matrix view',
    icon: Package,
    show: (role?: string) => role === 'admin' || role === 'superadmin',
  },
]

export default function Settings() {
  const { appUser } = useAuth()
  const role = appUser?.role

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Signed in as {appUser?.displayName} · {roleLabel(role)}
          {isFullAdmin(role) ? ' (full access)' : canWarehouse(role) ? ' (ops)' : ''}
        </p>
      </div>

      <ul className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
        {links.filter((l) => l.show(role)).map((l) => (
          <li key={l.to}>
            <Link
              to={l.to}
              className="flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50"
            >
              <l.icon className="h-5 w-5 text-accent-600 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900">{l.label}</p>
                <p className="text-xs text-gray-500">{l.desc}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-gray-400" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
