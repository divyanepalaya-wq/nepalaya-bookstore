-- Expand staff roles + update permission helpers.
-- Existing: superadmin | admin | cashier
-- Added: warehouse (carton ops), receptionist (sell + vendor receive)

alter table public.profiles drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('superadmin', 'admin', 'warehouse', 'cashier', 'receptionist'));

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and is_active = true
      and role in ('cashier', 'receptionist', 'admin', 'warehouse', 'superadmin')
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
    where id = auth.uid()
      and is_active = true
      and role in ('admin', 'warehouse', 'superadmin')
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
    where id = auth.uid()
      and is_active = true
      and role = 'superadmin'
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
    where id = auth.uid()
      and is_active = true
      and role in ('cashier', 'receptionist')
  );
$$;

create or replace function public.can_sell()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and is_active = true
      and role in ('cashier', 'receptionist', 'admin', 'warehouse', 'superadmin')
  );
$$;

create or replace function public.can_vendor_receive()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and is_active = true
      and role in ('receptionist', 'admin', 'warehouse', 'superadmin')
  );
$$;
