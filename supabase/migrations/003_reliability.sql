-- Nepalaya Books — reliability migration
-- Idempotent RPCs, audit-on-write, stocktake line items, tighter grants, and
-- new transfer / return / split-box / stocktake RPCs.
-- Apply in Supabase SQL editor or via CLI (after 001_initial_schema.sql, 002_rpcs.sql)

-- ─── Idempotency store ────────────────────────────────────────────────────────
--
-- Clients pass an optional `p_client_request_id` (a uuid generated once per
-- user action, e.g. on button click) to any mutating RPC below. If the same
-- request id is replayed (double-tap, retry after timeout, etc.) the RPC
-- returns the cached result instead of re-running its side effects.

create table if not exists public.rpc_idempotency (
  request_id uuid primary key,
  user_id uuid,
  action text not null,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists rpc_idempotency_created_idx on public.rpc_idempotency (created_at desc);

alter table public.rpc_idempotency enable row level security;

drop policy if exists rpc_idempotency_select on public.rpc_idempotency;
create policy rpc_idempotency_select on public.rpc_idempotency for select to authenticated
  using (public.is_warehouse_ops());

-- ─── Supporting indexes ───────────────────────────────────────────────────────

create index if not exists transfers_status_created_idx on public.transfers (status, created_at desc);
create index if not exists boxes_warehouse_status_idx on public.boxes (warehouse_id, status) where not is_deleted;
create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);
create index if not exists inv_mov_sale_idx on public.inventory_movements (sale_id) where sale_id is not null;
create index if not exists inv_mov_transfer_idx on public.inventory_movements (transfer_id) where transfer_id is not null;

-- ─── Stocktake lines (normalized, one row per counted item) ──────────────────
--
-- `stocktakes.items` (jsonb) remains as a fallback for stocktakes created
-- before this migration; new counts should be written to `stocktake_lines`.

create table if not exists public.stocktake_lines (
  id text primary key default gen_random_uuid()::text,
  stocktake_id text not null references public.stocktakes(id) on delete cascade,
  line_index integer not null,
  book_id text not null,
  book_name text not null,
  warehouse_id text not null,
  shelf_location text default '',
  expected_qty integer not null default 0,
  counted_qty integer,
  counted_by uuid,
  counted_by_name text,
  counted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (stocktake_id, line_index)
);

create index if not exists stocktake_lines_stocktake_idx on public.stocktake_lines (stocktake_id);

alter table public.stocktake_lines enable row level security;

drop policy if exists stocktake_lines_ops on public.stocktake_lines;
create policy stocktake_lines_ops on public.stocktake_lines for all to authenticated
  using (public.is_warehouse_ops()) with check (public.is_warehouse_ops());

-- ─── Lock down low-level primitives ───────────────────────────────────────────
--
-- `apply_inventory_delta` and `next_box_seqs` are internal building blocks
-- used by the RPCs below (which run SECURITY DEFINER, so they keep working).
-- Direct client calls are no longer allowed — every mutation must go through
-- a higher-level RPC that also validates, records movements, and audits.

revoke execute on function public.apply_inventory_delta from authenticated, anon, public;
revoke execute on function public.next_box_seqs from authenticated, anon, public;

-- ─── Helpers: audit + idempotency ─────────────────────────────────────────────

