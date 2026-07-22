-- Enrichment fields for catalog matching (Open Library / manual lock)
alter table public.books
  add column if not exists cover_url text,
  add column if not exists isbn_locked boolean not null default false,
  add column if not exists metadata_source text;

comment on column public.books.cover_url is 'Remote cover image URL (e.g. Open Library covers)';
comment on column public.books.isbn_locked is 'When true, auto-enrich must not overwrite ISBN';
comment on column public.books.metadata_source is 'Last accepted metadata source, e.g. openlibrary:OL123M';
