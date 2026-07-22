import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { mapBook } from '@/lib/mappers'
import { fetchAllPages } from '@/lib/fetchAll'
import { debounce } from '@/lib/debounce'
import type { Book } from '@/types'

const BOOK_COLS =
  'id,name,author,isbn,language,category,publisher,mrp,cost_price,in_stock,min_stock_alert,description,cover_url,isbn_locked,metadata_source,created_at,updated_at,created_by,is_deleted'

interface BooksContextValue {
  books: Book[]
  loading: boolean
  refreshBooks: () => Promise<void>
  /** Instant UI update after ISBN/cover save (no hard refresh). */
  patchBook: (id: string, patch: Partial<Book>) => void
}

const BooksContext = createContext<BooksContextValue>({
  books: [],
  loading: true,
  refreshBooks: async () => {},
  patchBook: () => {},
})

export function BooksProvider({ children }: { children: ReactNode }) {
  const [books, setBooks] = useState<Book[]>([])
  const [loading, setLoading] = useState(true)
  const genRef = useRef(0)

  const load = useCallback(async () => {
    const gen = ++genRef.current
    try {
      const rows = await fetchAllPages<Record<string, unknown>>(async (from, to) => {
        const res = await supabase
          .from('books')
          .select(BOOK_COLS)
          .eq('is_deleted', false)
          .order('name')
          .range(from, to)
        return { data: res.data as Record<string, unknown>[] | null, error: res.error }
      })
      if (gen !== genRef.current) return
      setBooks(rows.map((r) => mapBook(r)))
    } catch (e) {
      if (gen === genRef.current) console.warn('books load failed', e)
    } finally {
      if (gen === genRef.current) setLoading(false)
    }
  }, [])

  const patchBook = useCallback((id: string, patch: Partial<Book>) => {
    setBooks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)))
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await load()
      if (cancelled) return
    })()

    const scheduleReload = debounce(() => {
      void load()
    }, 400)

    const channel = supabase
      .channel('books-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'books' },
        (payload) => {
          // Fast path: patch a single UPDATE into memory
          if (payload.eventType === 'UPDATE' && payload.new && typeof payload.new === 'object') {
            const row = payload.new as Record<string, unknown>
            if (row.is_deleted) {
              setBooks((prev) => prev.filter((b) => b.id !== row.id))
              return
            }
            const mapped = mapBook(row)
            setBooks((prev) => {
              const i = prev.findIndex((b) => b.id === mapped.id)
              if (i < 0) return [...prev, mapped].sort((a, b) => a.name.localeCompare(b.name))
              const next = prev.slice()
              next[i] = mapped
              return next
            })
            return
          }
          if (payload.eventType === 'DELETE' && payload.old && typeof payload.old === 'object') {
            const id = (payload.old as { id?: string }).id
            if (id) setBooks((prev) => prev.filter((b) => b.id !== id))
            return
          }
          // INSERT / soft-delete / unknown → debounced full reload
          scheduleReload()
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      scheduleReload.cancel()
      void supabase.removeChannel(channel)
    }
  }, [load])

  return (
    <BooksContext.Provider value={{ books, loading, refreshBooks: load, patchBook }}>
      {children}
    </BooksContext.Provider>
  )
}

export const useBooks = () => useContext(BooksContext)
