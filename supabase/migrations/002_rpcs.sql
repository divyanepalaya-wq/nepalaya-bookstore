-- Inventory & sale RPCs (transactional)

-- Apply inventory delta for one book/location + dual-write books.in_stock
create or replace function public.apply_inventory_delta(
  p_book_id text,
  p_warehouse_id text,
  p_bookstore_id text,
  p_delta integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_by jsonb;
  v_prev integer;
  v_next integer;
  v_retail integer;
  v_wh_total integer;
  k text;
  v integer;
begin
  select coalesce(by_warehouse, '{}'::jsonb) into v_by
  from public.book_inventory where book_id = p_book_id for update;

  if v_by is null then
    v_by := '{}'::jsonb;
  end if;

  v_prev := coalesce((v_by->>p_warehouse_id)::integer, 0);
  v_next := v_prev + p_delta;
  if v_next < 0 then
    raise exception 'Insufficient stock at location (have %, need %)', v_prev, abs(p_delta);
  end if;

  v_by := jsonb_set(v_by, array[p_warehouse_id], to_jsonb(v_next), true);

  v_retail := coalesce((v_by->>p_bookstore_id)::integer, 0);
  v_wh_total := 0;
  for k, v in select * from jsonb_each_text(v_by) loop
    if k <> p_bookstore_id then
      v_wh_total := v_wh_total + v::integer;
    end if;
  end loop;

  insert into public.book_inventory (book_id, by_warehouse, total_warehouse_qty, retail_qty, updated_at)
  values (p_book_id, v_by, v_wh_total, v_retail, now())
  on conflict (book_id) do update set
    by_warehouse = excluded.by_warehouse,
    total_warehouse_qty = excluded.total_warehouse_qty,
    retail_qty = excluded.retail_qty,
    updated_at = now();

  if p_warehouse_id = p_bookstore_id then
    update public.books set in_stock = v_retail, updated_at = now() where id = p_book_id;
  end if;

  return jsonb_build_object('previous', v_prev, 'next', v_next, 'retail_qty', v_retail);
end;
$$;

create or replace function public.next_box_seqs(p_warehouse_code text, p_count integer)
returns integer[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := 'box-seq-' || upper(p_warehouse_code);
  v_cur integer;
  v_seqs integer[];
  i integer;
begin
  insert into public.counters (id, value, updated_at) values (v_id, 0, now())
  on conflict (id) do nothing;

  select value into v_cur from public.counters where id = v_id for update;
  v_seqs := array[]::integer[];
  for i in 1..p_count loop
    v_seqs := array_append(v_seqs, v_cur + i);
  end loop;
  update public.counters set value = v_cur + p_count, updated_at = now() where id = v_id;
  return v_seqs;
end;
$$;

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
  p_notes text default ''
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
begin
  if not public.is_warehouse_ops() then
    raise exception 'Not authorized';
  end if;
  if p_total_quantity <= 0 or p_copies_per_box <= 0 then
    raise exception 'Invalid quantities';
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

  return jsonb_build_object('boxes', v_created);
end;
$$;

create or replace function public.put_on_sale(
  p_box_id text,
  p_quantity integer,
  p_bookstore_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_box public.boxes%rowtype;
  v_uid uuid := auth.uid();
  v_name text;
  v_remain integer;
begin
  if not public.is_warehouse_ops() then
    raise exception 'Not authorized';
  end if;
  if p_quantity <= 0 then raise exception 'Quantity must be positive'; end if;

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
end;
$$;

create or replace function public.pick_transfer(p_transfer_id text, p_bookstore_id text)
returns void
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
begin
  if not public.is_warehouse_ops() then raise exception 'Not authorized'; end if;
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
  end loop;

  update public.transfers set status = 'in_transit', picked_at = now() where id = p_transfer_id;
end;
$$;

create or replace function public.receive_transfer(p_transfer_id text, p_bookstore_id text)
returns void
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
begin
  if not public.is_warehouse_ops() then raise exception 'Not authorized'; end if;
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
  end loop;

  update public.transfers set
    status = 'received',
    received_by = v_uid,
    received_by_name = v_name,
    received_at = now()
  where id = p_transfer_id;
end;
$$;

create or replace function public.complete_sale(
  p_customer_name text,
  p_customer_phone text,
  p_items jsonb,
  p_totals jsonb,
  p_payment_method text,
  p_amount_paid numeric,
  p_change_given numeric,
  p_notes text,
  p_bookstore_id text
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
begin
  if not public.is_staff() then raise exception 'Not authorized'; end if;
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

  return v_sale_id;
end;
$$;

grant execute on function public.receive_cartons to authenticated;
grant execute on function public.put_on_sale to authenticated;
grant execute on function public.pick_transfer to authenticated;
grant execute on function public.receive_transfer to authenticated;
grant execute on function public.complete_sale to authenticated;
grant execute on function public.apply_inventory_delta to authenticated;
grant execute on function public.next_box_seqs to authenticated;
