/**
 * Fuzzy book search: case-insensitive, Devanagari + romanization, light typos.
 */

const DEV_TO_LATIN: [RegExp, string][] = [
  [/क्ष/g, 'ksh'],
  [/त्र/g, 'tr'],
  [/ज्ञ/g, 'gy'],
  [/श्र/g, 'shr'],
  [/क्/g, 'k'], [/ख/g, 'kh'], [/ग/g, 'g'], [/घ/g, 'gh'], [/ङ/g, 'ng'],
  [/च/g, 'ch'], [/छ/g, 'chh'], [/ज/g, 'j'], [/झ/g, 'jh'], [/ञ/g, 'ny'],
  [/ट/g, 't'], [/ठ/g, 'th'], [/ड/g, 'd'], [/ढ/g, 'dh'], [/ण/g, 'n'],
  [/त/g, 't'], [/थ/g, 'th'], [/द/g, 'd'], [/ध/g, 'dh'], [/न/g, 'n'],
  [/प/g, 'p'], [/फ/g, 'ph'], [/ब/g, 'b'], [/भ/g, 'bh'], [/म/g, 'm'],
  [/य/g, 'y'], [/र/g, 'r'], [/ल/g, 'l'], [/व/g, 'w'], [/श/g, 'sh'],
  [/ष/g, 'sh'], [/स/g, 's'], [/ह/g, 'h'],
  [/का/g, 'ka'], [/कि/g, 'ki'], [/की/g, 'ki'], [/कु/g, 'ku'], [/कू/g, 'ku'],
  [/के/g, 'ke'], [/कै/g, 'kai'], [/को/g, 'ko'], [/कौ/g, 'kau'],
  [/ा/g, 'a'], [/ि/g, 'i'], [/ी/g, 'i'], [/ु/g, 'u'], [/ू/g, 'u'],
  [/े/g, 'e'], [/ै/g, 'ai'], [/ो/g, 'o'], [/ौ/g, 'au'],
  [/ं/g, 'n'], [/ँ/g, 'n'], [/ः/g, 'h'], [/्/g, ''],
  [/०/g, '0'], [/१/g, '1'], [/२/g, '2'], [/३/g, '3'], [/४/g, '4'],
  [/५/g, '5'], [/६/g, '6'], [/७/g, '7'], [/८/g, '8'], [/९/g, '9'],
]

/** Fold case, strip accents, keep letters/digits/Devanagari, romanize Devanagari. */
export function normalizeSearch(input: string): string {
  let s = (input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')

  for (const [re, rep] of DEV_TO_LATIN) {
    s = s.replace(re, rep)
  }

  return s
    .replace(/[^a-z0-9\u0900-\u097f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const row = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) row[j] = j
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost)
      prev = tmp
    }
  }
  return row[b.length]
}

/** True if needle chars appear in order inside hay (subsequence). */
function subsequence(needle: string, hay: string): boolean {
  if (!needle) return true
  let i = 0
  for (const ch of hay) {
    if (ch === needle[i]) i++
    if (i >= needle.length) return true
  }
  return false
}

function tokenScore(qToken: string, hay: string): number {
  if (!qToken) return 1
  if (hay.includes(qToken)) return 1
  // Typo tolerance for longer tokens
  if (qToken.length >= 4) {
    const words = hay.split(' ')
    for (const w of words) {
      if (w.length < 3) continue
      const dist = levenshtein(qToken, w)
      const max = Math.max(1, Math.floor(qToken.length / 4))
      if (dist <= max) return 0.85 - dist * 0.1
    }
  }
  if (qToken.length >= 3 && subsequence(qToken, hay.replace(/\s/g, ''))) return 0.55
  return 0
}

export type FuzzyBookFields = {
  name: string
  author?: string | null
  isbn?: string | null
  publisher?: string | null
}

/** Score 0–1 how well query matches book fields. */
export function fuzzyBookScore(query: string, book: FuzzyBookFields): number {
  const q = normalizeSearch(query)
  if (!q) return 1

  const name = normalizeSearch(book.name)
  const author = normalizeSearch(book.author ?? '')
  const isbn = (book.isbn ?? '').replace(/\D/g, '')
  const publisher = normalizeSearch(book.publisher ?? '')
  const hay = [name, author, publisher].filter(Boolean).join(' ')

  const qDigits = q.replace(/\D/g, '')
  if (qDigits.length >= 8 && isbn.includes(qDigits)) return 1

  if (name === q) return 1
  if (name.startsWith(q) || name.includes(` ${q}`) || name.includes(q)) {
    return 0.95 * Math.min(1, q.length / Math.max(name.length, 1) + 0.5)
  }

  const tokens = q.split(' ').filter(Boolean)
  if (tokens.length === 0) return 0

  let sum = 0
  for (const t of tokens) {
    const s = Math.max(tokenScore(t, hay), tokenScore(t, name) * 1.05)
    if (s <= 0) return 0
    sum += s
  }
  return sum / tokens.length
}

/** Filter + rank items by fuzzy score. */
export function fuzzyFilterBooks<T extends FuzzyBookFields>(
  items: T[],
  query: string,
  opts?: { minScore?: number; limit?: number },
): T[] {
  const q = query.trim()
  const minScore = opts?.minScore ?? 0.45
  const limit = opts?.limit ?? 40
  if (!q) return items.slice(0, limit)

  const scored: { item: T; score: number }[] = []
  for (const item of items) {
    const score = fuzzyBookScore(q, item)
    if (score >= minScore) scored.push({ item, score })
  }
  scored.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
  return scored.slice(0, limit).map((s) => s.item)
}
