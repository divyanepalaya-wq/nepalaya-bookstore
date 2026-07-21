/**
 * Staff admin actions via Edge Function (service role on server).
 */
import { supabase } from '@/lib/supabase'

async function invokeStaffAdmin(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) throw new Error('Not signed in')

  const { data, error } = await supabase.functions.invoke('create-staff-user', { body })

  if (error) {
    throw new Error(
      error.message ||
        'Staff admin request failed. Deploy the create-staff-user Edge Function.',
    )
  }
  if (data?.error) throw new Error(String(data.error))
  return (data ?? {}) as Record<string, unknown>
}

export async function createStaffUser(params: {
  email: string
  password: string
  displayName: string
  role: 'superadmin' | 'admin' | 'cashier'
}): Promise<string> {
  const data = await invokeStaffAdmin({ action: 'create', ...params })
  if (!data.uid) throw new Error('User create returned no uid')
  return data.uid as string
}

export async function resetStaffPassword(params: {
  userId: string
  password: string
}): Promise<void> {
  await invokeStaffAdmin({ action: 'resetPassword', ...params })
}

export async function changeStaffRole(params: {
  userId: string
  role: 'superadmin' | 'admin' | 'cashier'
}): Promise<void> {
  await invokeStaffAdmin({ action: 'changeRole', ...params })
}

export async function sendStaffResetEmail(params: { email: string }): Promise<void> {
  await invokeStaffAdmin({ action: 'sendResetEmail', ...params })
}
