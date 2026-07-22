import { Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/contexts/AuthContext'
import { BooksProvider } from '@/contexts/BooksContext'
import { WarehouseProvider } from '@/contexts/WarehouseContext'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Layout } from '@/components/Layout'
import { PageSpinner } from '@/components/ui/Spinner'
import { isSupabaseConfigured } from '@/lib/supabase'
import Login from '@/pages/Login'
import HomeRedirect from '@/pages/HomeRedirect'
import Settings from '@/pages/Settings'
import AccountSettings from '@/pages/AccountSettings'

const Overview = lazy(() => import('@/pages/Overview'))
const ReceiveHub = lazy(() => import('@/pages/ReceiveHub'))
const AddStock = lazy(() => import('@/pages/AddStock'))
const VendorReceive = lazy(() => import('@/pages/VendorReceive'))
const SendPage = lazy(() => import('@/pages/SendPage'))
const CartonSheet = lazy(() => import('@/pages/CartonSheet'))
const Books = lazy(() => import('@/pages/Books'))
const BookDetail = lazy(() => import('@/pages/BookDetail'))
const FixStock = lazy(() => import('@/pages/FixStock'))
const Vendors = lazy(() => import('@/pages/Vendors'))
const POS = lazy(() => import('@/pages/POS'))
const Discounts = lazy(() => import('@/pages/Discounts'))
const SuperAdmin = lazy(() => import('@/pages/SuperAdmin'))
const Warehouses = lazy(() => import('@/pages/Warehouses'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 10 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
  },
})

function Lazy({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageSpinner />}>{children}</Suspense>
}

function MissingConfig() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="max-w-lg w-full space-y-3 text-center">
        <h1 className="text-xl font-semibold text-slate-900">Supabase is not configured</h1>
        <p className="text-sm text-slate-600">
          Set <code className="text-xs bg-slate-100 px-1 rounded">VITE_SUPABASE_URL</code> and{' '}
          <code className="text-xs bg-slate-100 px-1 rounded">VITE_SUPABASE_PUBLISHABLE_KEY</code>.
        </p>
      </div>
    </div>
  )
}

function App() {
  if (!isSupabaseConfigured) return <MissingConfig />

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ErrorBoundary>
          <AuthProvider>
            <BooksProvider>
              <WarehouseProvider>
                <Routes>
                  <Route path="/login" element={<Login />} />
                  <Route
                    element={
                      <ProtectedRoute>
                        <Layout />
                      </ProtectedRoute>
                    }
                  >
                    <Route index element={<HomeRedirect />} />
                    <Route path="overview" element={<Lazy><Overview /></Lazy>} />

                    <Route path="receive" element={<Lazy><ReceiveHub /></Lazy>} />
                    <Route path="receive/warehouse" element={
                      <ProtectedRoute allowedRoles={['superadmin', 'admin', 'warehouse']}>
                        <Lazy><AddStock /></Lazy>
                      </ProtectedRoute>
                    } />
                    <Route path="receive/vendor" element={
                      <ProtectedRoute allowedRoles={['superadmin', 'admin', 'warehouse', 'receptionist']}>
                        <Lazy><VendorReceive /></Lazy>
                      </ProtectedRoute>
                    } />

                    <Route path="send" element={
                      <ProtectedRoute allowedRoles={['superadmin', 'admin', 'warehouse']}>
                        <Lazy><SendPage /></Lazy>
                      </ProtectedRoute>
                    } />

                    <Route path="sell" element={
                      <ProtectedRoute allowedRoles={['superadmin', 'admin', 'warehouse', 'cashier', 'receptionist']}>
                        <Lazy><POS /></Lazy>
                      </ProtectedRoute>
                    } />
                    <Route path="pos" element={<Navigate to="/sell" replace />} />

                    <Route path="books" element={<Lazy><Books /></Lazy>} />
                    <Route path="books/:id" element={<Lazy><BookDetail /></Lazy>} />

                    <Route path="cartons" element={
                      <ProtectedRoute allowedRoles={['superadmin', 'admin', 'warehouse']}>
                        <Lazy><CartonSheet /></Lazy>
                      </ProtectedRoute>
                    } />

                    <Route path="fix" element={
                      <ProtectedRoute allowedRoles={['superadmin', 'admin', 'warehouse']}>
                        <Lazy><FixStock /></Lazy>
                      </ProtectedRoute>
                    } />

                    <Route path="settings" element={<Settings />} />
                    <Route path="settings/account" element={<AccountSettings />} />
                    <Route path="settings/vendors" element={
                      <ProtectedRoute allowedRoles={['superadmin', 'admin', 'warehouse', 'receptionist']}>
                        <Lazy><Vendors /></Lazy>
                      </ProtectedRoute>
                    } />
                    <Route path="settings/discounts" element={
                      <ProtectedRoute allowedRoles={['superadmin', 'admin', 'warehouse']}>
                        <Lazy><Discounts /></Lazy>
                      </ProtectedRoute>
                    } />
                    <Route path="settings/users" element={
                      <ProtectedRoute allowedRoles={['superadmin']}>
                        <Lazy><SuperAdmin /></Lazy>
                      </ProtectedRoute>
                    } />
                    <Route path="settings/warehouses" element={
                      <ProtectedRoute allowedRoles={['superadmin', 'admin', 'warehouse']}>
                        <Lazy><Warehouses /></Lazy>
                      </ProtectedRoute>
                    } />
                    {/* Old URLs → new */}
                    <Route path="move" element={<Navigate to="/send" replace />} />
                    <Route path="scan" element={<Navigate to="/send" replace />} />
                    <Route path="put-on-sale" element={<Navigate to="/send" replace />} />
                    <Route path="vendor" element={<Navigate to="/receive/vendor" replace />} />
                    <Route path="add-stock" element={<Navigate to="/receive/warehouse" replace />} />
                    <Route path="shelf" element={<Navigate to="/books" replace />} />
                    <Route path="backroom" element={<Navigate to="/send" replace />} />
                    <Route path="stock" element={<Navigate to="/books" replace />} />
                    <Route path="warehouse/*" element={<Navigate to="/cartons" replace />} />
                    <Route path="import" element={<Navigate to="/receive/warehouse" replace />} />
                    <Route path="data" element={<Navigate to="/books" replace />} />
                    <Route path="reports" element={<Navigate to="/settings" replace />} />
                    <Route path="books/manage" element={<Navigate to="/books" replace />} />
                    <Route path="ops" element={<Navigate to="/receive" replace />} />
                    <Route path="dashboard" element={<Navigate to="/" replace />} />
                  </Route>

                  <Route path="/account" element={<Navigate to="/settings/account" replace />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </WarehouseProvider>
            </BooksProvider>
            <Toaster
              position="top-right"
              toastOptions={{
                duration: 3500,
                style: { borderRadius: '10px', fontSize: '14px' },
              }}
            />
          </AuthProvider>
        </ErrorBoundary>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
