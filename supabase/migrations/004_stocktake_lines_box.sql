-- Nepalaya Books — stocktake_lines box columns
-- Adds optional carton linkage to stocktake_lines for `by_box` stocktakes.
-- Apply after 003_reliability.sql

alter table public.stocktake_lines
  add column if not exists box_id text,
  add column if not exists box_barcode text;

create index if not exists stocktake_lines_box_idx on public.stocktake_lines (box_id) where box_id is not null;
