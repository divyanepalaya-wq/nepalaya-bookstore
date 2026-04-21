import { useState, useEffect, useCallback, useRef } from 'react'
import {
  collection, doc, addDoc, updateDoc, writeBatch,
  runTransaction, serverTimestamp, query, orderBy, where, getDocs,
} from 'firebase/firestore'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import {
  Plus, Search, ArrowDownCircle, ArrowUpCircle, History,
  Package, AlertTriangle, Pencil, TrendingUp, TrendingDown,
  Upload, Download, FileSpreadsheet, ListChecks, FileDown, X, Trash2,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useBooks } from '@/contexts/BooksContext'
import { writeAuditLog } from '@/lib/auditLog'
import { formatCurrency, formatDateTime, cn } from '@/lib/utils'
import { downloadCSV } from '@/lib/csvUtils'
import type { Book, StockTransaction, BookCategory, BookType } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { PageSpinner } from '@/components/ui/Spinner'

// ─── Schemas ─────────────────────────────────────────────────────────────────

/** Primary category options — the top-level grouping for every book */
const BOOK_TYPE_OPTIONS: { value: BookType; label: string; description: string }[] = [
  { value: 'Nepalaya', label: 'Nepalaya',  description: 'Published / distributed by Nepalaya' },
  { value: 'English',  label: 'English',   description: 'English-language books' },
  { value: 'Nepali',   label: 'Nepali',    description: 'Nepali-language books' },
]

const bookSchema = z.object({
  name: z.string().min(1, 'Required'),
  author: z.string().min(1, 'Required'),
  isbn: z.string().optional(),
  language: z.string().min(1, 'Required'),   // primary category
  category: z.string().min(1, 'Required'),   // sub-category
  publisher: z.string().optional(),
  mrp: z.coerce.number().positive('Must be positive'),
  costPrice: z.coerce.number().positive('Must be positive'),
  inStock: z.coerce.number().int().min(0, 'Cannot be negative'),
  minStockAlert: z.coerce.number().int().min(0).default(5),
  description: z.string().optional(),
}).refine((d) => d.costPrice <= d.mrp, {
  message: 'Cost price cannot exceed MRP',
  path: ['costPrice'],
})
type BookFormData = z.infer<typeof bookSchema>

const stockAdjSchema = z.object({
  quantity: z.coerce.number().int().positive('Must be a positive integer'),
  reason: z.string().min(1, 'Required'),
  reference: z.string().optional(),
})
type StockAdjData = z.infer<typeof stockAdjSchema>

/** Sub-category options */
const CATEGORY_OPTIONS: { value: BookCategory; label: string }[] = [
  { value: 'fiction',     label: 'Fiction' },
  { value: 'non-fiction', label: 'Non-Fiction' },
  { value: 'textbook',    label: 'Textbook' },
  { value: 'children',    label: "Children's" },
  { value: 'reference',   label: 'Reference' },
  { value: 'comics',      label: 'Comics' },
  { value: 'magazine',    label: 'Magazine' },
  { value: 'other',       label: 'Other' },
]

type ModalType = null | 'add' | 'edit' | 'stockIn' | 'stockOut' | 'history' | 'import' | 'bulkEdit' | 'bulkDelete'

// ─── Bulk edit schema ──────────────────────────────────────────────────────────

const bulkEditSchema = z.object({
  category:       z.string().optional(),
  language:       z.string().optional(),
  mrp:            z.union([z.coerce.number().positive('Must be positive'), z.literal('')]).optional(),
  costPrice:      z.union([z.coerce.number().positive('Must be positive'), z.literal('')]).optional(),
  minStockAlert:  z.union([z.coerce.number().int().min(0, 'Cannot be negative'), z.literal('')]).optional(),
})
type BulkEditData = z.infer<typeof bulkEditSchema>

// ─── Template columns ─────────────────────────────────────────────────────────
// language = primary category (Nepalaya | English | Nepali)
// category = sub-category (fiction | non-fiction | textbook | …)
const TEMPLATE_HEADERS = ['name', 'author', 'isbn', 'language', 'category', 'publisher', 'mrp', 'costPrice', 'inStock', 'minStockAlert', 'description']
const TEMPLATE_EXAMPLE = ['The Alchemist', 'Paulo Coelho', '9780062315007', 'English', 'fiction', 'HarperCollins', 850, 600, 10, 3, 'A novel about following your dreams']

