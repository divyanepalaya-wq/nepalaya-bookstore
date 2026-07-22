-- Void mistaken carton receives (soft-delete box + deduct warehouse qty).
-- Client also has a fallback; this RPC is preferred when applied.

create or replace function public.void_carton(
  p_box_id text,
  p_bookstore_id text,
  p_reason text default '',
  p_client_request_id text default null
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
  v_cached jsonb;
  v_result jsonb;
  v_reason text;
begin
  if not public.is_warehouse_ops() then raise exception 'Not authorized'; end if;

  if p_client_request_id is not null then
    v_cached := public.idempotency_get(p_client_request_id);
    if v_cached is not null then return v_cached; end if;
  end if;

  select display_name into v_name from public.profiles where id = v_uid;

  select * into v_box from public.boxes where id = p_box_id for update;
  if not found then raise exception 'Carton not found'; end if;
  if coalesce(v_box.is_deleted, false) or v_box.quantity <= 0 then
    raise exception 'Carton already empty';
  end if;
  if v_box.status = 'in_transit' then
    raise exception 'Carton is in transit';
  end if;

  v_reason := nullif(trim(p_reason), '');
  if v_reason is null then
    v_reason := format('Voided carton %s (mistaken receive)', v_box.barcode);
  end if;

  update public.boxes set
    quantity = 0,
    status = 'empty',
    is_deleted = true,
    deleted_at = now(),
    deleted_by = v_uid,
    notes = trim(both ' · ' from coalesce(notes, '') || ' · ' || v_reason)
  where id = p_box_id;

  perform public.apply_inventory_delta(
    v_box.book_id, v_box.warehouse_id, p_bookstore_id, -v_box.quantity
  );

  insert into public.inventory_movements (
    type, book_id, book_name, quantity, warehouse_id, box_id, reason,
    performed_by, performed_by_name
  ) values (
    'adjustment', v_box.book_id, v_box.book_name, -v_box.quantity, v_box.warehouse_id,
    p_box_id, v_reason, v_uid, v_name
  );

  perform public.write_audit(
    'box_deleted', 'box', p_box_id,
    format('Voided carton %s: -%s pcs of "%s"', v_box.barcode, v_box.quantity, v_box.book_name)
  );

  v_result := jsonb_build_object(
    'bookId', v_box.book_id,
    'quantity', v_box.quantity,
    'barcode', v_box.barcode
  );

  if p_client_request_id is not null then
    perform public.idempotency_put(p_client_request_id, v_uid, 'void_carton', v_result);
  end if;

  return v_result;
end;
$$;

grant execute on function public.void_carton to authenticated;
