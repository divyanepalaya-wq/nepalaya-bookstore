#!/usr/bin/env node
/**
 * Lean Firestore → JSON export (minimal quota pressure).
 *
 * - preferRest (lower gRPC quota hits)
 * - small pages, pause between pages/collections
 * - SKIP_EXISTING=1 resumes without re-reading done files
 * - skips users (Auth already in Supabase)
 *
 * Usage:
 *   FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccount.json \
 *   SKIP_EXISTING=1 node scripts/migrate/export-firestore-lean.mjs
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
const PAGE = Number(process.env.PAGE_SIZE || 80)
const PAGE_DELAY_MS = Number(process.env.PAGE_DELAY_MS || 400)
const COL_DELAY_MS = Number(process.env.COL_DELAY_MS || 1200)

/** Preview-critical first, then the rest */
const COLLECTIONS = [
  'warehouses',
  'books',
  'bookInventory',
  'boxes',
  'counters',
  'discounts',
  'customers',
  'sales',
  'transfers',
  'inventoryMovements',
  'stockTransactions',
  'shiftCloses',
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

async function withRetry(fn, label, attempts = 10) {
  let delay = 5000
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      const msg = String(e?.message ?? e)
      const quota =
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('Quota exceeded') ||
        msg.includes('429') ||
        e?.code === 8
      if (!quota || i === attempts) throw e
      console.warn(`  ${label}: quota, wait ${Math.round(delay / 1000)}s (${i}/${attempts})`)
      await sleep(delay)
      delay = Math.min(Math.round(delay * 1.6), 90000)
    }
  }
}

async function exportCollection(db, name) {
  const rows = []
  let query = db.collection(name).orderBy('__name__').limit(PAGE)
  for (;;) {
    const snap = await withRetry(() => query.get(), name)
    if (snap.empty) break
    for (const d of snap.docs) {
      rows.push({ id: d.id, ...serialize(d.data()) })
    }
    process.stdout.write(`\r  ${name}: ${rows.length} docs`)
    if (snap.size < PAGE) break
    const last = snap.docs[snap.docs.length - 1]
    query = db.collection(name).orderBy('__name__').startAfter(last).limit(PAGE)
    await sleep(PAGE_DELAY_MS)
  }
  if (rows.length) process.stdout.write('\n')
  return rows
}

async function main() {
  const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || join(process.cwd(), 'serviceAccount.json')
  const sa = JSON.parse(readFileSync(saPath, 'utf8'))
  if (!getApps().length) initializeApp({ credential: cert(sa) })
  const db = getFirestore()
  db.settings({ preferRest: true, ignoreUndefinedProperties: true })
  mkdirSync(outDir, { recursive: true })

  const skip = process.env.SKIP_EXISTING === '1'
  for (const name of COLLECTIONS) {
    const outFile = join(outDir, `${name}.json`)
    if (skip && existsSync(outFile)) {
      const n = JSON.parse(readFileSync(outFile, 'utf8')).length
      console.log(`skip ${name} (${n} docs already)`)
      continue
    }
    console.log(`Exporting ${name}…`)
    const rows = await exportCollection(db, name)
    writeFileSync(outFile, JSON.stringify(rows))
    console.log(`  → ${rows.length} docs written`)
    await sleep(COL_DELAY_MS)
  }
  console.log('Done → scripts/migrate/data/')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
