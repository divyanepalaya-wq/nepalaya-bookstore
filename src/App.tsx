import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider } from '@/contexts/AuthContext'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { Layout } from '@/components/Layout'
import Login from '@/pages/Login'
import Dashboard from '@/pages/Dashboard'
import Stock from '@/pages/Stock'
import POS from '@/pages/POS'
import Discounts from '@/pages/Discounts'
import SuperAdmin from '@/pages/SuperAdmin'
import AccountSettings from '@/pages/AccountSettings'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout>
                  <Dashboard />
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/stock"
            element={
              <ProtectedRoute allowedRoles={['superadmin', 'admin']}>
                <Layout>
                  <Stock />
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/pos"
            element={
              <ProtectedRoute allowedRoles={['superadmin', 'admin', 'cashier']}>
                <Layout>
                  <POS />
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/discounts"
            element={
              <ProtectedRoute allowedRoles={['superadmin', 'admin']}>
                <Layout>
                  <Discounts />
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin"
            element={
              <ProtectedRoute allowedRoles={['superadmin']}>
                <Layout>
                  <SuperAdmin />
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/account"
            element={
              <ProtectedRoute>
                <Layout>
                  <AccountSettings />
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>

        <Toaster
          position="top-right"
          toastOptions={{
            duration: 3500,
            style: { borderRadius: '10px', fontSize: '14px' },
            success: { iconTheme: { primary: '#22c55e', secondary: '#fff' } },
            error:   { iconTheme: { primary: '#ef4444', secondary: '#fff' } },
          }}
        />
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
