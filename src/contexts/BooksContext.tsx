import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { mapBook } from '@/lib/mappers'
import type { Book } from '@/types'

interface BooksContextValue {
  books: Book[]
  loading: boolean
}

const BooksContext = createContext<BooksContextValue>({ books: [], loading: true })

export function BooksProvider({ children }: { children: ReactNode }) {
  const [books, setBooks] = useState<Book[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data, error } = await supabase
        .from('books')
        .select('*')
        .eq('is_deleted', false)
        .order('name')
      if (cancelled) return
      if (error) {
        console.warn('books load failed', error)
        setLoading(false)
        return
      }
      setBooks((data ?? []).map((r) => mapBook(r as Record<string, unknown>)))
      setLoading(false)
    }

    void load()

    const channel = supabase
      .channel('books-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'books' }, () => {
        void load()
      })
      .subscribe()

    return () => {
      cancelled = true
      void supabase.removeChannel(channel)
    }
  }, [])

  return <BooksContext.Provider value={{ books, loading }}>{children}</BooksContext.Provider>
}

export const useBooks = () => useContext(BooksContext)
