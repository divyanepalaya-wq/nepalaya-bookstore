/**
 * Free public book metadata via Open Library (no API key).
 * Google Books optional if VITE_GOOGLE_BOOKS_API_KEY is set.
 *
 * We never scrape publisher sites — only official APIs / cover CDN.
 */

export interface BookLookupCandidate {
  source: 'openlibrary' | 'google'
  sourceId: string
  title: string
  authors: string[]
  isbn13?: string
  isbn10?: string
  publisher?: string
  publishYear?: number
  languages: string[]
  coverUrl?: string
  description?: string
  infoUrl?: string
  score: number
}

function norm(s: string) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u0900-\u097f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function titleScore(query: string, title: string) {
  const a = norm(query)
  const b = norm(title)
  if (!a || !b) return 0
  if (a === b) return 1
  if (b.includes(a) || a.includes(b)) return 0.92
  const aw = new Set(a.split(' ').filter((w) => w.length > 1))
  const bw = b.split(' ').filter((w) => w.length > 1)
  if (aw.size === 0) return 0
  let hit = 0
  for (const w of bw) if (aw.has(w)) hit++
  return hit / Math.max(aw.size, bw.length)
}

function pickIsbn(isbns?: string[]): { isbn13?: string; isbn10?: string } {
  if (!isbns?.length) return {}
  const clean = isbns.map((x) => x.replace(/[^0-9Xx]/g, ''))
  const isbn13 = clean.find((x) => x.length === 13)
  const isbn10 = clean.find((x) => x.length === 10)
  return { isbn13, isbn10 }
}

function coverFromId(coverId?: number) {
  if (!coverId) return undefined
  return `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
}

function coverFromIsbn(isbn?: string) {
  if (!isbn) return undefined
  return `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) return null
  return (await res.json()) as T
}

async function workDescription(workKey: string): Promise<string | undefined> {
  const key = workKey.startsWith('/') ? workKey : `/works/${workKey}`
  const data = await fetchJson<{
    description?: string | { type?: string; value?: string }
  }>(`https://openlibrary.org${key}.json`)
  if (!data?.description) return undefined
  if (typeof data.description === 'string') return data.description
  return data.description.value
}

type OlSearchDoc = {
  key: string
  title?: string
  author_name?: string[]
  isbn?: string[]
  cover_i?: number
  first_publish_year?: number
  publisher?: string[]
  language?: string[]
  edition_key?: string[]
}

export async function searchOpenLibrary(
  title: string,
  opts?: { author?: string; limit?: number },
): Promise<BookLookupCandidate[]> {
  const q = opts?.author
    ? `title:${title} author:${opts.author}`
    : title
  const params = new URLSearchParams({
    q,
    limit: String(opts?.limit ?? 8),
    fields: 'key,title,author_name,isbn,cover_i,first_publish_year,publisher,language,edition_key',
  })
  const data = await fetchJson<{ docs?: OlSearchDoc[] }>(
    `https://openlibrary.org/search.json?${params}`,
  )
  const docs = data?.docs ?? []
  const out: BookLookupCandidate[] = []

  for (const doc of docs) {
    const { isbn13, isbn10 } = pickIsbn(doc.isbn)
    const score = titleScore(title, doc.title ?? '')
    if (score < 0.35) continue
    out.push({
      source: 'openlibrary',
      sourceId: doc.key,
      title: doc.title ?? title,
      authors: doc.author_name ?? [],
      isbn13,
      isbn10,
      publisher: doc.publisher?.[0],
      publishYear: doc.first_publish_year,
      languages: doc.language ?? [],
      coverUrl: coverFromId(doc.cover_i) ?? coverFromIsbn(isbn13 ?? isbn10),
      infoUrl: `https://openlibrary.org${doc.key}`,
      score,
    })
  }

  // Enrich top matches with work description (sequential, capped)
  for (const c of out.slice(0, 4)) {
    try {
      c.description = await workDescription(c.sourceId)
    } catch {
      /* ignore */
    }
  }

  return out.sort((a, b) => b.score - a.score)
}

