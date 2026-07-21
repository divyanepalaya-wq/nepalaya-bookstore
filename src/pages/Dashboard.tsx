import { Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useWarehouse } from '@/contexts/WarehouseContext'

export default function Dashboard() {
  const { appUser } = useAuth()
  const { mode } = useWarehouse()
  if (!appUser) return null
  if (appUser.role === 'superadmin') return <Navigate to="/admin" replace />
  if (mode === 'full_warehouse' || mode === 'small_warehouse') return <Navigate to="/warehouse-dashboard" replace />
  if (appUser.role === 'admin') return <Navigate to="/stock" replace />
  return <Navigate to="/pos" replace />
}
