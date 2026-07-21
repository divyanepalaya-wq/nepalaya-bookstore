import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Search, Lock, Unlock, ExternalLink, Check } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  searchBookMetadata,
  lookupByIsbn,
  preferredIsbn,
  type BookLookupCandidate,
} from '@/lib/bookLookup'
import type { Book } from '@/types'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/utils'

interface Props {
  open: boolean
  book: Book
  onClose: () => void
  onSaved?: (patch: Partial<Book>) => void
}

type FieldKey = 'isbn' | 'author' | 'publisher' | 'description' | 'coverUrl' | 'name'

const FIELD_LABELS: Record<FieldKey, string> = {
  isbn: 'ISBN',
  author: 'Author',
  publisher: 'Publisher',
  description: 'Description',
  coverUrl: 'Cover photo',
  name: 'Title (from match)',
}

export function BookEnrichModal({ open, book, onClose, onSaved }: Props) {
  const [query, setQuery] = useState(book.name)
  const [isbnQuery, setIsbnQuery] = useState(book.isbn ?? '')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [candidates, setCandidates] = useState<BookLookupCandidate[]>([])
  const [selected, setSelected] = useState<BookLookupCandidate | null>(null)
  const [accept, setAccept] = useState<Record<FieldKey, boolean>>({
    isbn: true,
    author: true,
    publisher: true,
    description: true,
    coverUrl: true,
    name: false,
  })
  const [lockIsbn, setLockIsbn] = useState(true)

  useEffect(() => {
    if (!open) return
    setQuery(book.name)
    setIsbnQuery(book.isbn ?? '')
    setCandidates([])
    setSelected(null)
    setLockIsbn(true)
    setAccept({
      isbn: !book.isbnLocked,
      author: !book.author,
      publisher: !book.publisher,
      description: !book.description,
      coverUrl: !book.coverUrl,
      name: false,
    })
  }, [open, book])

  const runSearch = async () => {
    setLoading(true)
    setSelected(null)
    try {
      const results = await searchBookMetadata(query.trim() || book.name, {
        author: book.author || undefined,
      })
      setCandidates(results)
      if (results.length === 0) toast.error('No matches — try a shorter title or ISBN')
      else setSelected(results[0])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }

  const runIsbn = async () => {
    const raw = isbnQuery.trim()
    if (!raw) return
    setLoading(true)
    try {
      const hit = await lookupByIsbn(raw)
      if (!hit) {
        toast.error('ISBN not found on Open Library')
        return
      }
      setCandidates([hit])
      setSelected(hit)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Lookup failed')
    } finally {
      setLoading(false)
    }
  }

  const apply = async () => {
    if (!selected) return
    if (book.isbnLocked && accept.isbn) {
      toast.error('ISBN is locked — unlock in catalog first, or uncheck ISBN')
      return
    }

    const isbn = preferredIsbn(selected)
    const patch: {
      updated_at: string
      metadata_source: string
      isbn?: string
      isbn_locked?: boolean
      author?: string
      publisher?: string
      description?: string
      cover_url?: string
      name?: string
    } = {
      updated_at: new Date().toISOString(),
      metadata_source: `${selected.source}:${selected.sourceId}`,
    }
    const localPatch: Partial<Book> = {}

    if (accept.isbn && isbn) {
      patch.isbn = isbn
      patch.isbn_locked = lockIsbn
      localPatch.isbn = isbn
      localPatch.isbnLocked = lockIsbn
    } else if (lockIsbn && book.isbn) {
      patch.isbn_locked = true
      localPatch.isbnLocked = true
    }

    if (accept.author && selected.authors[0]) {
      patch.author = selected.authors.join(', ')
      localPatch.author = selected.authors.join(', ')
    }
    if (accept.publisher && selected.publisher) {
      patch.publisher = selected.publisher
      localPatch.publisher = selected.publisher
    }
    if (accept.description && selected.description) {
      patch.description = selected.description
      localPatch.description = selected.description
    }
    if (accept.coverUrl && selected.coverUrl) {
      patch.cover_url = selected.coverUrl
      localPatch.coverUrl = selected.coverUrl
    }
    if (accept.name && selected.title) {
      patch.name = selected.title
      localPatch.name = selected.title
    }

    setSaving(true)
    try {
      const { error } = await supabase.from('books').update(patch).eq('id', book.id)
      if (error) throw error
      toast.success(isbn && accept.isbn ? `Linked ISBN ${isbn}` : 'Metadata saved')
      onSaved?.(localPatch)
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Find ISBN & metadata" size="lg">
      <div className="space-y-4">
        <p className="text-xs text-gray-500">
          Searches <strong>Open Library</strong> (free, good Nepali coverage). Google Books used if you set{' '}
          <code className="text-[10px] bg-gray-100 px-1 rounded">VITE_GOOGLE_BOOKS_API_KEY</code>.
          You pick the match and which fields to keep — nothing is overwritten blindly.
        </p>

        <div className="flex flex-wrap gap-2">
          <div className="flex-1 min-w-[180px]">
            <Input
              label="Title search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void runSearch()}
            />
          </div>
          <div className="pt-6">
            <Button loading={loading} onClick={() => void runSearch()}>
              <Search className="h-4 w-4" /> Search
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="flex-1 min-w-[180px]">
            <Input
              label="Or look up ISBN"
              value={isbnQuery}
              onChange={(e) => setIsbnQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void runIsbn()}
              placeholder="978…"
            />
          </div>
          <div className="pt-6">
            <Button variant="outline" loading={loading} onClick={() => void runIsbn()}>
              Lookup ISBN
            </Button>
          </div>
        </div>

        {candidates.length > 0 && (
          <ul className="max-h-48 overflow-y-auto space-y-2 rounded-xl border border-gray-200 p-2">
            {candidates.map((c) => {
              const active = selected?.sourceId === c.sourceId && selected?.source === c.source
              const isbn = preferredIsbn(c)
              return (
                <li key={`${c.source}:${c.sourceId}`}>
                  <button
                    type="button"
                    onClick={() => setSelected(c)}
                    className={cn(
                      'w-full flex gap-3 rounded-lg border p-2 text-left transition',
                      active ? 'border-accent-500 bg-accent-50' : 'border-transparent hover:bg-gray-50',
                    )}
                  >
                    {c.coverUrl ? (
                      <img src={c.coverUrl} alt="" className="h-16 w-12 object-cover rounded bg-gray-100 shrink-0" />
                    ) : (
                      <div className="h-16 w-12 rounded bg-gray-100 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 line-clamp-1">{c.title}</p>
                      <p className="text-xs text-gray-500 line-clamp-1">
                        {c.authors.join(', ') || 'Unknown author'}
                        {c.publisher ? ` · ${c.publisher}` : ''}
                        {c.publishYear ? ` · ${c.publishYear}` : ''}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {isbn && <Badge variant="green">{isbn}</Badge>}
                        {!isbn && <Badge variant="yellow">No ISBN</Badge>}
                        <Badge variant="gray">{c.source}</Badge>
                        <Badge variant="blue">{Math.round(c.score * 100)}% match</Badge>
                      </div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {selected && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-3">
            <div className="flex gap-3">
              {selected.coverUrl && (
                <img src={selected.coverUrl} alt="" className="h-28 w-20 object-cover rounded shadow-sm" />
              )}
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-semibold text-gray-900">{selected.title}</p>
                {selected.description && (
                  <p className="text-xs text-gray-600 line-clamp-4 whitespace-pre-wrap">{selected.description}</p>
                )}
                {selected.infoUrl && (
                  <a
                    href={selected.infoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-accent-700 hover:underline"
                  >
                    Open source <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>

            <p className="text-xs font-medium text-gray-700">Accept into catalog</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {(Object.keys(FIELD_LABELS) as FieldKey[]).map((key) => {
                const disabled = key === 'isbn' && book.isbnLocked
                const valuePreview =
                  key === 'isbn' ? preferredIsbn(selected)
                    : key === 'author' ? selected.authors.join(', ')
                      : key === 'publisher' ? selected.publisher
                        : key === 'description' ? (selected.description ? 'Yes' : '')
                          : key === 'coverUrl' ? (selected.coverUrl ? 'Yes' : '')
                            : selected.title
                return (
                  <label
                    key={key}
                    className={cn(
                      'flex items-start gap-2 rounded-lg border bg-white px-2.5 py-2 text-xs',
                      disabled && 'opacity-50',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={accept[key]}
                      disabled={disabled || !valuePreview}
                      onChange={(e) => setAccept((a) => ({ ...a, [key]: e.target.checked }))}
                    />
                    <span>
                      <span className="font-medium text-gray-800">{FIELD_LABELS[key]}</span>
                      <span className="block text-gray-400 truncate max-w-[140px]">
                        {valuePreview || '—'}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={lockIsbn}
                onChange={(e) => setLockIsbn(e.target.checked)}
              />
              {lockIsbn ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
              Lock ISBN after save (prevents accidental overwrite)
            </label>

            <div className="flex flex-wrap items-center gap-2 justify-end">
            {book.isbnLocked && (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  const { error } = await supabase.from('books').update({ isbn_locked: false }).eq('id', book.id)
                  if (error) toast.error(error.message)
                  else {
                    toast.success('ISBN unlocked')
                    onSaved?.({ isbnLocked: false })
                  }
                }}
              >
                <Unlock className="h-4 w-4" /> Unlock ISBN
              </Button>
            )}
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button loading={saving} onClick={() => void apply()}>
                <Check className="h-4 w-4" /> Apply selected
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
