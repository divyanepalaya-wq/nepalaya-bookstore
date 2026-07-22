# Production data migration (Firebase → Supabase)

Auth users are **not** migrated — create them manually in Supabase first.
The import only maps Firebase UIDs → existing Supabase users **by email** for `createdBy` / `cashierId` fields.

## Prerequisites

1. Apply SQL in Supabase SQL editor (in order):
   - `supabase/migrations/001_initial_schema.sql`
   - `supabase/migrations/002_rpcs.sql`
2. Enable Email auth in Supabase Dashboard → Authentication
3. Deploy Edge Function:
   ```bash
   npx supabase functions deploy create-staff-user --project-ref fhvgfuzqqaqluljzvxnq
   ```
4. Service account for Firebase export: `serviceAccount.json` (gitignored)

## Steps (when Firestore quota allows)

```bash
# Lean export (preferred — small pages, resume, skips users)
export FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccount.json
SKIP_EXISTING=1 node scripts/migrate/export-firestore-lean.mjs

# Import (maps emails to existing Auth users — does not create accounts)
export SUPABASE_URL=https://fhvgfuzqqaqluljzvxnq.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
node scripts/migrate/import-supabase.mjs
node scripts/migrate/verify.mjs
```

Full export (same data, older script): `node scripts/migrate/export-firestore.mjs`

If export hits `RESOURCE_EXHAUSTED` / `429 Quota exceeded`, wait for the Firestore free-tier quota to reset (usually daily, Pacific time) or enable billing on the Firebase/Google Cloud project, then re-run with `SKIP_EXISTING=1`.

## Cutover

1. Maintenance window — freeze Firebase writes  
2. Final export → import → verify  
3. Deploy app with `VITE_SUPABASE_*` env  
4. Smoke: login → receive → transfer → put on sale → POS  
5. Keep Firebase read-only 2–4 weeks  
