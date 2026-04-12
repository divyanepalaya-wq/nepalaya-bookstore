import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Book } from '@/types'

interface BooksContextValue {
  books: Book[]
  loading: boolean
}

const BooksContext = createContext<BooksContextValue>({ books: [], loading: true })

/**
 * Single Firestore listener for the books collection, shared across
 * Stock, POS, and SuperAdmin — prevents 3 concurrent identical listeners.
 * Soft-deleted books are filtered out at the source.
 */
export function BooksProvider({ children }: { children: ReactNode }) {
  const [books, setBooks] = useState<Book[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'books'), orderBy('name')),
      (snap) => {
        setBooks(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as Book)
            .filter((b) => !b.isDeleted)
        )
        setLoading(false)
      },
      () => setLoading(false)
    )
    return unsub
  }, [])

  return <BooksContext.Provider value={{ books, loading }}>{children}</BooksContext.Provider>
}

export const useBooks = () => useContext(BooksContext)
