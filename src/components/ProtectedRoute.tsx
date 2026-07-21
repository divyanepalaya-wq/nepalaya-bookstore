import { useEffect, useRef } from 'react'
import { Navigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '@/contexts/AuthContext'
import { PageSpinner } from '@/components/ui/Spinner'
import type { UserRole } from '@/types'

interface ProtectedRouteProps {
  children: React.ReactNode
  allowedRoles?: UserRole[]
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, appUser, loading } = useAuth()
  const deniedToast = useRef(false)

  const denied = Boolean(
    user && appUser && allowedRoles && !allowedRoles.includes(appUser.role),
  )

  useEffect(() => {
    if (denied && !deniedToast.current) {
      deniedToast.current = true
      toast.error('You don’t have access to that page.')
    }
    if (!denied) deniedToast.current = false
  }, [denied])

  if (loading) return <PageSpinner />
  if (!user || !appUser) return <Navigate to="/login" replace />

  if (denied) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
