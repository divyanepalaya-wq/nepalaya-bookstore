import type { Book, BookType } from '@/types'

/** Three pure catalog categories (stored in books.language). */
export const BOOK_CATEGORIES: BookType[] = ['Nepalaya', 'Nepali', 'English']

export function categoryLabel(cat: BookType | string | undefined): string {
  if (cat === 'Nepalaya') return 'Nepalaya'
  if (cat === 'Nepali') return 'Nepali'
  if (cat === 'English') return 'English'
  return cat || '—'
}

/** Own print run — warehouse → backroom → shelf. */
export function isNepalaya(book: Pick<Book, 'language'> | BookType | string | undefined): boolean {
  const v = typeof book === 'string' ? book : book?.language
  return v === 'Nepalaya'
}

/** Third-party — receive straight to store shelf. */
export function isThirdParty(book: Pick<Book, 'language'> | BookType | string | undefined): boolean {
  const v = typeof book === 'string' ? book : book?.language
  return v === 'Nepali' || v === 'English'
}

export const CATEGORY_OPTIONS: { value: BookType; label: string }[] = [
  { value: 'Nepalaya', label: 'Nepalaya' },
  { value: 'Nepali', label: 'Nepali' },
  { value: 'English', label: 'English' },
]

export const CATEGORY_FILTERS: { value: '' | BookType; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'Nepalaya', label: 'Nepalaya' },
  { value: 'Nepali', label: 'Nepali' },
  { value: 'English', label: 'English' },
]
