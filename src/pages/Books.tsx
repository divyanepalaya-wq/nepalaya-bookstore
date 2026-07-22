import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Search, BookOpen, Plus, Pencil, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useBooks } from '@/contexts/BooksContext'
import { useWarehouse } from '@/contexts/WarehouseContext'
import { useAuth } from '@/contexts/AuthContext'
import { canWarehouse, isFullAdmin } from '@/lib/roles'
import { CATEGORY_OPTIONS, categoryLabel } from '@/lib/bookCategories'
import type { Book, BookType } from '@/types'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner } from '@/components/ui/Spinner'

const CATEGORIES = CATEGORY_OPTIONS

export default function Books() {
  const { appUser } = useAuth()
  const { books, loading } = useBooks()
  const { getRetailStock, getWarehouseStock, primaryWarehouse, bufferWarehouse } = useWarehouse()
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState<'' | BookType>('')
  const [modal, setModal] = useState<'add' | 'edit' | null>(null)
  const [editing, setEditing] = useState<Book | null>(null)
  const [name, setName] = useState('')
  const [author, setAuthor] = useState('')
  const [language, setLanguage] = useState<BookType>('Nepalaya')
  const [mrp, setMrp] = useState('')
  const [saving, setSaving] = useState(false)

  const canEdit = canWarehouse(appUser?.role) || isFullAdmin(appUser?.role)

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return books
      .filter((b) => !catFilter || b.language === catFilter)
      .filter((b) => {
        if (!q) return true
        return (
          b.name.toLowerCase().includes(q) ||
          (b.author ?? '').toLowerCase().includes(q) ||
          (b.isbn ?? '').includes(q)
        )
      })
      .map((b) => {
        const store = getRetailStock(b.id, b.inStock)
        const main = primaryWarehouse ? getWarehouseStock(b.id, primaryWarehouse.id) : 0
        const back = bufferWarehouse ? getWarehouseStock(b.id, bufferWarehouse.id) : 0
        return { book: b, store, main, back, total: store + main + back }
      })
      .sort((a, b) => a.book.name.localeCompare(b.book.name))
  }, [books, search, catFilter, getRetailStock, getWarehouseStock, primaryWarehouse, bufferWarehouse])

  const openAdd = () => {
    setEditing(null)
    setName('')
    setAuthor('')
    setLanguage('Nepalaya')
    setMrp('')
    setModal('add')
  }

  const openEdit = (b: Book) => {
    setEditing(b)
    setName(b.name)
    setAuthor(b.author ?? '')
    setLanguage(b.language)
    setMrp(String(b.mrp || ''))
    setModal('edit')
  }

  const save = async () => {
    if (!name.trim()) {
      toast.error('Title required')
      return
    }
    setSaving(true)
    try {
      if (modal === 'add') {
        const id = crypto.randomUUID().replace(/-/g, '').slice(0, 20)
        const { error } = await supabase.from('books').insert({
          id,
          name: name.trim(),
          author: author.trim() || null,
          language,
          category: 'other',
          mrp: Number(mrp) || 0,
          cost_price: 0,
          in_stock: 0,
          min_stock_alert: 5,
          is_deleted: false,
          created_by: appUser?.uid ?? null,
        })
        if (error) throw error
        toast.success('Book added')
      } else if (editing) {
        const { error } = await supabase
          .from('books')
          .update({
            name: name.trim(),
            author: author.trim() || null,
            language,
            mrp: Number(mrp) || 0,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editing.id)
        if (error) throw error
        toast.success('Saved')
      }
      setModal(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (b: Book) => {
    if (!confirm(`Remove “${b.name}”? (soft delete)`)) return
    const { error } = await supabase
      .from('books')
      .update({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: appUser?.uid ?? null })
      .eq('id', b.id)
    if (error) toast.error(error.message)
    else toast.success('Removed')
  }

  if (loading) return <PageSpinner />

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BookOpen className="h-7 w-7 text-accent-600" />
            Books
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Catalog · Nepalaya / Nepali / English · {rows.length} shown
          </p>
        </div>
        {canEdit && (
          <Button size="lg" className="min-h-11" onClick={openAdd}>
            <Plus className="h-5 w-5" /> Add book
          </Button>
        )}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
        <Input
          className="pl-11 min-h-12 text-base"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {([{ value: '' as const, label: 'All' }, ...CATEGORIES.map((c) => ({ value: c.value, label: c.label }))]).map((f) => (
          <button
            key={f.label}
            type="button"
            onClick={() => setCatFilter(f.value)}
            className={cn(
              'rounded-full px-4 py-2 text-sm font-semibold border min-h-10',
              catFilter === f.value
                ? 'bg-accent-600 text-white border-accent-600'
                : 'bg-white text-gray-700 border-gray-200',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <ul className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100">
        {rows.map(({ book, store, main, back }) => (
          <li key={book.id} className="flex items-center gap-2 px-3 py-3">
            <Link to={`/books/${book.id}`} className="min-w-0 flex-1 hover:opacity-80">
              <p className="font-semibold text-gray-900 line-clamp-1">{book.name}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge variant="gray">{categoryLabel(book.language)}</Badge>
                <span className="text-xs text-gray-400">
                  Shelf {store} · Back {back} · WH {main}
                </span>
              </div>
            </Link>
            {canEdit && (
              <div className="flex gap-1 shrink-0">
                <Button type="button" variant="outline" size="sm" className="min-h-10 w-10 p-0" onClick={() => openEdit(book)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button type="button" variant="outline" size="sm" className="min-h-10 w-10 p-0 text-red-600" onClick={() => void remove(book)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </li>
        ))}
        {rows.length === 0 && (
          <li className="px-4 py-10 text-center text-gray-400">No books</li>
        )}
      </ul>

      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={modal === 'add' ? 'Add book' : 'Edit book'}
        size="md"
      >
        <div className="space-y-4">
          <Input label="Title" className="min-h-12" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <Input label="Author" className="min-h-12" value={author} onChange={(e) => setAuthor(e.target.value)} />
          <Select
            label="Category"
            value={language}
            onChange={(e) => setLanguage(e.target.value as BookType)}
            options={CATEGORIES.map((c) => ({
              value: c.value,
              label: `${c.label} — ${c.hint}`,
            }))}
          />
          <Input
            label="MRP (Rs)"
            type="number"
            className="min-h-12"
            value={mrp}
            onChange={(e) => setMrp(e.target.value)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setModal(null)}>Cancel</Button>
            <Button loading={saving} onClick={() => void save()}>
              {modal === 'add' ? 'Add' : 'Save'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
