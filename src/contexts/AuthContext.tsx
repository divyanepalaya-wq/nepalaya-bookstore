import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type User as FirebaseUser,
} from 'firebase/auth'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '@/lib/firebase'
import type { AppUser } from '@/types'
import { writeAuditLog } from '@/lib/auditLog'

interface AuthContextValue {
  user: FirebaseUser | null
  appUser: AppUser | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | null>(null)
  const [appUser, setAppUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser)
      if (firebaseUser) {
        const snap = await getDoc(doc(db, 'users', firebaseUser.uid))
        if (snap.exists()) {
          setAppUser({ uid: firebaseUser.uid, ...snap.data() } as AppUser)
        } else {
          setAppUser(null)
        }
      } else {
        setAppUser(null)
      }
      setLoading(false)
    })
    return unsub
  }, [])

  const signIn = async (email: string, password: string) => {
    const cred = await signInWithEmailAndPassword(auth, email, password)
    const snap = await getDoc(doc(db, 'users', cred.user.uid))
    if (!snap.exists()) throw new Error('User profile not found. Contact your administrator.')
    const profile = { uid: cred.user.uid, ...snap.data() } as AppUser
    if (!profile.isActive) throw new Error('Your account has been deactivated. Contact your administrator.')
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
    await firebaseSignOut(auth)
    setAppUser(null)
  }

  // Dev-only one-time setup helper — stripped in production builds
  useEffect(() => {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__setupSuperAdmin = async (uid: string, email: string, name: string) => {
        await setDoc(doc(db, 'users', uid), {
          email,
          displayName: name,
          role: 'superadmin',
          isActive: true,
          createdAt: serverTimestamp(),
        })
        console.info('[Dev] Superadmin profile created for', uid)
      }
    }
  }, [])

  return (
    <AuthContext.Provider value={{ user, appUser, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
