#!/usr/bin/env node
/**
 * One-shot bulk ISBN enrich: only auto-accept exact (100%) title matches that have an ISBN.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   [VITE_GOOGLE_BOOKS_API_KEY=...] node scripts/migrate/bulk-isbn-exact.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const googleKey = process.env.VITE_GOOGLE_BOOKS_API_KEY || process.env.GOOGLE_BOOKS_API_KEY

if (!url || !key) {
  console.error('Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
const DELAY_MS = 350
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u0900-\u097f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function titleScore(query, title) {
  const a = norm(query)
  const b = norm(title)
  if (!a || !b) return 0
  if (a === b) return 1
  return 0 // bulk run: exact only
}

function pickIsbn(isbns) {
  if (!isbns?.length) return {}
  const clean = isbns.map((x) => String(x).replace(/[^0-9Xx]/g, ''))
  return {
    isbn13: clean.find((x) => x.length === 13),
    isbn10: clean.find((x) => x.length === 10),
  }
}

async function fetchJson(u) {
  const res = await fetch(u, { headers: { Accept: 'application/json' } })
  if (!res.ok) return null
  return res.json()
}

async function searchOpenLibrary(title) {
  const params = new URLSearchParams({
    q: `title:${title}`,
    limit: '10',
    fields: 'key,title,author_name,isbn,cover_i,publisher,language,first_publish_year',
  })
  const data = await fetchJson(`https://openlibrary.org/search.json?${params}`)
  return (data?.docs ?? [])
    .map((doc) => {
      const { isbn13, isbn10 } = pickIsbn(doc.isbn)
      const score = titleScore(title, doc.title ?? '')
      const isbn = isbn13 || isbn10
      return {
        source: 'openlibrary',
        sourceId: doc.key,
        title: doc.title,
        authors: doc.author_name ?? [],
        publisher: doc.publisher?.[0],
        isbn,
        coverUrl: doc.cover_i
          ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
          : isbn
            ? `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`
            : undefined,
        score,
      }
    })
    .filter((c) => c.score === 1 && c.isbn)
}

async function searchGoogle(title) {
  if (!googleKey) return []
  const params = new URLSearchParams({
    q: `intitle:${title}`,
    maxResults: '5',
    printType: 'books',
    key: googleKey,
  })
  const data = await fetchJson(`https://www.googleapis.com/books/v1/volumes?${params}`)
  return (data?.items ?? [])
    .map((item) => {
      const v = item.volumeInfo ?? {}
      const ids = v.industryIdentifiers ?? []
      const isbn13 = ids.find((i) => i.type === 'ISBN_13')?.identifier
      const isbn10 = ids.find((i) => i.type === 'ISBN_10')?.identifier
      const isbn = isbn13 || isbn10
      const score = titleScore(title, v.title ?? '')
      const thumb = v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail
      return {
        source: 'google',
        sourceId: item.id,
        title: v.title,
        authors: v.authors ?? [],
        publisher: v.publisher,
        description: v.description,
        isbn,
        coverUrl: thumb?.replace('http:', 'https:'),
        score,
      }
    })
    .filter((c) => c.score === 1 && c.isbn)
}

function uniqueExact(candidates) {
  const byIsbn = new Map()
  for (const c of candidates) {
    if (!byIsbn.has(c.isbn)) byIsbn.set(c.isbn, c)
  }
  return [...byIsbn.values()]
}

async function main() {
  const { data: books, error } = await sb
    .from('books')
    .select('id,name,author,isbn,isbn_locked,cover_url,description,publisher,is_deleted')
    .eq('is_deleted', false)
  if (error) throw error

  const targets = (books ?? []).filter(
    (b) => !b.isbn_locked && (!b.isbn || !String(b.isbn).trim()),
  )
  console.log(`Books without ISBN (unlocked): ${targets.length}`)

  const report = { accepted: [], skipped: [], errors: [] }

  for (let i = 0; i < targets.length; i++) {
    const book = targets[i]
    process.stdout.write(`[${i + 1}/${targets.length}] ${book.name.slice(0, 50)}… `)
    try {
      const ol = await searchOpenLibrary(book.name)
      await sleep(DELAY_MS)
      let google = []
      try {
        google = await searchGoogle(book.name)
        await sleep(200)
      } catch {
        /* ignore google errors */
      }

      const exact = uniqueExact([...ol, ...google])
      if (exact.length === 0) {
        console.log('no 100% match')
        report.skipped.push({ id: book.id, name: book.name, reason: 'no_exact' })
        continue
      }
      if (exact.length > 1) {
        console.log(`ambiguous (${exact.length} ISBNs)`)
        report.skipped.push({
          id: book.id,
          name: book.name,
          reason: 'ambiguous',
          isbns: exact.map((c) => c.isbn),
        })
        continue
      }

      const hit = exact[0]
      const patch = {
        isbn: hit.isbn,
        isbn_locked: true,
        metadata_source: `${hit.source}:${hit.sourceId}:bulk-exact`,
        updated_at: new Date().toISOString(),
      }
      if (!book.author && hit.authors?.[0]) patch.author = hit.authors.join(', ')
      if (!book.publisher && hit.publisher) patch.publisher = hit.publisher
      if (!book.cover_url && hit.coverUrl) patch.cover_url = hit.coverUrl
      if (!book.description && hit.description) patch.description = hit.description

      const { error: uerr } = await sb.from('books').update(patch).eq('id', book.id)
      if (uerr) throw uerr

      console.log(`OK ${hit.isbn} (${hit.source})`)
      report.accepted.push({
        id: book.id,
        name: book.name,
        isbn: hit.isbn,
        source: hit.source,
        matchedTitle: hit.title,
      })
    } catch (e) {
      console.log(`ERR ${e.message}`)
      report.errors.push({ id: book.id, name: book.name, error: e.message })
      await sleep(1000)
    }
  }

  const outDir = join(__dirname, 'data')
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, 'bulk-isbn-exact-report.json')
  writeFileSync(outPath, JSON.stringify(report, null, 2))

  console.log('\n=== Done ===')
  console.log(`Accepted: ${report.accepted.length}`)
  console.log(`Skipped:  ${report.skipped.length}`)
  console.log(`Errors:   ${report.errors.length}`)
  console.log(`Report:   ${outPath}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