interface ImportRow {
  name: string
  author: string
  isbn?: string
  language: string   // primary category
  category: string   // sub-category
  publisher?: string
  mrp: number
  costPrice: number
  inStock: number
  minStockAlert: number
  description?: string
  _valid: boolean
  _error?: string
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Stock() {
  const { appUser } = useAuth()
  const { books, loading: loadingBooks } = useBooks()
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [languageFilter, setLanguageFilter] = useState('')
  const [modalType, setModalType] = useState<ModalType>(null)
  const [selectedBook, setSelectedBook] = useState<Book | null>(null)
  const [history, setHistory] = useState<StockTransaction[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [importRows, setImportRows] = useState<ImportRow[]>([])
  const [importing, setImporting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkSubmitting, setBulkSubmitting] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  // ─── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      if (e.key === '/' && !inInput) {
        e.preventDefault()
        searchRef.current?.focus()
      }
      if (e.key === 'n' && !inInput && !modalType) {
        openAdd()
      }
      if (e.key === 'e' && !inInput && !modalType) {
        exportBooks()
      }
      if (e.key === 'Escape' && selectedIds.size > 0 && !modalType) {
        setSelectedIds(new Set())
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalType, selectedIds.size])

  // ─── Book Form ─────────────────────────────────────────────────────────────

  const bookForm = useForm<BookFormData>({ resolver: zodResolver(bookSchema) })

  const openAdd = () => {
    bookForm.reset({ minStockAlert: 5, inStock: 0, costPrice: 0, mrp: 0 })
    setSelectedBook(null)
    setModalType('add')
  }

  const openEdit = (book: Book) => {
    bookForm.reset({
      name: book.name,
      author: book.author,
      isbn: book.isbn ?? '',
      language: book.language ?? '',
      category: book.category,
      publisher: book.publisher ?? '',
      mrp: book.mrp,
      costPrice: book.costPrice,
      inStock: book.inStock,
      minStockAlert: book.minStockAlert,
      description: book.description ?? '',
    })
    setSelectedBook(book)
    setModalType('edit')
  }

  const saveBook = async (data: BookFormData) => {
    if (!appUser) return
    setSubmitting(true)
    try {
      if (modalType === 'add') {
        const ref = await addDoc(collection(db, 'books'), {
          ...data,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: appUser.uid,
        })
        await writeAuditLog({
          action: 'book_created',
          entity: 'book',
          entityId: ref.id,
          details: `Added book "${data.name}"`,
          performedBy: appUser.uid,
          performedByName: appUser.displayName,
          role: appUser.role,
        })
        toast.success('Book added successfully')
      } else if (modalType === 'edit' && selectedBook) {
        await updateDoc(doc(db, 'books', selectedBook.id), {
          ...data,
          updatedAt: serverTimestamp(),
        })
        await writeAuditLog({
          action: 'book_updated',
          entity: 'book',
          entityId: selectedBook.id,
          details: `Updated book "${data.name}"`,
          performedBy: appUser.uid,
          performedByName: appUser.displayName,
          role: appUser.role,
        })
        toast.success('Book updated')
      }
      setModalType(null)
    } catch (e) {
      toast.error('Failed to save book')
      console.error(e)
    } finally {
      setSubmitting(false)
    }
  }

  // ─── Stock Adjustment ──────────────────────────────────────────────────────

  const adjForm = useForm<StockAdjData>({ resolver: zodResolver(stockAdjSchema) })

  const openStockIn = (book: Book) => {
    adjForm.reset()
    setSelectedBook(book)
    setModalType('stockIn')
  }

  const openStockOut = (book: Book) => {
    adjForm.reset()
    setSelectedBook(book)
    setModalType('stockOut')
  }

