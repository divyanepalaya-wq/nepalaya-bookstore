import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getAnalytics, isSupported } from 'firebase/analytics'

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

/** Create a user account via Firebase REST API (without signing in as them). */
export async function createUserViaRest(email: string, password: string): Promise<string> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseConfig.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  )
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error?.message ?? 'Failed to create user')
  }
  const data = await res.json()
  return data.localId as string
}
