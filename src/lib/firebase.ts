import { initializeApp, deleteApp } from 'firebase/app'
import { getAuth, createUserWithEmailAndPassword, signOut as authSignOut } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getAnalytics, isSupported } from 'firebase/analytics'
import { getFirebaseErrorMessage } from '@/lib/firebaseErrors'

const firebaseConfig = {
  apiKey: 'AIzaSyBocT6eiXUavRBvuV3uWgfRSbB9S6XTSvo',
  authDomain: 'nepalaya-bookstore.firebaseapp.com',
  projectId: 'nepalaya-bookstore',
  storageBucket: 'nepalaya-bookstore.firebasestorage.app',
  messagingSenderId: '220232358135',
  appId: '1:220232358135:web:64c6c0b1269af5bbb81bf2',
  measurementId: 'G-PV3F038EH1',
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)

// Analytics only where supported (not in SSR / certain browsers)
isSupported().then((supported) => {
  if (supported) getAnalytics(app)
})

/**
 * Create a user account without affecting the current admin session.
 * Uses a secondary Firebase app instance so the new user is never signed
 * into the primary auth context.
 *
 * IMPORTANT: Firebase Authentication must allow email/password sign-up.
 * If you see ADMIN_ONLY_OPERATION, go to:
 *   Firebase Console → Authentication → Settings → User actions
 *   and make sure "Disable create (sign-up)" is NOT checked.
 */
export async function createUserViaRest(email: string, password: string): Promise<string> {
  const tempApp = initializeApp(firebaseConfig, `user-create-${Date.now()}`)
  const tempAuth = getAuth(tempApp)
  try {
    const cred = await createUserWithEmailAndPassword(tempAuth, email, password)
    return cred.user.uid
  } catch (e) {
    throw new Error(getFirebaseErrorMessage(e))
  } finally {
    await authSignOut(tempAuth).catch(() => {/* ignore */})
    await deleteApp(tempApp).catch(() => {/* ignore */})
  }
}