export async function lookupByIsbn(isbn: string): Promise<BookLookupCandidate | null> {
  const clean = isbn.replace(/[^0-9Xx]/g, '')
  if (clean.length < 10) return null
  const data = await fetchJson<Record<string, {
    title?: string
    authors?: { name?: string }[]
    publishers?: { name?: string }[]
    publish_date?: string
    number_of_pages?: number
    cover?: { large?: string; medium?: string }
    url?: string
    identifiers?: { isbn_13?: string[]; isbn_10?: string[] }
  }>>(
    `https://openlibrary.org/api/books?bibkeys=ISBN:${clean}&format=json&jscmd=data`,
  )
  const row = data?.[`ISBN:${clean}`]
  if (!row) return null
  const isbn13 = row.identifiers?.isbn_13?.[0]
  const isbn10 = row.identifiers?.isbn_10?.[0]
  return {
    source: 'openlibrary',
    sourceId: `ISBN:${clean}`,
    title: row.title ?? '',
    authors: (row.authors ?? []).map((a) => a.name ?? '').filter(Boolean),
    isbn13,
    isbn10,
    publisher: row.publishers?.[0]?.name,
    publishYear: row.publish_date ? Number(row.publish_date.slice(0, 4)) || undefined : undefined,
    languages: [],
    coverUrl: row.cover?.large ?? row.cover?.medium ?? coverFromIsbn(clean),
    infoUrl: row.url,
    score: 1,
  }
}

export async function searchGoogleBooks(
  title: string,
  opts?: { author?: string; limit?: number },
): Promise<BookLookupCandidate[]> {
  const key = import.meta.env.VITE_GOOGLE_BOOKS_API_KEY as string | undefined
  const qParts = [`intitle:${title}`]
  if (opts?.author) qParts.push(`inauthor:${opts.author}`)
  const params = new URLSearchParams({
    q: qParts.join(' '),
    maxResults: String(opts?.limit ?? 5),
    printType: 'books',
  })
  if (key) params.set('key', key)

  const data = await fetchJson<{
    items?: Array<{
      id: string
      volumeInfo?: {
        title?: string
        authors?: string[]
        publisher?: string
        publishedDate?: string
        description?: string
        language?: string
        industryIdentifiers?: { type: string; identifier: string }[]
        imageLinks?: { thumbnail?: string; smallThumbnail?: string }
        infoLink?: string
      }
    }>
  }>(`https://www.googleapis.com/books/v1/volumes?${params}`)

  if (!data?.items) return []

  return data.items.map((item) => {
    const v = item.volumeInfo ?? {}
    const ids = v.industryIdentifiers ?? []
    const isbn13 = ids.find((i) => i.type === 'ISBN_13')?.identifier
    const isbn10 = ids.find((i) => i.type === 'ISBN_10')?.identifier
    const thumb = v.imageLinks?.thumbnail ?? v.imageLinks?.smallThumbnail
    return {
      source: 'google' as const,
      sourceId: item.id,
      title: v.title ?? title,
      authors: v.authors ?? [],
      isbn13,
      isbn10,
      publisher: v.publisher,
      publishYear: v.publishedDate ? Number(v.publishedDate.slice(0, 4)) || undefined : undefined,
      languages: v.language ? [v.language] : [],
      coverUrl: thumb?.replace('http:', 'https:'),
      description: v.description,
      infoUrl: v.infoLink,
      score: titleScore(title, v.title ?? ''),
    }
  }).filter((c) => c.score >= 0.35).sort((a, b) => b.score - a.score)
}

/** Search Open Library first; merge Google if key/quota allows. */
export async function searchBookMetadata(
  title: string,
  opts?: { author?: string },
): Promise<BookLookupCandidate[]> {
  const ol = await searchOpenLibrary(title, opts)
  let google: BookLookupCandidate[] = []
  try {
    google = await searchGoogleBooks(title, opts)
  } catch {
    /* optional */
  }

  const seen = new Set<string>()
  const merged: BookLookupCandidate[] = []
  for (const c of [...ol, ...google]) {
    const key = (c.isbn13 ?? c.isbn10 ?? `${c.source}:${c.sourceId}`).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(c)
  }
  return merged.sort((a, b) => b.score - a.score).slice(0, 10)
}

export function preferredIsbn(c: BookLookupCandidate): string | undefined {
  return c.isbn13 ?? c.isbn10
}
