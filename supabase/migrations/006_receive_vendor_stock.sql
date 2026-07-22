-- Vendor receive: third-party Nepali/English books straight onto bookstore shelf.
create or replace function public.receive_vendor_stock(
  p_book_id text,
  p_book_name text,
  p_quantity integer,
  p_bookstore_id text,
  p_notes text default '',
  p_client_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_lang text;
  v_cached jsonb;
  v_name text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be positive';
  end if;

  if p_client_request_id is not null and length(trim(p_client_request_id)) > 0 then
    v_cached := public.idempotency_get(p_client_request_id, v_uid);
    if v_cached is not null then
      return v_cached;
    end if;
  end if;

  select language, name into v_lang, v_name
  from public.books
  where id = p_book_id and coalesce(is_deleted, false) = false;

  if v_lang is null then
    raise exception 'Book not found';
  end if;
  if v_lang not in ('Nepali', 'English') then
    raise exception 'Vendor receive is only for Nepali or English books (got %)', v_lang;
  end if;

  perform public.apply_inventory_delta(p_book_id, p_bookstore_id, p_bookstore_id, p_quantity);

  insert into public.inventory_movements (
    type, book_id, book_name, quantity, warehouse_id, reason,
    performed_by, performed_by_name
  ) values (
    'receive',
    p_book_id,
    coalesce(nullif(trim(p_book_name), ''), v_name),
    p_quantity,
    p_bookstore_id,
    coalesce(nullif(trim(p_notes), ''), 'Vendor delivery to store shelf'),
    v_uid,
    coalesce((select display_name from public.profiles where id = v_uid), 'Staff')
  );

  v_cached := jsonb_build_object(
    'bookId', p_book_id,
    'quantity', p_quantity,
    'bookstoreId', p_bookstore_id
  );

  if p_client_request_id is not null and length(trim(p_client_request_id)) > 0 then
    perform public.idempotency_put(p_client_request_id, v_uid, 'receive_vendor_stock', v_cached);
  end if;

  return v_cached;
end;
$$;

grant execute on function public.receive_vendor_stock to authenticated;

comment on function public.receive_vendor_stock is
  'Third-party Nepali/English stock received directly onto bookstore floor (no warehouse carton).';
