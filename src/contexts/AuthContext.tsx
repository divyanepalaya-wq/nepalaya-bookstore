import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { User as SupabaseUser, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { mapProfile } from '@/lib/mappers'
import { writeAuditLog } from '@/lib/auditLog'
import type { AppUser } from '@/types'

interface AuthContextValue {
  user: SupabaseUser | null
  session: Session | null
  appUser: AppUser | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function loadProfile(uid: string): Promise<AppUser | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', uid)
    .maybeSingle()
  if (error || !data) return null
  return mapProfile(data as Parameters<typeof mapProfile>[0])
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SupabaseUser | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [appUser, setAppUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    const applySession = async (nextSession: Session | null) => {
      if (!mounted) return
      setSession(nextSession)
      setUser(nextSession?.user ?? null)
      if (!nextSession?.user) {
        setAppUser(null)
        return
      }
      const profile = await loadProfile(nextSession.user.id)
      if (!profile || profile.isActive !== true) {
        await supabase.auth.signOut()
        if (!mounted) return
        setSession(null)
        setUser(null)
        setAppUser(null)
        return
      }
      setAppUser(profile)
    }

    supabase.auth.getSession().then(async ({ data }) => {
      await applySession(data.session)
      if (mounted) setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      await applySession(nextSession)
      if (mounted) setLoading(false)
    })

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error(error.message)
    if (!data.user) throw new Error('Sign in failed')

    const profile = await loadProfile(data.user.id)
    if (!profile) throw new Error('User profile not found. Contact your administrator.')
    if (profile.isActive !== true) {
      await supabase.auth.signOut()
      throw new Error('Your account has been deactivated. Contact your administrator.')
    }
    setAppUser(profile)
    await writeAuditLog({
      action: 'login',
      entity: 'session',
      details: `${profile.displayName} signed in`,
      performedBy: profile.uid,
      performedByName: profile.displayName,
      role: profile.role,
    })
  }

  const signOut = async () => {
    if (appUser) {
      await writeAuditLog({
        action: 'logout',
        entity: 'session',
        details: `${appUser.displayName} signed out`,
        performedBy: appUser.uid,
        performedByName: appUser.displayName,
        role: appUser.role,
      })
    }
    await supabase.auth.signOut()
    setAppUser(null)
    setUser(null)
    setSession(null)
  }

  // Dev helper: promote current user to superadmin (SQL usually preferred)
  useEffect(() => {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__setupSuperAdmin = async (displayName?: string) => {
        const { data: { user: u } } = await supabase.auth.getUser()
        if (!u) throw new Error('Sign in first')
        const { error } = await supabase.from('profiles').upsert({
          id: u.id,
          email: u.email ?? '',
          display_name: displayName ?? u.email?.split('@')[0] ?? 'Admin',
          role: 'superadmin',
          is_active: true,
        })
        if (error) throw error
        console.info('[Dev] Superadmin profile upserted for', u.id)
      }
    }
  }, [])

  return (
    <AuthContext.Provider value={{ user, session, appUser, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
