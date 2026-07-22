#!/usr/bin/env node
/**
 * Export all Firestore collections to scripts/migrate/data/*.json
 *
 * Prerequisites:
 *   npm i -D firebase-admin
 *   Place service account JSON at FIREBASE_SERVICE_ACCOUNT_PATH (default ./serviceAccount.json)
 *
 * Usage:
 *   node scripts/migrate/export-firestore.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { initializeApp, cert, getApps } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, 'data')

// Skip `users` — Auth/profiles already set up manually in Supabase
const COLLECTIONS = [
  'books',
  'bookInventory',
  'warehouses',
  'boxes',
  'transfers',
  'inventoryMovements',
  'counters',
  'sales',
  'customers',
  'discounts',
  'shiftCloses',
  'stockTransactions',
  'stocktakes',
  'shelfLocations',
  'analytics',
  'auditLogs',
]

function serialize(value) {
  if (value == null) return value
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  if (Array.isArray(value)) return value.map(serialize)
  if (typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = serialize(v)
    return out
  }
  return value
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function withRetry(fn, label, attempts = 12) {
  let delay = 10000
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      const msg = String(e?.message ?? e)
      const quota = msg.includes('RESOURCE_EXHAUSTED') || msg.includes('Quota exceeded') || msg.includes('429')
      if (!quota || i === attempts) throw e
      console.warn(`  ${label}: quota hit, retry ${i}/${attempts} in ${Math.round(delay / 1000)}s…`)
      await sleep(delay)
      delay = Math.min(delay * 1.5, 120000)
    }
  }
}

async function exportCollection(db, name) {
  const rows = []
  let query = db.collection(name).orderBy('__name__').limit(200)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = await withRetry(() => query.get(), name)
    if (snap.empty) break
    for (const d of snap.docs) {
      rows.push({ id: d.id, ...serialize(d.data()) })
    }
    if (snap.size < 200) break
    const last = snap.docs[snap.docs.length - 1]
    query = db.collection(name).orderBy('__name__').startAfter(last).limit(200)
    await sleep(250)
  }
  return rows
}

async function main() {
  const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || join(process.cwd(), 'serviceAccount.json')
  const sa = JSON.parse(readFileSync(saPath, 'utf8'))
  if (!getApps().length) {
    initializeApp({ credential: cert(sa) })
  }
  const db = getFirestore()
  db.settings({ preferRest: true })
  mkdirSync(outDir, { recursive: true })

  for (const name of COLLECTIONS) {
    const outFile = join(outDir, `${name}.json`)
    if (existsSync(outFile) && process.env.SKIP_EXISTING === '1') {
      console.log(`Skipping ${name} (already exported)`)
      continue
    }
    console.log(`Exporting ${name}…`)
    const rows = await exportCollection(db, name)
    writeFileSync(outFile, JSON.stringify(rows, null, 2))
    console.log(`  → ${rows.length} docs`)
    await sleep(1500)
  }

  console.log('Done. Files in scripts/migrate/data/')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