create or replace function public.write_audit(
  p_action text,
  p_entity text,
  p_entity_id text,
  p_details text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_role text;
begin
  select display_name, role into v_name, v_role from public.profiles where id = v_uid;
  insert into public.audit_logs (action, entity, entity_id, details, performed_by, performed_by_name, role)
  values (p_action, p_entity, p_entity_id, coalesce(p_details, ''), v_uid, v_name, v_role);
end;
$$;

create or replace function public.idempotency_get(p_request_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select result from public.rpc_idempotency where request_id = p_request_id;
$$;

create or replace function public.idempotency_put(
  p_request_id uuid,
  p_user_id uuid,
  p_action text,
  p_result jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.rpc_idempotency (request_id, user_id, action, result)
  values (p_request_id, p_user_id, p_action, p_result)
  on conflict (request_id) do nothing;
end;
$$;

-- ─── Replace: receive_cartons (+ idempotency, + audit) ───────────────────────

drop function if exists public.receive_cartons(text, text, text, text, text, integer, integer, text, text, text);

create or replace function public.receive_cartons(
  p_book_id text,
  p_book_name text,
  p_warehouse_id text,
  p_warehouse_code text,
  p_bookstore_id text,
  p_total_quantity integer,
  p_copies_per_box integer,
  p_batch_ref text default '',
  p_shelf_location text default '',
  p_notes text default '',
  p_client_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full integer;
  v_rem integer;
  v_sizes integer[];
  v_statuses text[];
  v_seqs integer[];
  v_i integer;
  v_barcode text;
  v_box_id text;
  v_created jsonb := '[]'::jsonb;
  v_uid uuid := auth.uid();
  v_name text;
  v_status text;
  v_qty integer;
  v_notes text;
  v_cached jsonb;
  v_result jsonb;
begin
  if not public.is_warehouse_ops() then
    raise exception 'Not authorized';
  end if;
  if p_total_quantity <= 0 or p_copies_per_box <= 0 then
    raise exception 'Invalid quantities';
  end if;

  if p_client_request_id is not null then
    v_cached := public.idempotency_get(p_client_request_id);
    if v_cached is not null then
      return v_cached;
    end if;
  end if;

  select display_name into v_name from public.profiles where id = v_uid;

  v_full := p_total_quantity / p_copies_per_box;
  v_rem := p_total_quantity % p_copies_per_box;
  v_sizes := array[]::integer[];
  v_statuses := array[]::text[];
  for v_i in 1..v_full loop
    v_sizes := array_append(v_sizes, p_copies_per_box);
    v_statuses := array_append(v_statuses, 'sealed');
  end loop;
  if v_rem > 0 then
    v_sizes := array_append(v_sizes, v_rem);
    v_statuses := array_append(v_statuses, 'open');
  end if;

  v_seqs := public.next_box_seqs(p_warehouse_code, array_length(v_sizes, 1));
  perform public.apply_inventory_delta(p_book_id, p_warehouse_id, p_bookstore_id, p_total_quantity);

  for v_i in 1..array_length(v_sizes, 1) loop
    v_qty := v_sizes[v_i];
    v_status := v_statuses[v_i];
    v_barcode := 'NPBX-' || upper(p_warehouse_code) || '-' || lpad(v_seqs[v_i]::text, 6, '0');
    v_box_id := gen_random_uuid()::text;
    v_notes := case when v_status = 'open' then trim(both ' · ' from coalesce(p_notes,'') || ' · loose') else coalesce(p_notes,'') end;

    insert into public.boxes (
      id, barcode, book_id, book_name, warehouse_id, quantity, initial_quantity,
      status, shelf_location, batch_ref, notes, created_by, opened_at, is_deleted
    ) values (
      v_box_id, v_barcode, p_book_id, p_book_name, p_warehouse_id, v_qty, v_qty,
      v_status, coalesce(p_shelf_location,''), coalesce(p_batch_ref,''), v_notes, v_uid,
      case when v_status = 'open' then now() else null end, false
    );

    insert into public.inventory_movements (
      type, book_id, book_name, quantity, warehouse_id, box_id, reason,
      performed_by, performed_by_name
    ) values (
      'receive', p_book_id, p_book_name, v_qty, p_warehouse_id, v_box_id,
      case when v_status = 'open' then 'Receive loose copies (open carton)' else 'Receive into warehouse' end,
      v_uid, v_name
    );

    v_created := v_created || jsonb_build_array(jsonb_build_object(
      'id', v_box_id, 'barcode', v_barcode, 'quantity', v_qty
    ));
  end loop;

  v_result := jsonb_build_object('boxes', v_created);

  perform public.write_audit('box_created', 'box', null,
    format('Received %s x "%s" into %s carton(s) at %s', p_total_quantity, p_book_name, array_length(v_sizes,1), p_warehouse_code));

  if p_client_request_id is not null then
    perform public.idempotency_put(p_client_request_id, v_uid, 'receive_cartons', v_result);
  end if;

  return v_result;
end;
$$;

-- ─── Replace: put_on_sale (now returns jsonb, + idempotency, + audit) ────────

drop function if exists public.put_on_sale(text, integer, text);

create or replace function public.put_on_sale(
  p_box_id text,
  p_quantity integer,
  p_bookstore_id text,
  p_client_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_box public.boxes%rowtype;
  v_uid uuid := auth.uid();
  v_name text;
  v_remain integer;
  v_cached jsonb;
  v_result jsonb;
begin
  if not public.is_warehouse_ops() then
    raise exception 'Not authorized';
  end if;
  if p_quantity <= 0 then raise exception 'Quantity must be positive'; end if;

  if p_client_request_id is not null then
    v_cached := public.idempotency_get(p_client_request_id);
    if v_cached is not null then
      return v_cached;
    end if;
  end if;

  select display_name into v_name from public.profiles where id = v_uid;
  select * into v_box from public.boxes where id = p_box_id for update;
  if not found then raise exception 'Box not found'; end if;
  if v_box.status in ('empty', 'in_transit') then raise exception 'Box is %', v_box.status; end if;
  if v_box.quantity < p_quantity then raise exception 'Box only has %', v_box.quantity; end if;

  perform public.apply_inventory_delta(v_box.book_id, v_box.warehouse_id, p_bookstore_id, -p_quantity);
  perform public.apply_inventory_delta(v_box.book_id, p_bookstore_id, p_bookstore_id, p_quantity);

  v_remain := v_box.quantity - p_quantity;
  update public.boxes set
    quantity = v_remain,
    status = case when v_remain = 0 then 'empty' else 'open' end,
    opened_at = coalesce(opened_at, now())
  where id = p_box_id;

  insert into public.inventory_movements (
    type, book_id, book_name, quantity, from_warehouse_id, to_warehouse_id, box_id, reason,
    performed_by, performed_by_name
  ) values (
    'replenish_retail', v_box.book_id, v_box.book_name, p_quantity,
    v_box.warehouse_id, p_bookstore_id, p_box_id, 'Put on sale',
    v_uid, v_name
  );

  v_result := jsonb_build_object(
    'boxId', p_box_id,
    'remainingQuantity', v_remain,
    'status', case when v_remain = 0 then 'empty' else 'open' end
  );

  perform public.write_audit('replenish_retail', 'box', p_box_id,
    format('Replenished %s units to bookstore floor', p_quantity));

  if p_client_request_id is not null then
    perform public.idempotency_put(p_client_request_id, v_uid, 'put_on_sale', v_result);
  end if;

  return v_result;
end;
$$;

-- ─── Replace: pick_transfer (now returns jsonb, + idempotency, + audit) ──────

drop function if exists public.pick_transfer(text, text);

create or replace function public.pick_transfer(
  p_transfer_id text,
  p_bookstore_id text,
  p_client_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t public.transfers%rowtype;
  v_item jsonb;
  v_box public.boxes%rowtype;
  v_uid uuid := auth.uid();
  v_name text;
  v_qty integer;
  v_count integer := 0;
  v_cached jsonb;
  v_result jsonb;
begin
  if not public.is_warehouse_ops() then raise exception 'Not authorized'; end if;

  if p_client_request_id is not null then
    v_cached := public.idempotency_get(p_client_request_id);
    if v_cached is not null then
      return v_cached;
    end if;
  end if;

  select display_name into v_name from public.profiles where id = v_uid;
  select * into v_t from public.transfers where id = p_transfer_id for update;
  if not found then raise exception 'Transfer not found'; end if;
  if v_t.status <> 'draft' then raise exception 'Cannot pick transfer in status %', v_t.status; end if;

  for v_item in select * from jsonb_array_elements(v_t.items) loop
    select * into v_box from public.boxes where id = v_item->>'boxId' for update;
    if not found then raise exception 'Box % not found', v_item->>'barcode'; end if;
    if v_box.status in ('in_transit', 'empty') then raise exception 'Box is %', v_box.status; end if;
    if v_box.warehouse_id <> v_t.from_warehouse_id then raise exception 'Box not at source'; end if;
    v_qty := v_box.quantity;
    if v_qty <= 0 then raise exception 'Box empty'; end if;

    perform public.apply_inventory_delta(v_box.book_id, v_t.from_warehouse_id, p_bookstore_id, -v_qty);
    update public.boxes set status = 'in_transit' where id = v_box.id;

    insert into public.inventory_movements (
      type, book_id, book_name, quantity, from_warehouse_id, to_warehouse_id,
      box_id, transfer_id, warehouse_id, reason, performed_by, performed_by_name
    ) values (
      'transfer_out', v_box.book_id, v_box.book_name, -v_qty,
      v_t.from_warehouse_id, v_t.to_warehouse_id, v_box.id, p_transfer_id,
      v_t.from_warehouse_id, 'Transfer pick', v_uid, v_name
    );
    v_count := v_count + 1;
  end loop;

  update public.transfers set status = 'in_transit', picked_at = now() where id = p_transfer_id;

  v_result := jsonb_build_object('transferId', p_transfer_id, 'status', 'in_transit', 'boxesPicked', v_count);

  perform public.write_audit('transfer_picked', 'transfer', p_transfer_id, 'Transfer picked / in transit');

  if p_client_request_id is not null then
    perform public.idempotency_put(p_client_request_id, v_uid, 'pick_transfer', v_result);
  end if;

  return v_result;
end;
$$;

-- ─── Replace: receive_transfer (now returns jsonb, + idempotency, + audit) ───

drop function if exists public.receive_transfer(text, text);

create or replace function public.receive_transfer(
  p_transfer_id text,
  p_bookstore_id text,
  p_client_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t public.transfers%rowtype;
  v_item jsonb;
  v_box public.boxes%rowtype;
  v_uid uuid := auth.uid();
  v_name text;
  v_qty integer;
  v_count integer := 0;
  v_cached jsonb;
  v_result jsonb;
begin
  if not public.is_warehouse_ops() then raise exception 'Not authorized'; end if;

  if p_client_request_id is not null then
    v_cached := public.idempotency_get(p_client_request_id);
    if v_cached is not null then
      return v_cached;
    end if;
  end if;

  select display_name into v_name from public.profiles where id = v_uid;
  select * into v_t from public.transfers where id = p_transfer_id for update;
  if not found then raise exception 'Transfer not found'; end if;
  if v_t.status not in ('in_transit', 'picked') then
    raise exception 'Cannot receive transfer in status %', v_t.status;
  end if;

  for v_item in select * from jsonb_array_elements(v_t.items) loop
    select * into v_box from public.boxes where id = v_item->>'boxId' for update;
    if not found then raise exception 'Box % not found', v_item->>'barcode'; end if;
    v_qty := v_box.quantity;
    if v_qty <= 0 then raise exception 'Box empty'; end if;

    perform public.apply_inventory_delta(v_box.book_id, v_t.to_warehouse_id, p_bookstore_id, v_qty);
    update public.boxes set
      warehouse_id = v_t.to_warehouse_id,
      status = case when v_qty < initial_quantity then 'open' else 'sealed' end
    where id = v_box.id;

    insert into public.inventory_movements (
      type, book_id, book_name, quantity, from_warehouse_id, to_warehouse_id,
      box_id, transfer_id, warehouse_id, reason, performed_by, performed_by_name
    ) values (
      'transfer_in', v_box.book_id, v_box.book_name, v_qty,
      v_t.from_warehouse_id, v_t.to_warehouse_id, v_box.id, p_transfer_id,
      v_t.to_warehouse_id, 'Transfer receive', v_uid, v_name
    );
    v_count := v_count + 1;
  end loop;

  update public.transfers set
    status = 'received',
    received_by = v_uid,
    received_by_name = v_name,
    received_at = now()
  where id = p_transfer_id;

  v_result := jsonb_build_object('transferId', p_transfer_id, 'status', 'received', 'boxesReceived', v_count);

  perform public.write_audit('transfer_received', 'transfer', p_transfer_id, 'Transfer received at destination');

  if p_client_request_id is not null then
    perform public.idempotency_put(p_client_request_id, v_uid, 'receive_transfer', v_result);
  end if;

  return v_result;
end;
$$;

-- ─── Replace: complete_sale (+ idempotency, + audit) ─────────────────────────

drop function if exists public.complete_sale(text, text, jsonb, jsonb, text, numeric, numeric, text, text);

create or replace function public.complete_sale(
  p_customer_name text,
  p_customer_phone text,
  p_items jsonb,
  p_totals jsonb,
  p_payment_method text,
  p_amount_paid numeric,
  p_change_given numeric,
  p_notes text,
  p_bookstore_id text,
  p_client_request_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_sale_id text := gen_random_uuid()::text;
  v_item jsonb;
  v_book_id text;
  v_qty integer;
  v_book_name text;
  v_prev integer;
  v_cached jsonb;
begin
  if not public.is_staff() then raise exception 'Not authorized'; end if;

  if p_client_request_id is not null then
    v_cached := public.idempotency_get(p_client_request_id);
    if v_cached is not null then
      return v_cached #>> '{}';
    end if;
  end if;

  select display_name into v_name from public.profiles where id = v_uid;

  -- Validate + deduct stock
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_book_id := v_item->>'bookId';
    v_qty := (v_item->>'quantity')::integer;
    v_book_name := v_item->>'bookName';
    perform public.apply_inventory_delta(v_book_id, p_bookstore_id, p_bookstore_id, -v_qty);

    select in_stock into v_prev from public.books where id = v_book_id;
    insert into public.stock_transactions (
      book_id, book_name, type, quantity, previous_stock, new_stock, reason,
      performed_by, performed_by_name
    ) values (
      v_book_id, v_book_name, 'out', v_qty, coalesce(v_prev,0) + v_qty, coalesce(v_prev,0),
      'POS Sale', v_uid, v_name
    );

    insert into public.inventory_movements (
      type, book_id, book_name, quantity, warehouse_id, sale_id, reason,
      performed_by, performed_by_name
    ) values (
      'sale', v_book_id, v_book_name, -v_qty, p_bookstore_id, v_sale_id, 'POS Sale',
      v_uid, v_name
    );
  end loop;

  insert into public.sales (
    id, customer_id, customer_name, customer_phone,
    subtotal_before_discount, total_item_discounts, order_discount_percent,
    order_discount_amount, total_discount_amount, grand_total,
    payment_method, amount_paid, change_given, notes,
    cashier_id, cashier_name, status
  ) values (
    v_sale_id,
    nullif(p_customer_phone, ''),
    coalesce(nullif(p_customer_name,''), 'Walk-in'),
    coalesce(p_customer_phone, ''),
    coalesce((p_totals->>'subtotalBeforeDiscount')::numeric, 0),
    coalesce((p_totals->>'totalItemDiscounts')::numeric, 0),
    coalesce((p_totals->>'orderDiscountPercent')::numeric, 0),
    coalesce((p_totals->>'orderDiscountAmount')::numeric, 0),
    coalesce((p_totals->>'totalDiscountAmount')::numeric, 0),
    coalesce((p_totals->>'grandTotal')::numeric, 0),
    p_payment_method, p_amount_paid, p_change_given, p_notes,
    v_uid, v_name, 'completed'
  );

  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.sale_items (
      sale_id, book_id, book_name, quantity, unit_price,
      discount_percent, discount_amount, subtotal
    ) values (
      v_sale_id,
      v_item->>'bookId',
      v_item->>'bookName',
      (v_item->>'quantity')::integer,
      (v_item->>'unitPrice')::numeric,
      coalesce((v_item->>'discountPercent')::numeric, 0),
      coalesce((v_item->>'discountAmount')::numeric, 0),
      (v_item->>'subtotal')::numeric
    );
  end loop;

  perform public.write_audit('sale_completed', 'sale', v_sale_id,
    format('Completed sale, grand total %s', coalesce((p_totals->>'grandTotal')::numeric, 0)));

  if p_client_request_id is not null then
    perform public.idempotency_put(p_client_request_id, v_uid, 'complete_sale', to_jsonb(v_sale_id));
  end if;

  return v_sale_id;
end;
$$;

-- ─── New: create_and_pick_transfer ────────────────────────────────────────────
--
-- Convenience RPC for the common "create draft transfer, then immediately
-- pick it" flow — inserts the draft row and delegates to `pick_transfer`
-- inside the same transaction.

create or replace function public.create_and_pick_transfer(
  p_from_warehouse_id text,
  p_to_warehouse_id text,
  p_items jsonb,
  p_bookstore_id text,
  p_notes text default '',
  p_client_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_transfer_id text := gen_random_uuid()::text;
  v_result jsonb;
  v_cached jsonb;
begin
  if not public.is_warehouse_ops() then raise exception 'Not authorized'; end if;
  if p_from_warehouse_id = p_to_warehouse_id then raise exception 'Source and destination must differ'; end if;
  if coalesce(jsonb_array_length(p_items), 0) = 0 then raise exception 'Add at least one box'; end if;

  if p_client_request_id is not null then
    v_cached := public.idempotency_get(p_client_request_id);
    if v_cached is not null then
      return v_cached;
    end if;
  end if;

  select display_name into v_name from public.profiles where id = v_uid;

  insert into public.transfers (
    id, from_warehouse_id, to_warehouse_id, status, items, notes, created_by, created_by_name
  ) values (
    v_transfer_id, p_from_warehouse_id, p_to_warehouse_id, 'draft', p_items, coalesce(p_notes,''), v_uid, v_name
  );

  perform public.write_audit('transfer_created', 'transfer', v_transfer_id,
    format('Transfer draft: %s box(es) from %s -> %s', jsonb_array_length(p_items), p_from_warehouse_id, p_to_warehouse_id));

  -- Delegate to pick_transfer for the actual pick side effects; its own
  -- idempotency/audit calls are skipped here since we wrap the whole flow.
  v_result := public.pick_transfer(v_transfer_id, p_bookstore_id);

  if p_client_request_id is not null then
    perform public.idempotency_put(p_client_request_id, v_uid, 'create_and_pick_transfer', v_result);
  end if;

  return v_result;
end;
$$;

-- ─── New: return_sale_items ───────────────────────────────────────────────────

create or replace function public.return_sale_items(
  p_sale_id text,
  p_items jsonb,
  p_reason text,
  p_bookstore_id text,
  p_client_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_sale public.sales%rowtype;
  v_item jsonb;
  v_book_id text;
  v_book_name text;
  v_qty integer;
  v_refund numeric;
  v_total_refund numeric := 0;
  v_sold_qty integer;
  v_already_returned integer;
  v_returned_items jsonb;
  v_total_sold integer;
  v_total_returned integer;
  v_return_status text;
  v_cached jsonb;
  v_result jsonb;
begin
  if not public.is_staff() then raise exception 'Not authorized'; end if;

  if p_client_request_id is not null then
    v_cached := public.idempotency_get(p_client_request_id);
    if v_cached is not null then
      return v_cached;
    end if;
  end if;

  select display_name into v_name from public.profiles where id = v_uid;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then raise exception 'Sale not found'; end if;
  if v_sale.status = 'voided' then raise exception 'Cannot return items on a voided sale'; end if;
  if v_sale.return_status = 'returned' then raise exception 'Sale already fully returned'; end if;

  v_returned_items := coalesce(v_sale.returned_items, '[]'::jsonb);

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_book_id := v_item->>'bookId';
    v_book_name := v_item->>'bookName';
    v_qty := (v_item->>'quantity')::integer;
    v_refund := coalesce((v_item->>'refundAmount')::numeric, 0);
    if v_qty <= 0 then raise exception 'Quantity must be positive'; end if;

    select coalesce(sum(quantity), 0) into v_sold_qty from public.sale_items
      where sale_id = p_sale_id and book_id = v_book_id;
    select coalesce(sum((elem->>'quantityReturned')::integer), 0) into v_already_returned
      from jsonb_array_elements(v_returned_items) elem where elem->>'bookId' = v_book_id;

    if v_already_returned + v_qty > v_sold_qty then
      raise exception 'Return quantity for % exceeds sold quantity', v_book_name;
    end if;

    perform public.apply_inventory_delta(v_book_id, p_bookstore_id, p_bookstore_id, v_qty);

    insert into public.inventory_movements (
      type, book_id, book_name, quantity, warehouse_id, sale_id, reason,
      performed_by, performed_by_name
    ) values (
      'return', v_book_id, v_book_name, v_qty, p_bookstore_id, p_sale_id, coalesce(p_reason, 'Return'),
      v_uid, v_name
    );

    v_returned_items := v_returned_items || jsonb_build_array(jsonb_build_object(
      'bookId', v_book_id, 'bookName', v_book_name, 'quantityReturned', v_qty
    ));
    v_total_refund := v_total_refund + v_refund;
  end loop;

  select coalesce(sum(quantity), 0) into v_total_sold from public.sale_items where sale_id = p_sale_id;
  select coalesce(sum((elem->>'quantityReturned')::integer), 0) into v_total_returned
    from jsonb_array_elements(v_returned_items) elem;
  v_return_status := case when v_total_returned >= v_total_sold then 'returned' else 'partial' end;

  update public.sales set
    return_status = v_return_status,
    returned_items = v_returned_items,
    return_reason = p_reason,
    returned_by = v_uid,
    returned_at = now(),
    return_refund_amount = coalesce(return_refund_amount, 0) + v_total_refund
  where id = p_sale_id;

  v_result := jsonb_build_object(
    'saleId', p_sale_id,
    'refundAmount', v_total_refund,
    'returnStatus', v_return_status,
    'returnedItems', v_returned_items
  );

  perform public.write_audit('sale_returned', 'sale', p_sale_id,
    format('Returned %s item(s), refund %s', jsonb_array_length(p_items), v_total_refund));

  if p_client_request_id is not null then
    perform public.idempotency_put(p_client_request_id, v_uid, 'return_sale_items', v_result);
  end if;

  return v_result;
end;
$$;

-- ─── New: split_box ────────────────────────────────────────────────────────────

create or replace function public.split_box(
  p_box_id text,
  p_quantity integer,
  p_client_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_box public.boxes%rowtype;
  v_wh_code text;
  v_seqs integer[];
  v_new_barcode text;
  v_new_box_id text := gen_random_uuid()::text;
  v_remaining integer;
  v_uid uuid := auth.uid();
  v_name text;
  v_cached jsonb;
  v_result jsonb;
begin
  if not public.is_warehouse_ops() then raise exception 'Not authorized'; end if;
  if p_quantity <= 0 then raise exception 'Quantity must be positive'; end if;

  if p_client_request_id is not null then
    v_cached := public.idempotency_get(p_client_request_id);
    if v_cached is not null then
      return v_cached;
    end if;
  end if;

  select display_name into v_name from public.profiles where id = v_uid;

  select * into v_box from public.boxes where id = p_box_id for update;
  if not found then raise exception 'Box not found'; end if;
  if v_box.status in ('empty', 'in_transit') then raise exception 'Cannot split a % box', v_box.status; end if;
  if v_box.quantity < p_quantity then raise exception 'Box only has %', v_box.quantity; end if;

  select code into v_wh_code from public.warehouses where id = v_box.warehouse_id;
  v_wh_code := coalesce(v_wh_code, 'XX');

  v_seqs := public.next_box_seqs(v_wh_code, 1);
  v_new_barcode := 'NPBX-' || upper(v_wh_code) || '-' || lpad(v_seqs[1]::text, 6, '0');

  v_remaining := v_box.quantity - p_quantity;
  update public.boxes set
    quantity = v_remaining,
    status = case when v_remaining = 0 then 'empty' else 'open' end,
    opened_at = coalesce(opened_at, now())
  where id = p_box_id;

  insert into public.boxes (
    id, barcode, book_id, book_name, warehouse_id, quantity, initial_quantity,
    status, shelf_location, batch_ref, notes, created_by, is_deleted
  ) values (
    v_new_box_id, v_new_barcode, v_box.book_id, v_box.book_name, v_box.warehouse_id,
    p_quantity, p_quantity, 'sealed', coalesce(v_box.shelf_location,''), coalesce(v_box.batch_ref,''),
    'Split from ' || v_box.barcode, v_uid, false
  );

  insert into public.inventory_movements (
    type, book_id, book_name, quantity, warehouse_id, box_id, reason,
    performed_by, performed_by_name
  ) values (
    'adjustment', v_box.book_id, v_box.book_name, -p_quantity, v_box.warehouse_id, p_box_id,
    format('Split %s to new box %s', p_quantity, v_new_barcode), v_uid, v_name
  );

  v_result := jsonb_build_object(
    'id', v_new_box_id,
    'barcode', v_new_barcode,
    'quantity', p_quantity,
    'originalRemaining', v_remaining
  );

  perform public.write_audit('box_created', 'box', v_new_box_id,
    format('Split box %s: moved %s units to new box %s', p_box_id, p_quantity, v_new_barcode));

  if p_client_request_id is not null then
    perform public.idempotency_put(p_client_request_id, v_uid, 'split_box', v_result);
  end if;

  return v_result;
end;
$$;

-- ─── New: complete_stocktake ───────────────────────────────────────────────────
--
-- Prefers `stocktake_lines` rows when present; falls back to the legacy
-- `stocktakes.items` jsonb column for stocktakes created before this
-- migration. Deltas are merged per book|warehouse before being applied so a
-- title counted more than once in the same stocktake nets into one write.

create or replace function public.complete_stocktake(
  p_stocktake_id text,
  p_bookstore_id text,
  p_client_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stocktake public.stocktakes%rowtype;
  v_line record;
  v_item jsonb;
  v_key text;
  v_deltas jsonb := '{}'::jsonb;
  v_delta_entry jsonb;
  v_delta integer;
  v_book_id text;
  v_book_name text;
  v_warehouse_id text;
  v_adjusted integer := 0;
  v_total_discrepancy integer := 0;
  v_uid uuid := auth.uid();
  v_name text;
  v_use_lines boolean;
  v_cached jsonb;
  v_result jsonb;
  k text;
begin
  if not public.is_warehouse_ops() then raise exception 'Not authorized'; end if;

  if p_client_request_id is not null then
    v_cached := public.idempotency_get(p_client_request_id);
    if v_cached is not null then
      return v_cached;
    end if;
  end if;

  select display_name into v_name from public.profiles where id = v_uid;

  select * into v_stocktake from public.stocktakes where id = p_stocktake_id for update;
  if not found then raise exception 'Stocktake not found'; end if;
  if v_stocktake.status in ('completed', 'cancelled') then
    raise exception 'Stocktake already %', v_stocktake.status;
  end if;

  select exists (select 1 from public.stocktake_lines where stocktake_id = p_stocktake_id) into v_use_lines;

  if v_use_lines then
    for v_line in
      select book_id, book_name, warehouse_id, expected_qty, counted_qty
      from public.stocktake_lines
      where stocktake_id = p_stocktake_id
        and counted_qty is not null
        and counted_qty <> expected_qty
    loop
      v_key := v_line.book_id || '|' || v_line.warehouse_id;
      v_delta := v_line.counted_qty - v_line.expected_qty;
      v_delta_entry := v_deltas->v_key;
      if v_delta_entry is null then
        v_deltas := jsonb_set(v_deltas, array[v_key], jsonb_build_object(
          'bookId', v_line.book_id, 'bookName', v_line.book_name,
          'warehouseId', v_line.warehouse_id, 'delta', v_delta
        ), true);
      else
        v_deltas := jsonb_set(v_deltas, array[v_key],
          jsonb_set(v_delta_entry, array['delta'], to_jsonb((v_delta_entry->>'delta')::integer + v_delta)), true);
      end if;
    end loop;
  else
    for v_item in select * from jsonb_array_elements(coalesce(v_stocktake.items, '[]'::jsonb)) loop
      if (v_item->>'countedQty') is null then continue; end if;
      v_delta := (v_item->>'countedQty')::integer - (v_item->>'expectedQty')::integer;
      if v_delta = 0 then continue; end if;
      v_book_id := v_item->>'bookId';
      v_warehouse_id := v_item->>'warehouseId';
      v_key := v_book_id || '|' || v_warehouse_id;
      v_delta_entry := v_deltas->v_key;
      if v_delta_entry is null then
        v_deltas := jsonb_set(v_deltas, array[v_key], jsonb_build_object(
          'bookId', v_book_id, 'bookName', v_item->>'bookName',
          'warehouseId', v_warehouse_id, 'delta', v_delta
        ), true);
      else
        v_deltas := jsonb_set(v_deltas, array[v_key],
          jsonb_set(v_delta_entry, array['delta'], to_jsonb((v_delta_entry->>'delta')::integer + v_delta)), true);
      end if;
    end loop;
  end if;

  for k, v_delta_entry in select * from jsonb_each(v_deltas) loop
    v_delta := (v_delta_entry->>'delta')::integer;
    if v_delta = 0 then continue; end if;
    v_book_id := v_delta_entry->>'bookId';
    v_book_name := v_delta_entry->>'bookName';
    v_warehouse_id := v_delta_entry->>'warehouseId';

    perform public.apply_inventory_delta(v_book_id, v_warehouse_id, p_bookstore_id, v_delta);
    insert into public.inventory_movements (
      type, book_id, book_name, quantity, warehouse_id, reason, performed_by, performed_by_name
    ) values (
      'adjustment', v_book_id, v_book_name, v_delta, v_warehouse_id,
      format('Cycle count adjustment (%s)', v_stocktake.name), v_uid, v_name
    );
    v_adjusted := v_adjusted + 1;
    v_total_discrepancy := v_total_discrepancy + abs(v_delta);
  end loop;

  update public.stocktakes set status = 'completed', completed_at = now() where id = p_stocktake_id;

  v_result := jsonb_build_object('adjusted', v_adjusted, 'totalDiscrepancy', v_total_discrepancy);

  perform public.write_audit('stocktake_completed', 'stocktake', p_stocktake_id,
    format('Completed stocktake: %s item(s) adjusted, %s units variance', v_adjusted, v_total_discrepancy));

  if p_client_request_id is not null then
    perform public.idempotency_put(p_client_request_id, v_uid, 'complete_stocktake', v_result);
  end if;

  return v_result;
end;
$$;

-- ─── New: update_stocktake_line ────────────────────────────────────────────────
--
-- Records a counted quantity for one stocktake line. Uses `stocktake_lines`
-- when a row exists for (stocktake_id, line_index); otherwise falls back to
-- patching the legacy `stocktakes.items` jsonb array at that index.

create or replace function public.update_stocktake_line(
  p_stocktake_id text,
  p_line_index integer,
  p_counted_qty integer,
  p_client_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stocktake public.stocktakes%rowtype;
  v_uid uuid := auth.uid();
  v_name text;
  v_items jsonb;
  v_line public.stocktake_lines%rowtype;
  v_cached jsonb;
  v_result jsonb;
begin
  if not public.is_warehouse_ops() then raise exception 'Not authorized'; end if;

  if p_client_request_id is not null then
    v_cached := public.idempotency_get(p_client_request_id);
    if v_cached is not null then
      return v_cached;
    end if;
  end if;

  select display_name into v_name from public.profiles where id = v_uid;

  select * into v_stocktake from public.stocktakes where id = p_stocktake_id for update;
  if not found then raise exception 'Stocktake not found'; end if;
  if v_stocktake.status in ('completed', 'cancelled') then
    raise exception 'Stocktake already %', v_stocktake.status;
  end if;

  select * into v_line from public.stocktake_lines
    where stocktake_id = p_stocktake_id and line_index = p_line_index for update;

  if found then
    update public.stocktake_lines set
      counted_qty = p_counted_qty,
      counted_by = v_uid,
      counted_by_name = v_name,
      counted_at = now()
    where id = v_line.id;
  else
    v_items := coalesce(v_stocktake.items, '[]'::jsonb);
    if p_line_index < 0 or p_line_index >= jsonb_array_length(v_items) then
      raise exception 'Line index % out of range', p_line_index;
    end if;
    v_items := jsonb_set(
      v_items, array[p_line_index::text],
      (v_items->p_line_index) || jsonb_build_object(
        'countedQty', p_counted_qty, 'countedBy', v_uid, 'countedAt', now()
      )
    );
    update public.stocktakes set items = v_items where id = p_stocktake_id;
  end if;

  v_result := jsonb_build_object(
    'stocktakeId', p_stocktake_id,
    'lineIndex', p_line_index,
    'countedQty', p_counted_qty,
    'countedBy', v_uid,
    'countedAt', now()
  );

  perform public.write_audit('stocktake_line_counted', 'stocktake', p_stocktake_id,
    format('Recorded count %s for line %s', p_counted_qty, p_line_index));

  if p_client_request_id is not null then
    perform public.idempotency_put(p_client_request_id, v_uid, 'update_stocktake_line', v_result);
  end if;

  return v_result;
end;
$$;

-- ─── Grants ────────────────────────────────────────────────────────────────────
--
-- Every RPC below is a higher-level, validated entry point; grant execute to
-- authenticated users. `apply_inventory_delta` and `next_box_seqs` are
-- intentionally excluded (revoked above) — callers must go through these.

grant execute on function public.receive_cartons to authenticated;
grant execute on function public.put_on_sale to authenticated;
grant execute on function public.pick_transfer to authenticated;
grant execute on function public.receive_transfer to authenticated;
grant execute on function public.complete_sale to authenticated;
grant execute on function public.create_and_pick_transfer to authenticated;
grant execute on function public.return_sale_items to authenticated;
grant execute on function public.split_box to authenticated;
grant execute on function public.complete_stocktake to authenticated;
grant execute on function public.update_stocktake_line to authenticated;
grant execute on function public.write_audit to authenticated;
grant execute on function public.idempotency_get to authenticated;
grant execute on function public.idempotency_put to authenticated;
