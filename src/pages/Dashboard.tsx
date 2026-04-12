import { Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'

/** Redirect users to their role-appropriate default page */
export default function Dashboard() {
  const { appUser } = useAuth()
  if (!appUser) return null
  if (appUser.role === 'superadmin') return <Navigate to="/admin" replace />
  if (appUser.role === 'admin') return <Navigate to="/stock" replace />
  return <Navigate to="/pos" replace />
}