  const saveStockAdj = async (data: StockAdjData) => {
    if (!appUser || !selectedBook) return
    const isIn = modalType === 'stockIn'
    setSubmitting(true)
    try {
      await runTransaction(db, async (tx) => {
        const bookRef = doc(db, 'books', selectedBook.id)
        const bookSnap = await tx.get(bookRef)
        const current = (bookSnap.data()?.inStock ?? 0) as number
        const next = isIn ? current + data.quantity : current - data.quantity

        if (next < 0) throw new Error(`Only ${current} in stock`)

        tx.update(bookRef, { inStock: next, updatedAt: serverTimestamp() })

        const txRef = doc(collection(db, 'stockTransactions'))
        tx.set(txRef, {
          bookId: selectedBook.id,
          bookName: selectedBook.name,
          type: isIn ? 'in' : 'out',
          quantity: data.quantity,
          previousStock: current,
          newStock: next,
          reason: data.reason,
          reference: data.reference ?? '',
          performedBy: appUser.uid,
          performedByName: appUser.displayName,
          createdAt: serverTimestamp(),
        })
      })

      await writeAuditLog({
        action: isIn ? 'stock_in' : 'stock_out',
        entity: 'book',
        entityId: selectedBook.id,
        details: `${isIn ? 'Stock In' : 'Stock Out'}: ${data.quantity}x "${selectedBook.name}" — ${data.reason}`,
        performedBy: appUser.uid,
        performedByName: appUser.displayName,
        role: appUser.role,
      })

      toast.success(`Stock ${isIn ? 'added' : 'removed'} successfully`)
      setModalType(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update stock')
    } finally {
      setSubmitting(false)
    }
  }

  // ─── Template download ─────────────────────────────────────────────────────

  const downloadTemplate = () => {
    downloadCSV('nepalaya_books_template.csv', TEMPLATE_HEADERS, [TEMPLATE_EXAMPLE])
    toast.success('Template downloaded')
  }

  // ─── Import from file ──────────────────────────────────────────────────────

  const handleFileImport = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })

        const rows: ImportRow[] = raw.map((r, idx) => {
          const name     = String(r['name']     ?? '').trim()
          const author   = String(r['author']   ?? '').trim()
          const rawLang  = String(r['language'] ?? '').trim()
          const category = String(r['category'] ?? '').trim()
          const mrp      = parseFloat(String(r['mrp']      ?? 0))
          const costPrice = parseFloat(String(r['costPrice'] ?? 0))
          const inStock  = parseInt(String(r['inStock']  ?? 0), 10)
          const minStockAlert = parseInt(String(r['minStockAlert'] ?? 5), 10)

          // Match language case-insensitively to a valid BookType
          const langNorm = BOOK_TYPE_OPTIONS.find(
            (l) => l.value.toLowerCase() === rawLang.toLowerCase()
          )?.value

          let _error: string | undefined
          if (!name) _error = 'Missing name'
          else if (!author) _error = 'Missing author'
          else if (!langNorm) _error = `Invalid language "${rawLang}" — must be Nepalaya, English, or Nepali`
          else if (!category) _error = 'Missing sub-category'
          else if (isNaN(mrp) || mrp <= 0) _error = 'Invalid MRP'
          else if (isNaN(costPrice) || costPrice <= 0) _error = 'Invalid cost price'
          else if (isNaN(inStock) || inStock < 0) _error = 'Invalid stock'

          return {
            name, author,
            language: langNorm ?? rawLang,
            category,
            isbn: String(r['isbn'] ?? '').trim() || undefined,
            publisher: String(r['publisher'] ?? '').trim() || undefined,
            mrp, costPrice, inStock,
            minStockAlert: isNaN(minStockAlert) ? 5 : minStockAlert,
            description: String(r['description'] ?? '').trim() || undefined,
            _valid: !_error,
            _error,
          } as ImportRow & { _rowNum: number }
          void idx
        })

        setImportRows(rows)
        setModalType('import')
      } catch {
        toast.error('Failed to parse file. Ensure it is a valid CSV or Excel file.')
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const confirmImport = async () => {
    if (!appUser) return
    const validRows = importRows.filter((r) => r._valid)
    if (validRows.length === 0) { toast.error('No valid rows to import'); return }
    // Hard cap at 490 to ensure the whole import fits in a single Firestore batch.
    // This prevents partial-import corruption where batch 1 commits but batch 2 fails.
    if (validRows.length > 490) {
      toast.error(`Too many rows — maximum 490 per import (file has ${validRows.length} valid rows). Split into smaller files.`)
      return
    }
    setImporting(true)
    try {
      // Single atomic batch — all books commit together or none do
      const batch = writeBatch(db)
      validRows.forEach((row) => {
        const ref = doc(collection(db, 'books'))
        batch.set(ref, {
          name: row.name,
          author: row.author,
          isbn: row.isbn ?? '',
          language: row.language,
          category: row.category,
          publisher: row.publisher ?? '',
          mrp: row.mrp,
          costPrice: row.costPrice,
          inStock: row.inStock,
          minStockAlert: row.minStockAlert,
          description: row.description ?? '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: appUser.uid,
        })
      })
      await batch.commit()
      // Single audit log summarising the whole import
      await writeAuditLog({
        action: 'book_created',
        entity: 'book',
        details: `Bulk imported ${validRows.length} book${validRows.length !== 1 ? 's' : ''} via CSV/Excel`,
        performedBy: appUser.uid,
        performedByName: appUser.displayName,
        role: appUser.role,
      })
      toast.success(`Imported ${validRows.length} book${validRows.length !== 1 ? 's' : ''} successfully`)
      setModalType(null)
      setImportRows([])
    } catch {
      toast.error('Import failed. Please check your data and try again.')
    } finally {
      setImporting(false)
    }
  }

  // ─── History ───────────────────────────────────────────────────────────────

  const openHistory = useCallback(async (book: Book) => {
    setSelectedBook(book)
    setModalType('history')
    setLoadingHistory(true)
    try {
      const snap = await getDocs(
        query(
          collection(db, 'stockTransactions'),
          where('bookId', '==', book.id),
          orderBy('createdAt', 'desc')
        )
      )
      setHistory(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as StockTransaction))
    } catch {
      toast.error('Failed to load history')
    } finally {
      setLoadingHistory(false)
    }
  }, [])

  // ─── Bulk edit ────────────────────────────────────────────────────────────

  const bulkForm = useForm<BulkEditData>({ resolver: zodResolver(bulkEditSchema) })

  const saveBulkEdit = async (data: BulkEditData) => {
    if (!appUser || selectedIds.size === 0) return
    // Only apply fields that were actually filled in
    const patch: Record<string, unknown> = { updatedAt: serverTimestamp() }
    if (data.category)      patch.category      = data.category
    if (data.language)      patch.language      = data.language
    if (data.mrp !== '')    patch.mrp            = Number(data.mrp)
    if (data.costPrice !== '') patch.costPrice   = Number(data.costPrice)
    if (data.minStockAlert !== '') patch.minStockAlert = Number(data.minStockAlert)

    if (Object.keys(patch).length === 1) { toast.error('Fill in at least one field to update'); return }

    setBulkSubmitting(true)
    try {
      const ids = [...selectedIds]
      const BATCH_SIZE = 490
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const batch = writeBatch(db)
        ids.slice(i, i + BATCH_SIZE).forEach((id) => batch.update(doc(db, 'books', id), patch))
        await batch.commit()
      }
      await writeAuditLog({
        action: 'book_updated',
        entity: 'book',
        details: `Bulk updated ${ids.length} book${ids.length !== 1 ? 's' : ''}: ${Object.keys(patch).filter((k) => k !== 'updatedAt').join(', ')}`,
        performedBy: appUser.uid,
        performedByName: appUser.displayName,
        role: appUser.role,
      })
      toast.success(`Updated ${ids.length} book${ids.length !== 1 ? 's' : ''}`)
      setSelectedIds(new Set())
      setModalType(null)
      bulkForm.reset()
    } catch {
      toast.error('Bulk update failed')
    } finally {
      setBulkSubmitting(false)
    }
  }

  // ─── Bulk soft-delete ─────────────────────────────────────────────────────

  const bulkSoftDelete = async () => {
    if (!appUser || selectedIds.size === 0) return
    setBulkDeleting(true)
    try {
      const ids = [...selectedIds]
      const BATCH_SIZE = 490
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const batch = writeBatch(db)
        ids.slice(i, i + BATCH_SIZE).forEach((id) =>
          batch.update(doc(db, 'books', id), {
            isDeleted: true,
            deletedAt: serverTimestamp(),
            deletedBy: appUser.uid,
          })
        )
        await batch.commit()
      }
      await writeAuditLog({
        action: 'book_deleted',
        entity: 'book',
        details: `Soft-deleted ${ids.length} book${ids.length !== 1 ? 's' : ''}`,
        performedBy: appUser.uid,
        performedByName: appUser.displayName,
        role: appUser.role,
      })
      toast.success(`${ids.length} book${ids.length !== 1 ? 's' : ''} deleted`)
      setSelectedIds(new Set())
    } catch {
      toast.error('Delete failed')
    } finally {
      setBulkDeleting(false)
    }
  }

  // ─── Export books ──────────────────────────────────────────────────────────

  const exportBooks = () => {
    const rows = filtered.map((b) => [
      b.name, b.author, b.isbn ?? '', b.language ?? '', b.category, b.publisher ?? '',
      b.mrp, b.costPrice, b.inStock, b.minStockAlert, b.description ?? '',
    ])
    downloadCSV(
      `nepalaya_books_${new Date().toISOString().slice(0, 10)}.csv`,
      ['Name', 'Author', 'ISBN', 'Language (Category)', 'Sub-Category', 'Publisher', 'MRP (Rs.)', 'Cost Price (Rs.)', 'In Stock', 'Min Stock Alert', 'Description'],
      rows
    )
    toast.success(`Exported ${filtered.length} book${filtered.length !== 1 ? 's' : ''}`)
  }

  // ─── Filtered books ────────────────────────────────────────────────────────

  const filtered = books.filter((b) => {
    const q = search.toLowerCase()
    const matchSearch = !q || b.name.toLowerCase().includes(q) || b.author.toLowerCase().includes(q) || (b.isbn ?? '').includes(q)
    const matchCat = !categoryFilter || b.category === categoryFilter
    const matchLang = !languageFilter || b.language === languageFilter
    return matchSearch && matchCat && matchLang
  })

  const lowStockCount = books.filter((b) => b.inStock <= b.minStockAlert).length

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Stock Management</h1>
          <p className="text-sm text-gray-500">{books.length} books · {lowStockCount > 0 && <span className="text-red-500 font-medium">{lowStockCount} low stock</span>}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={exportBooks}
            className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <FileDown className="h-4 w-4" /> Export <kbd className="ml-0.5 rounded border border-gray-200 bg-gray-50 px-1 py-0.5 text-xs font-mono text-gray-400">E</kbd>
          </button>
          <button
            onClick={downloadTemplate}
            className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <Download className="h-4 w-4" /> Template
          </button>
          <label className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer">
            <Upload className="h-4 w-4" /> Import
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) { handleFileImport(f); e.target.value = '' } }}
            />
          </label>
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4" /> Add Book <kbd className="ml-0.5 rounded border border-brand-300 bg-brand-600/20 px-1 py-0.5 text-xs font-mono text-brand-100">N</kbd>
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, author, ISBN…"
            className="w-full rounded-lg border border-gray-300 bg-white pl-9 pr-14 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <kbd className="absolute right-3 top-2 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-xs text-gray-400 font-mono pointer-events-none">/</kbd>
        </div>
        <select
          value={languageFilter}
          onChange={(e) => setLanguageFilter(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 sm:w-44"
        >
          <option value="">All Types</option>
          {BOOK_TYPE_OPTIONS.map((l) => (
            <option key={l.value} value={l.value}>{l.label}</option>
          ))}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 sm:w-44"
        >
          <option value="">All Sub-Categories</option>
          {[...new Set(books.map((b) => b.category))].sort().map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
      </div>

      {/* Low stock banner */}
      {lowStockCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-accent-50 border border-accent-200 px-4 py-2.5 text-sm text-accent-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{lowStockCount} book{lowStockCount > 1 ? 's are' : ' is'} running low on stock.</span>
        </div>
      )}

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-2.5 flex-wrap">
          <span className="text-sm font-semibold text-brand-700">{selectedIds.size} selected</span>
          <Button size="sm" onClick={() => { bulkForm.reset(); setModalType('bulkEdit') }}>
            <ListChecks className="h-4 w-4" /> Bulk Edit
          </Button>
          <button
            onClick={() => setModalType('bulkDelete')}
            className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto flex items-center gap-1 text-sm text-brand-600 hover:text-brand-800"
          >
            <X className="h-4 w-4" /> Clear <kbd className="ml-1 rounded bg-brand-100 px-1 py-0.5 text-xs font-mono">Esc</kbd>
          </button>
        </div>
      )}

      {/* Table */}
      {loadingBooks ? (
        <PageSpinner />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="pl-4 pr-2 py-3 w-8">
                  <input
                    type="checkbox"
                    className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                    checked={filtered.length > 0 && filtered.every((b) => selectedIds.has(b.id))}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedIds(new Set(filtered.map((b) => b.id)))
                      else setSelectedIds(new Set())
                    }}
                  />
                </th>
                {['Book', 'Type / Sub-Cat', 'MRP', 'Cost', 'In Stock', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-sm text-gray-400">
                    <Package className="mx-auto h-10 w-10 mb-2 opacity-30" />
                    No books found
                  </td>
                </tr>
              ) : (
                filtered.map((book) => {
                  const isLow = book.inStock <= book.minStockAlert
                  const isSelected = selectedIds.has(book.id)
                  return (
                    <tr key={book.id} className={cn('hover:bg-gray-50', isSelected && 'bg-brand-50')}>
                      <td className="pl-4 pr-2 py-3">
                        <input
                          type="checkbox"
                          className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                          checked={isSelected}
                          onChange={(e) => {
                            const next = new Set(selectedIds)
                            e.target.checked ? next.add(book.id) : next.delete(book.id)
                            setSelectedIds(next)
                          }}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{book.name}</p>
                        <p className="text-xs text-gray-400">{book.author}{book.isbn ? ` · ${book.isbn}` : ''}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <Badge variant={book.language === 'Nepalaya' ? 'orange' : book.language === 'Nepali' ? 'red' : 'blue'}>
                            {book.language ?? '—'}
                          </Badge>
                          <Badge variant="gray" className="text-xs">{book.category}</Badge>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-800">{formatCurrency(book.mrp)}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{formatCurrency(book.costPrice)}</td>
                      <td className="px-4 py-3">
                        <span className={cn('text-sm font-semibold', isLow ? 'text-red-600' : 'text-green-600')}>
                          {book.inStock}
                        </span>
                        {isLow && <AlertTriangle className="inline h-3.5 w-3.5 text-red-500 ml-1" />}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openStockIn(book)}
                            title="Stock In"
                            className="rounded-lg p-1.5 text-green-600 hover:bg-green-50 transition-colors"
                          >
                            <TrendingUp className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => openStockOut(book)}
                            title="Stock Out"
                            className="rounded-lg p-1.5 text-red-500 hover:bg-red-50 transition-colors"
                          >
                            <TrendingDown className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => openHistory(book)}
                            title="History"
                            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 transition-colors"
                          >
                            <History className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => openEdit(book)}
                            title="Edit"
                            className="rounded-lg p-1.5 text-brand-600 hover:bg-brand-50 transition-colors"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Bulk Edit Modal ── */}
      <Modal
        open={modalType === 'bulkEdit'}
        onClose={() => setModalType(null)}
        title={`Bulk Edit — ${selectedIds.size} book${selectedIds.size !== 1 ? 's' : ''}`}
        size="sm"
      >
        <form onSubmit={bulkForm.handleSubmit(saveBulkEdit)} className="space-y-4">
          <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
            Leave a field blank to keep its current value. Only filled fields will be updated.
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category (primary)</label>
            <select
              {...bulkForm.register('language')}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">— keep current —</option>
              {BOOK_TYPE_OPTIONS.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sub-Category</label>
            <select
              {...bulkForm.register('category')}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">— keep current —</option>
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <Input
            label="MRP (Rs.)"
            type="number"
            step="0.01"
            placeholder="leave blank to keep"
            error={bulkForm.formState.errors.mrp?.message as string | undefined}
            {...bulkForm.register('mrp')}
          />
          <Input
            label="Cost Price (Rs.)"
            type="number"
            step="0.01"
            placeholder="leave blank to keep"
            error={bulkForm.formState.errors.costPrice?.message as string | undefined}
            {...bulkForm.register('costPrice')}
          />
          <Input
            label="Low Stock Alert (qty)"
            type="number"
            placeholder="leave blank to keep"
            error={bulkForm.formState.errors.minStockAlert?.message as string | undefined}
            {...bulkForm.register('minStockAlert')}
          />
          <div className="flex justify-end gap-3 pt-1">
            <Button variant="outline" type="button" onClick={() => setModalType(null)}>Cancel</Button>
            <Button type="submit" loading={bulkSubmitting}>
              Apply to {selectedIds.size} book{selectedIds.size !== 1 ? 's' : ''}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── Bulk Delete Confirm Modal ── */}
      <Modal
        open={modalType === 'bulkDelete'}
        onClose={() => setModalType(null)}
        title="Delete Books"
        size="sm"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg bg-red-50 border border-red-200 p-4">
            <Trash2 className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-800">
                Delete {selectedIds.size} book{selectedIds.size !== 1 ? 's' : ''}?
              </p>
              <p className="text-sm text-red-700 mt-1">
                These books will be hidden from stock and POS. This is a soft delete — records are retained in the database and can be restored by an administrator if needed.
              </p>
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={() => setModalType(null)} disabled={bulkDeleting}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={bulkDeleting}
              onClick={async () => {
                await bulkSoftDelete()
                setModalType(null)
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete {selectedIds.size} book{selectedIds.size !== 1 ? 's' : ''}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Add / Edit Book Modal ── */}
      <Modal
        open={modalType === 'add' || modalType === 'edit'}
        onClose={() => setModalType(null)}
        title={modalType === 'add' ? 'Add New Book' : 'Edit Book'}
        size="lg"
      >
        <form onSubmit={bookForm.handleSubmit(saveBook)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Book Name *"
              error={bookForm.formState.errors.name?.message}
              {...bookForm.register('name')}
            />
            <Input
              label="Author *"
              error={bookForm.formState.errors.author?.message}
              {...bookForm.register('author')}
            />
            <Input label="ISBN" {...bookForm.register('isbn')} />
            <Select
              label="Category *"
              options={BOOK_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              placeholder="Select category"
              hint="Nepalaya · English · Nepali"
              error={bookForm.formState.errors.language?.message}
              {...bookForm.register('language')}
            />
            <Select
              label="Sub-Category *"
              options={CATEGORY_OPTIONS}
              placeholder="Select sub-category"
              hint="Fiction, Non-Fiction, Textbook, etc."
              error={bookForm.formState.errors.category?.message}
              {...bookForm.register('category')}
            />
            <Input label="Publisher" {...bookForm.register('publisher')} />
            <Input
              label="MRP (Rs.) *"
              type="number"
              step="0.01"
              error={bookForm.formState.errors.mrp?.message}
              {...bookForm.register('mrp')}
            />
            <Input
              label="Cost Price (Rs.) *"
              type="number"
              step="0.01"
              error={bookForm.formState.errors.costPrice?.message}
              {...bookForm.register('costPrice')}
            />
            <Input
              label="Initial Stock *"
              type="number"
              error={bookForm.formState.errors.inStock?.message}
              {...bookForm.register('inStock')}
            />
            <Input
              label="Low Stock Alert (qty)"
              type="number"
              hint="Alert when stock falls to or below this number"
              {...bookForm.register('minStockAlert')}
            />
          </div>
          <Textarea
            label="Description"
            rows={2}
            {...bookForm.register('description')}
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" type="button" onClick={() => setModalType(null)}>Cancel</Button>
            <Button type="submit" loading={submitting}>Save Book</Button>
          </div>
        </form>
      </Modal>

      {/* ── Stock In / Out Modal ── */}
      <Modal
        open={modalType === 'stockIn' || modalType === 'stockOut'}
        onClose={() => setModalType(null)}
        title={modalType === 'stockIn' ? 'Stock In' : 'Stock Out'}
        size="sm"
      >
        {selectedBook && (
          <form onSubmit={adjForm.handleSubmit(saveStockAdj)} className="space-y-4">
            <div className={cn(
              'rounded-lg p-3 text-sm',
              modalType === 'stockIn' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
            )}>
              <p className="font-medium">{selectedBook.name}</p>
              <p>Current stock: <span className="font-bold">{selectedBook.inStock}</span></p>
            </div>

            <Input
              label="Quantity *"
              type="number"
              min={1}
              error={adjForm.formState.errors.quantity?.message}
              {...adjForm.register('quantity')}
            />
            <Input
              label="Reason / Notes *"
              placeholder={modalType === 'stockIn' ? 'e.g. New shipment from Ekta Books' : 'e.g. Damaged, returned, sold offline'}
              error={adjForm.formState.errors.reason?.message}
              {...adjForm.register('reason')}
            />
            <Input
              label="Reference (optional)"
              placeholder="Invoice / PO number"
              {...adjForm.register('reference')}
            />
            <div className="flex justify-end gap-3 pt-1">
              <Button variant="outline" type="button" onClick={() => setModalType(null)}>Cancel</Button>
              <Button
                type="submit"
                variant={modalType === 'stockIn' ? 'primary' : 'danger'}
                loading={submitting}
              >
                {modalType === 'stockIn' ? (
                  <><ArrowDownCircle className="h-4 w-4" /> Add Stock</>
                ) : (
                  <><ArrowUpCircle className="h-4 w-4" /> Remove Stock</>
                )}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* ── Stock History Modal ── */}
      <Modal
        open={modalType === 'history'}
        onClose={() => setModalType(null)}
        title={`Stock History — ${selectedBook?.name}`}
        size="xl"
      >
        {loadingHistory ? (
          <PageSpinner />
        ) : history.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">No transactions recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {history.map((tx) => (
              <div key={tx.id} className="flex items-start gap-3 rounded-lg border border-gray-100 p-3">
                <div className={cn(
                  'mt-0.5 rounded-full p-1.5',
                  tx.type === 'in' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'
                )}>
                  {tx.type === 'in'
                    ? <ArrowDownCircle className="h-4 w-4" />
                    : <ArrowUpCircle className="h-4 w-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn('text-sm font-semibold', tx.type === 'in' ? 'text-green-700' : 'text-red-700')}>
                      {tx.type === 'in' ? '+' : '-'}{tx.quantity} units
                    </span>
                    <span className="text-xs text-gray-400 shrink-0">{formatDateTime(tx.createdAt)}</span>
                  </div>
                  <p className="text-xs text-gray-600 mt-0.5">{tx.reason}</p>
                  {tx.reference && <p className="text-xs text-gray-400">Ref: {tx.reference}</p>}
                  <p className="text-xs text-gray-400 mt-0.5">
                    By <span className="font-medium">{tx.performedByName}</span>
                    {' · '}{tx.previousStock} → {tx.newStock}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* ── Import Preview Modal ── */}
      <Modal
        open={modalType === 'import'}
        onClose={() => { setModalType(null); setImportRows([]) }}
        title="Import Books Preview"
        size="xl"
      >
        {importRows.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">No rows found in file.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-sm">
              <span className="font-medium text-gray-700">{importRows.length} row{importRows.length !== 1 ? 's' : ''} detected</span>
              <span className="text-green-600 font-medium">{importRows.filter((r) => r._valid).length} valid</span>
              {importRows.filter((r) => !r._valid).length > 0 && (
                <span className="text-red-500 font-medium">{importRows.filter((r) => !r._valid).length} errors (will be skipped)</span>
              )}
            </div>

            <div className="overflow-x-auto rounded-lg border border-gray-200 max-h-80 overflow-y-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-gray-500"></th>
                    {['Name', 'Author', 'Category', 'MRP', 'Cost', 'Stock'].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-gray-500 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {importRows.map((row, i) => (
                    <tr key={i} className={row._valid ? '' : 'bg-red-50'}>
                      <td className="px-3 py-2">
                        {row._valid
                          ? <FileSpreadsheet className="h-3.5 w-3.5 text-green-500" />
                          : <span title={row._error} className="text-red-500 cursor-help text-xs font-medium">✕</span>}
                      </td>
                      <td className="px-3 py-2 font-medium text-gray-900 max-w-[150px] truncate">{row.name || '—'}</td>
                      <td className="px-3 py-2 text-gray-600 max-w-[120px] truncate">{row.author || '—'}</td>
                      <td className="px-3 py-2 text-gray-500">{row.category || '—'}</td>
                      <td className="px-3 py-2 text-gray-700">Rs.{row.mrp}</td>
                      <td className="px-3 py-2 text-gray-500">Rs.{row.costPrice}</td>
                      <td className="px-3 py-2 text-gray-700">{row.inStock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {importRows.some((r) => !r._valid) && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                <p className="font-semibold mb-1">Rows with errors will be skipped. Common issues:</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {importRows.filter((r) => !r._valid).slice(0, 3).map((r, i) => (
                    <li key={i}>{r.name || `Row ${i + 1}`}: {r._error}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <Button variant="outline" onClick={() => { setModalType(null); setImportRows([]) }}>Cancel</Button>
              <Button
                onClick={confirmImport}
                loading={importing}
                disabled={importRows.filter((r) => r._valid).length === 0}
              >
                <Upload className="h-4 w-4" />
                Import {importRows.filter((r) => r._valid).length} Book{importRows.filter((r) => r._valid).length !== 1 ? 's' : ''}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
