#!/usr/bin/env node
/**
 * Export Firebase Auth users (emails + UIDs). Password hashes require:
 *   firebase auth:export scripts/migrate/data/auth-users.json --format=json --project nepalaya-bookstore
 *
 * This script dumps basic user list via Admin SDK (no password hashes).
 *
 * Usage:
 *   node scripts/migrate/export-auth.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { initializeApp, cert, getApps } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, 'data')

async function main() {
  const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || join(process.cwd(), 'serviceAccount.json')
  const sa = JSON.parse(readFileSync(saPath, 'utf8'))
  if (!getApps().length) {
    initializeApp({ credential: cert(sa) })
  }

  mkdirSync(outDir, { recursive: true })
  const auth = getAuth()
  const users = []
  let nextPageToken
  do {
    const res = await auth.listUsers(1000, nextPageToken)
    for (const u of res.users) {
      users.push({
        uid: u.uid,
        email: u.email,
        displayName: u.displayName,
        disabled: u.disabled,
        emailVerified: u.emailVerified,
        createdAt: u.metadata?.creationTime,
      })
    }
    nextPageToken = res.pageToken
  } while (nextPageToken)

  writeFileSync(join(outDir, 'auth-users-basic.json'), JSON.stringify(users, null, 2))
  console.log(`Exported ${users.length} auth users → auth-users-basic.json`)
  console.log('For password hashes, also run: firebase auth:export scripts/migrate/data/auth-users.json --format=json')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
