// Supabase Edge Function: staff-admin (create / reset password / change role)
// Deploy: supabase functions deploy create-staff-user
// (kept folder name create-staff-user for existing deploy path)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type Role = 'superadmin' | 'admin' | 'cashier'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing auth' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) return json({ error: 'Unauthorized' }, 401)

    const admin = createClient(supabaseUrl, serviceKey)
    const { data: profile } = await admin
      .from('profiles')
      .select('role, is_active, display_name')
      .eq('id', user.id)
      .single()

    if (!profile || profile.role !== 'superadmin' || !profile.is_active) {
      return json({ error: 'Admin only' }, 403)
    }

    const body = await req.json()
    const action = String(body.action ?? 'create')

    const audit = async (actionName: string, entityId: string, details: string) => {
      await admin.from('audit_logs').insert({
        action: actionName,
        entity: 'user',
        entity_id: entityId,
        details,
        performed_by: user.id,
        performed_by_name: profile.display_name ?? user.email,
        role: 'superadmin',
      })
    }

    // ── create (default, backward compatible) ───────────────────────────────
    if (action === 'create') {
      const email = String(body.email ?? '').trim()
      const password = String(body.password ?? '')
      const displayName = String(body.displayName ?? '').trim() || email.split('@')[0]
      const role: Role =
        body.role === 'admin' || body.role === 'superadmin' || body.role === 'cashier'
          ? body.role
          : 'cashier'

      if (!email || password.length < 6) {
        return json({ error: 'Invalid email/password' }, 400)
      }

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName, role },
      })
      if (createErr || !created.user) {
        return json({ error: createErr?.message ?? 'Create failed' }, 400)
      }

      await admin.from('profiles').upsert({
        id: created.user.id,
        email,
        display_name: displayName,
        role,
        is_active: true,
        created_by: user.id,
      })

      await audit('user_created', created.user.id, `Created ${email} as ${role}`)
      return json({ uid: created.user.id })
    }

    // ── resetPassword ───────────────────────────────────────────────────────
    if (action === 'resetPassword') {
      const userId = String(body.userId ?? '')
      const newPassword = String(body.password ?? '')
      if (!userId || newPassword.length < 8) {
        return json({ error: 'User id and password (min 8) required' }, 400)
      }
      if (userId === user.id) {
        return json({ error: 'Use Account settings to change your own password' }, 400)
      }

      const { error } = await admin.auth.admin.updateUserById(userId, {
        password: newPassword,
      })
      if (error) return json({ error: error.message }, 400)

      await audit('password_reset', userId, 'Admin reset staff password')
      return json({ ok: true })
    }

    // ── changeRole ──────────────────────────────────────────────────────────
    if (action === 'changeRole') {
      const userId = String(body.userId ?? '')
      const role: Role | '' =
        body.role === 'admin' || body.role === 'superadmin' || body.role === 'cashier'
          ? body.role
          : ''
      if (!userId || !role) return json({ error: 'userId and role required' }, 400)
      if (userId === user.id) return json({ error: 'Cannot change your own role here' }, 400)

      const { error } = await admin
        .from('profiles')
        .update({ role })
        .eq('id', userId)
      if (error) return json({ error: error.message }, 400)

      await admin.auth.admin.updateUserById(userId, {
        user_metadata: { role },
      })

      await audit('role_changed', userId, `Role set to ${role}`)
      return json({ ok: true })
    }

    // ── sendResetEmail ──────────────────────────────────────────────────────
    if (action === 'sendResetEmail') {
      const email = String(body.email ?? '').trim()
      if (!email) return json({ error: 'Email required' }, 400)
      const { error } = await admin.auth.resetPasswordForEmail(email)
      if (error) return json({ error: error.message }, 400)
      await audit('password_reset_email', email, `Reset email sent to ${email}`)
      return json({ ok: true })
    }

    return json({ error: `Unknown action: ${action}` }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Error' }, 500)
  }
})
