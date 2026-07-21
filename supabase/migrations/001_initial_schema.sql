-- Nepalaya Books — initial Supabase schema
-- Apply in Supabase SQL editor or via CLI

-- Extensions
create extension if not exists "pgcrypto";

-- ─── Helpers ─────────────────────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─── Profiles (extends auth.users) ───────────────────────────────────────────

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  role text not null check (role in ('superadmin', 'admin', 'cashier')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

alter table public.profiles enable row level security;

create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and is_active = true;
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true
      and role in ('cashier', 'admin', 'superadmin')
  );
$$;

create or replace function public.is_warehouse_ops()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true
      and role in ('admin', 'superadmin')
  );
$$;

create or replace function public.is_full_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true and role = 'superadmin'
  );
$$;

create or replace function public.is_cashier_only()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true and role = 'cashier'
  );
$$;

-- Auto-create profile stub on signup (role set by admin later)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, role, is_active)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'display_name', split_part(coalesce(new.email, 'user'), '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'cashier'),
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── Warehouses / Locations ──────────────────────────────────────────────────

create table if not exists public.warehouses (
  id text primary key,
  name text not null,
  code text not null unique,
  type text not null check (type in ('bookstore', 'primary_warehouse', 'buffer_warehouse')),
  address text,
  is_active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid
);

alter table public.warehouses enable row level security;

insert into public.warehouses (id, name, code, type, is_active, is_default) values
  ('wh-primary', 'Main Warehouse', 'PW', 'primary_warehouse', true, true),
  ('wh-buffer', 'Backroom', 'SW', 'buffer_warehouse', true, true),
  ('wh-bookstore', 'Bookstore Floor', 'BS', 'bookstore', true, true)
on conflict (id) do update set
  name = excluded.name,
  code = excluded.code,
  type = excluded.type;

-- ─── Books ───────────────────────────────────────────────────────────────────

create table if not exists public.books (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  author text,
  isbn text,
  language text not null default 'Nepali',
  category text not null default 'other',
  publisher text,
  mrp numeric(12,2) not null default 0,
  cost_price numeric(12,2) not null default 0,
  in_stock integer not null default 0,
  min_stock_alert integer not null default 5,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  deleted_by uuid
);

create index if not exists books_name_idx on public.books (name);
create index if not exists books_isbn_idx on public.books (isbn);

alter table public.books enable row level security;

drop trigger if exists books_updated_at on public.books;
create trigger books_updated_at before update on public.books
  for each row execute function public.set_updated_at();

-- ─── Book inventory (per-location) ───────────────────────────────────────────

create table if not exists public.book_inventory (
  book_id text primary key references public.books(id) on delete cascade,
  by_warehouse jsonb not null default '{}'::jsonb,
  total_warehouse_qty integer not null default 0,
  retail_qty integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.book_inventory enable row level security;

-- ─── Boxes / Cartons ─────────────────────────────────────────────────────────

create table if not exists public.boxes (
  id text primary key default gen_random_uuid()::text,
  barcode text not null unique,
  book_id text not null references public.books(id),
  book_name text not null,
  warehouse_id text not null references public.warehouses(id),
  quantity integer not null default 0,
  initial_quantity integer not null default 0,
  status text not null check (status in ('sealed', 'open', 'empty', 'in_transit')),
  shelf_location text default '',
  shelf_note text,
  batch_ref text default '',
  notes text default '',
  created_at timestamptz not null default now(),
  created_by uuid,
  opened_at timestamptz,
  is_deleted boolean not null default false
);

create index if not exists boxes_warehouse_idx on public.boxes (warehouse_id);
create index if not exists boxes_book_idx on public.boxes (book_id);
create index if not exists boxes_status_idx on public.boxes (status);

alter table public.boxes enable row level security;

-- ─── Counters (barcode seq) ──────────────────────────────────────────────────

create table if not exists public.counters (
  id text primary key,
  value integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.counters enable row level security;

-- ─── Transfers ───────────────────────────────────────────────────────────────

create table if not exists public.transfers (
  id text primary key default gen_random_uuid()::text,
  from_warehouse_id text not null references public.warehouses(id),
  to_warehouse_id text not null references public.warehouses(id),
  status text not null check (status in ('draft', 'picked', 'in_transit', 'received', 'cancelled')),
  items jsonb not null default '[]'::jsonb,
  notes text,
  created_by uuid,
  created_by_name text,
  received_by uuid,
  received_by_name text,
  created_at timestamptz not null default now(),
  picked_at timestamptz,
  received_at timestamptz
);

alter table public.transfers enable row level security;

-- ─── Inventory movements ─────────────────────────────────────────────────────

create table if not exists public.inventory_movements (
  id text primary key default gen_random_uuid()::text,
  type text not null,
  book_id text not null,
  book_name text not null,
  quantity integer not null,
  warehouse_id text,
  from_warehouse_id text,
  to_warehouse_id text,
  box_id text,
  transfer_id text,
  sale_id text,
  reason text not null default '',
  performed_by uuid,
  performed_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists inv_mov_book_idx on public.inventory_movements (book_id, created_at desc);

alter table public.inventory_movements enable row level security;

-- ─── Stock transactions ──────────────────────────────────────────────────────

create table if not exists public.stock_transactions (
  id text primary key default gen_random_uuid()::text,
  book_id text not null,
  book_name text not null,
  type text not null check (type in ('in', 'out')),
  quantity integer not null,
  previous_stock integer not null,
  new_stock integer not null,
  reason text not null,
  reference text,
  performed_by uuid,
  performed_by_name text,
  created_at timestamptz not null default now()
);

alter table public.stock_transactions enable row level security;

-- ─── Customers ───────────────────────────────────────────────────────────────

create table if not exists public.customers (
  id text primary key, -- phone
  name text not null,
  phone text not null,
  email text default '',
  total_purchases integer not null default 0,
  total_spent numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  last_purchase_at timestamptz
);

alter table public.customers enable row level security;

-- ─── Sales ───────────────────────────────────────────────────────────────────

create table if not exists public.sales (
  id text primary key default gen_random_uuid()::text,
  customer_id text,
  customer_name text not null default 'Walk-in',
  customer_phone text not null default '',
  subtotal_before_discount numeric(14,2) not null default 0,
  total_item_discounts numeric(14,2) not null default 0,
  order_discount_percent numeric(8,2) not null default 0,
  order_discount_amount numeric(14,2) not null default 0,
  total_discount_amount numeric(14,2) not null default 0,
  grand_total numeric(14,2) not null default 0,
  payment_method text not null,
  amount_paid numeric(14,2) not null default 0,
  change_given numeric(14,2) not null default 0,
  notes text,
  cashier_id uuid,
  cashier_name text,
  status text not null default 'completed',
  void_reason text,
  voided_by uuid,
  voided_at timestamptz,
  return_status text,
  returned_items jsonb,
  return_reason text,
  returned_by uuid,
  returned_at timestamptz,
  return_refund_amount numeric(14,2),
  created_at timestamptz not null default now()
);

create index if not exists sales_created_idx on public.sales (created_at desc);
create index if not exists sales_cashier_idx on public.sales (cashier_id);

alter table public.sales enable row level security;

create table if not exists public.sale_items (
  id text primary key default gen_random_uuid()::text,
  sale_id text not null references public.sales(id) on delete cascade,
  book_id text not null,
  book_name text not null,
  quantity integer not null,
  unit_price numeric(12,2) not null,
  discount_percent numeric(8,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  subtotal numeric(12,2) not null
);

create index if not exists sale_items_sale_idx on public.sale_items (sale_id);

alter table public.sale_items enable row level security;

-- ─── Discounts ───────────────────────────────────────────────────────────────

create table if not exists public.discounts (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  code text,
  type text not null check (type in ('percentage', 'fixed')),
  value numeric(12,2) not null,
  scope text not null check (scope in ('item', 'order')),
  min_purchase_amount numeric(12,2),
  max_discount_amount numeric(12,2),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz
);

alter table public.discounts enable row level security;

-- ─── Shift closes ────────────────────────────────────────────────────────────

create table if not exists public.shift_closes (
  id text primary key default gen_random_uuid()::text,
  cashier_id uuid,
  cashier_name text,
  opening_float numeric(14,2) not null default 0,
  expected_cash numeric(14,2) not null default 0,
  actual_cash numeric(14,2) not null default 0,
  variance numeric(14,2) not null default 0,
  sale_count integer not null default 0,
  total_revenue numeric(14,2) not null default 0,
  cash_sale_count integer not null default 0,
  cash_revenue numeric(14,2) not null default 0,
  notes text,
  closed_at timestamptz not null default now()
);

alter table public.shift_closes enable row level security;

-- ─── Analytics (daily) ───────────────────────────────────────────────────────

create table if not exists public.analytics (
  id text primary key, -- YYYY-MM-DD
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.analytics enable row level security;

-- ─── Audit logs ──────────────────────────────────────────────────────────────

create table if not exists public.audit_logs (
  id text primary key default gen_random_uuid()::text,
  action text not null,
  entity text not null,
  entity_id text,
  details text not null default '',
  performed_by uuid,
  performed_by_name text,
  role text,
  created_at timestamptz not null default now()
);

alter table public.audit_logs enable row level security;

-- ─── Shelf locations ─────────────────────────────────────────────────────────

create table if not exists public.shelf_locations (
  id text primary key default gen_random_uuid()::text,
  warehouse_id text not null references public.warehouses(id),
  aisle text not null,
  rack text not null,
  bin text not null,
  label text not null,
  description text,
  capacity integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid
);

alter table public.shelf_locations enable row level security;

-- ─── Stocktakes ──────────────────────────────────────────────────────────────

create table if not exists public.stocktakes (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  warehouse_id text not null references public.warehouses(id),
  status text not null check (status in ('draft', 'in_progress', 'completed', 'cancelled')),
  method text not null check (method in ('by_box', 'by_location')),
  items jsonb not null default '[]'::jsonb,
  created_by uuid,
  created_by_name text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.stocktakes enable row level security;

-- ─── RLS policies ────────────────────────────────────────────────────────────

-- Profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_warehouse_ops());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_full_admin())
  with check (
    public.is_full_admin()
    or (id = auth.uid() and role = (select role from public.profiles p where p.id = auth.uid()))
  );
create policy profiles_insert_admin on public.profiles for insert to authenticated
  with check (public.is_full_admin());

-- Warehouses
create policy warehouses_select on public.warehouses for select to authenticated using (public.is_staff());
create policy warehouses_write on public.warehouses for all to authenticated
  using (public.is_warehouse_ops()) with check (public.is_warehouse_ops());

-- Books
create policy books_select on public.books for select to authenticated using (public.is_staff());
create policy books_insert on public.books for insert to authenticated with check (public.is_warehouse_ops());
create policy books_update on public.books for update to authenticated
  using (public.is_warehouse_ops() or public.is_cashier_only())
  with check (public.is_warehouse_ops() or public.is_cashier_only());
create policy books_delete on public.books for delete to authenticated using (public.is_full_admin());

-- Book inventory
create policy book_inv_all on public.book_inventory for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Boxes
create policy boxes_select on public.boxes for select to authenticated using (public.is_staff());
create policy boxes_write on public.boxes for all to authenticated
  using (public.is_warehouse_ops()) with check (public.is_warehouse_ops());

-- Counters
create policy counters_ops on public.counters for all to authenticated
  using (public.is_warehouse_ops()) with check (public.is_warehouse_ops());

-- Transfers
create policy transfers_select on public.transfers for select to authenticated using (public.is_staff());
create policy transfers_write on public.transfers for all to authenticated
  using (public.is_warehouse_ops()) with check (public.is_warehouse_ops());

-- Movements
create policy movements_select on public.inventory_movements for select to authenticated using (public.is_staff());
create policy movements_insert on public.inventory_movements for insert to authenticated with check (public.is_staff());

-- Stock txs
create policy stock_tx_select on public.stock_transactions for select to authenticated using (public.is_warehouse_ops());
create policy stock_tx_insert on public.stock_transactions for insert to authenticated with check (public.is_staff());

-- Customers / sales
create policy customers_all on public.customers for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy sales_all on public.sales for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy sale_items_all on public.sale_items for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Discounts
create policy discounts_select on public.discounts for select to authenticated using (public.is_staff());
create policy discounts_write on public.discounts for all to authenticated
  using (public.is_warehouse_ops()) with check (public.is_warehouse_ops());

-- Shift / analytics / audit
create policy shift_select on public.shift_closes for select to authenticated using (public.is_warehouse_ops());
create policy shift_insert on public.shift_closes for insert to authenticated with check (public.is_staff());
create policy analytics_select on public.analytics for select to authenticated using (public.is_warehouse_ops());
create policy analytics_write on public.analytics for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy audit_select on public.audit_logs for select to authenticated using (public.is_warehouse_ops());
create policy audit_insert on public.audit_logs for insert to authenticated with check (public.is_staff());

-- Shelves / stocktakes
create policy shelves_select on public.shelf_locations for select to authenticated using (public.is_staff());
create policy shelves_write on public.shelf_locations for all to authenticated
  using (public.is_warehouse_ops()) with check (public.is_warehouse_ops());
create policy stocktakes_ops on public.stocktakes for all to authenticated
  using (public.is_warehouse_ops()) with check (public.is_warehouse_ops());
