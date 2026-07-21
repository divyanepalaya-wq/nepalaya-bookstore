#!/usr/bin/env node
/**
 * Spot-check row counts after import.
 *
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate/verify.mjs
 */

import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

const tables = [
  'profiles',
  'warehouses',
  'books',
  'book_inventory',
  'boxes',
  'transfers',
  'sales',
  'sale_items',
  'customers',
  'discounts',
  'inventory_movements',
  'counters',
]

async function count(table) {
  const { count, error } = await sb.from(table).select('*', { count: 'exact', head: true })
  if (error) return `ERR ${error.message}`
  return count
}

async function main() {
  console.log('Supabase row counts:')
  for (const t of tables) {
    console.log(`  ${t.padEnd(24)} ${await count(t)}`)
  }

  const { data: openTransfers } = await sb
    .from('transfers')
    .select('id', { count: 'exact', head: true })
    .in('status', ['draft', 'picked', 'in_transit'])
  console.log('\nOpen transfers:', openTransfers)

  const { data: inv } = await sb.from('book_inventory').select('retail_qty')
  const retail = (inv ?? []).reduce((s, r) => s + (r.retail_qty ?? 0), 0)
  console.log('Sum retail_qty:', retail)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
