import { Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { homePath } from '@/lib/roles'
import { PageSpinner } from '@/components/ui/Spinner'

/** Role-based landing: warehouse → cartons, store → shelf. */
export default function HomeRedirect() {
  const { appUser, loading } = useAuth()
  if (loading) return <PageSpinner />
  return <Navigate to={homePath(appUser?.role)} replace />
}
