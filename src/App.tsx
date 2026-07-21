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
import Login from '@/pages/Login'
import OpsDashboard from '@/pages/OpsDashboard'
import Books from '@/pages/Books'
import BookDetail from '@/pages/BookDetail'
import Settings from '@/pages/Settings'
import AccountSettings from '@/pages/AccountSettings'
import Receive from '@/pages/Receive'
import BoxesPage from '@/pages/Boxes'
import Transfers from '@/pages/Transfers'
import Scan from '@/pages/Scan'

const POS = lazy(() => import('@/pages/POS'))
const Discounts = lazy(() => import('@/pages/Discounts'))
const SuperAdmin = lazy(() => import('@/pages/SuperAdmin'))
const Reports = lazy(() => import('@/pages/Reports'))
const Warehouses = lazy(() => import('@/pages/Warehouses'))
const Inventory = lazy(() => import('@/pages/Inventory'))
const StocktakePage = lazy(() => import('@/pages/Stocktake'))
const ShelfLocationsPage = lazy(() => import('@/pages/ShelfLocations'))
const Stock = lazy(() => import('@/pages/Stock'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
})

function Lazy({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageSpinner />}>{children}</Suspense>
}

function App() {
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
                    <Route index element={<OpsDashboard />} />
                    <Route path="books" element={<Books />} />
                    <Route path="books/manage" element={
                      <ProtectedRoute allowedRoles={['superadmin', 'admin']}>
                        <Lazy><Stock /></Lazy>
                      </ProtectedRoute>
                    } />
                    <Route path="books/:id" element={<BookDetail />} />

                    <Route path="pos" element={
                      <ProtectedRoute allowedRoles={['superadmin', 'admin', 'cashier']}>
                        <Lazy><POS /></Lazy>
                      </ProtectedRoute>
                    } />

                    <Route path="reports" element={
                      <ProtectedRoute allowedRoles={['superadmin', 'admin']}>
                        <Lazy><Reports /></Lazy>
                      </ProtectedRoute>
                    } />

                    <Route path="settings" element={<Settings />} />
                    <Route path="settings/account" element={<AccountSettings />} />
                    <Route path="settings/discounts" element={
                      <ProtectedRoute allowedRoles={['superadmin', 'admin']}>
                        <Lazy><Discounts /></Lazy>
                      </ProtectedRoute>
                    } />
                    <Route path="settings/users" element={
                      <ProtectedRoute allowedRoles={['superadmin']}>
                        <Lazy><SuperAdmin /></Lazy>
                      </ProtectedRoute>
                    } />

                    <Route path="warehouse/receive" element={
                      <ProtectedRoute allowedRoles={['superadmin', 'admin']}>
                        <Receive />
                      </ProtectedRoute>
                    } />
                    <Route path="warehouse/transfers" element={
                      <ProtectedRoute allowedRoles={['superadmin', 'admin']}>
                        <Transfers />
                      </ProtectedRoute>
                    } />
                    <Route path="warehouse/cartons" element={
                      <ProtectedRoute allowedRoles={['superadmin', 'admin', 'cashier']}>
                        <BoxesPage />
                      </ProtectedRoute>
                    } />
                    <Route path="warehouse/scan" element={
                      <ProtectedRoute allowedRoles={['superadmin', 'admin', 'cashier']}>
                        <Scan />
                      </ProtectedRoute>
                    } />
                    <Route path="warehouse/count" element={
                      <ProtectedRoute allowedRoles={['superadmin', 'admin']}>
                        <Lazy><StocktakePage /></Lazy>
                      </ProtectedRoute>
                    } />
                    <Route path="warehouse/locations" element={
                      <ProtectedRoute allowedRoles={['superadmin', 'admin']}>
                        <Lazy><ShelfLocationsPage /></Lazy>
                      </ProtectedRoute>
                    } />
                    <Route path="warehouse" element={<Navigate to="/warehouse/receive" replace />} />
                  </Route>

                  <Route path="/stock" element={<Navigate to="/books" replace />} />
                  <Route path="/inventory" element={<Navigate to="/reports" replace />} />
                  <Route path="/boxes" element={<Navigate to="/warehouse/cartons" replace />} />
                  <Route path="/receive" element={<Navigate to="/warehouse/receive" replace />} />
                  <Route path="/transfers" element={<Navigate to="/warehouse/transfers" replace />} />
                  <Route path="/scan" element={<Navigate to="/warehouse/scan" replace />} />
                  <Route path="/stocktake" element={<Navigate to="/warehouse/count" replace />} />
                  <Route path="/shelves" element={<Navigate to="/warehouse/locations" replace />} />
                  <Route path="/warehouses" element={<Navigate to="/warehouse/locations" replace />} />
                  <Route path="/warehouse-dashboard" element={<Navigate to="/" replace />} />
                  <Route path="/discounts" element={<Navigate to="/settings/discounts" replace />} />
                  <Route path="/admin" element={<Navigate to="/reports" replace />} />
                  <Route path="/account" element={<Navigate to="/settings/account" replace />} />

                  <Route
                    path="/settings/warehouses"
                    element={
                      <ProtectedRoute allowedRoles={['superadmin', 'admin']}>
                        <Layout>
                          <Lazy><Warehouses /></Lazy>
                        </Layout>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/settings/inventory"
                    element={
                      <ProtectedRoute allowedRoles={['superadmin', 'admin', 'cashier']}>
                        <Layout>
                          <Lazy><Inventory /></Lazy>
                        </Layout>
                      </ProtectedRoute>
                    }
                  />

                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </WarehouseProvider>
            </BooksProvider>
            <Toaster
              position="top-right"
              toastOptions={{
                duration: 3500,
                style: { borderRadius: '10px', fontSize: '14px' },
                success: { iconTheme: { primary: '#22c55e', secondary: '#fff' } },
                error: { iconTheme: { primary: '#ef4444', secondary: '#fff' } },
              }}
            />
          </AuthProvider>
        </ErrorBoundary>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
