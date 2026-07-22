-- Vendors for third-party Nepali / English stock-in.

create table if not exists public.vendors (
  id text primary key default replace(gen_random_uuid()::text, '-', ''),
  name text not null,
  phone text,
  contact_person text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create index if not exists vendors_active_name_idx on public.vendors (is_active, name);

alter table public.vendors enable row level security;

drop policy if exists vendors_select on public.vendors;
create policy vendors_select on public.vendors for select to authenticated
  using (public.is_staff());

drop policy if exists vendors_write on public.vendors;
create policy vendors_write on public.vendors for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

alter table public.inventory_movements
  add column if not exists vendor_id text;

alter table public.inventory_movements
  add column if not exists vendor_name text;
