import { Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { PageSpinner } from '@/components/ui/Spinner'
import type { UserRole } from '@/types'

interface ProtectedRouteProps {
  children: React.ReactNode
  allowedRoles?: UserRole[]
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, appUser, loading } = useAuth()

  if (loading) return <PageSpinner />
  if (!user || !appUser) return <Navigate to="/login" replace />

  if (allowedRoles && !allowedRoles.includes(appUser.role)) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
