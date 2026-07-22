import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { mapBook } from '@/lib/mappers'
import { fetchAllPages } from '@/lib/fetchAll'
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
      try {
        const rows = await fetchAllPages<Record<string, unknown>>(async (from, to) => {
          const res = await supabase
            .from('books')
            .select('*')
            .eq('is_deleted', false)
            .order('name')
            .range(from, to)
          return { data: res.data as Record<string, unknown>[] | null, error: res.error }
        })
        if (cancelled) return
        setBooks(rows.map((r) => mapBook(r)))
      } catch (e) {
        console.warn('books load failed', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
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
