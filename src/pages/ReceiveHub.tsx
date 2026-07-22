import { useNavigate } from 'react-router-dom'
import { PackagePlus, Truck, RotateCcw } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { canWarehouse, canVendorReceive } from '@/lib/roles'
import { cn } from '@/lib/utils'

/** Stock in hub · Nepalaya cartons or vendor → shelf. */
export default function ReceiveHub() {
  const navigate = useNavigate()
  const { appUser } = useAuth()
  const wh = canWarehouse(appUser?.role)
  const vendor = canVendorReceive(appUser?.role)

  const cards = [
    {
      show: wh,
      to: '/receive/warehouse',
      title: 'Nepalaya',
      sub: 'Into warehouse cartons',
      icon: PackagePlus,
      color: 'border-blue-200 bg-blue-50/80 hover:bg-blue-50',
      iconColor: 'text-blue-700',
    },
    {
      show: vendor,
      to: '/receive/vendor',
      title: 'Nepali / English',
      sub: 'Straight to store shelf',
      icon: Truck,
      color: 'border-green-200 bg-green-50/80 hover:bg-green-50',
      iconColor: 'text-green-700',
    },
    {
      show: wh,
      to: '/fix',
      title: 'Undo stock',
      sub: 'Reverse mistaken receive or put on sale',
      icon: RotateCcw,
      color: 'border-amber-200 bg-amber-50/80 hover:bg-amber-50',
      iconColor: 'text-amber-700',
    },
  ].filter((c) => c.show)

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Stock in</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Add books that arrived · use Undo stock if you made a mistake
        </p>
      </div>

      <div className="space-y-3">
        {cards.map((c) => (
          <button
            key={c.to}
            type="button"
            onClick={() => navigate(c.to)}
            className={cn(
              'flex w-full items-center gap-4 rounded-2xl border p-5 text-left transition active:scale-[0.99]',
              c.color,
            )}
          >
            <div className={cn('rounded-xl bg-white p-3 shadow-sm', c.iconColor)}>
              <c.icon className="h-7 w-7" />
            </div>
            <div className="min-w-0">
              <p className="text-lg font-bold text-gray-900">{c.title}</p>
              <p className="text-sm text-gray-600 mt-0.5">{c.sub}</p>
            </div>
          </button>
        ))}
        {cards.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-8">No stock-in actions for your role</p>
        )}
      </div>
    </div>
  )
}
