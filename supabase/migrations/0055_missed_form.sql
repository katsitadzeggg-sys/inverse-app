-- The "missed" form: once the parallel counts of a warehouse are done, one more
-- stocktake with only the products counted in none of them. It belongs to the
-- same warehouse, so its counts join the others in stocktake_pool_stats:
-- what it still leaves different from the balance shows up in "to re-check".
alter table public.stocktakes
  add column if not exists form_kind text check (form_kind in ('missed', 'review'));

create or replace function public.open_missed_form(p_ids uuid[])
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me text := coalesce(public.auth_role()::text, '');
  co uuid := public.auth_company_id();
  ids uuid[];
  src public.stocktakes;
  found uuid;
  new_id uuid;
begin
  if me not in ('owner', 'admin') then raise exception 'not allowed'; end if;
  select array_agg(id) into ids from public.stocktakes
   where id = any (p_ids) and company_id = co and kind <> 'assets';
  if ids is null then raise exception 'not found'; end if;
  -- Already made and still open: open that one.
  select id into found from public.stocktakes
   where id = any (ids) and form_kind = 'missed' and status = 'open'
   order by created_at desc limit 1;
  if found is not null then return found; end if;
  -- The balance comes from the latest stocktake that has one.
  select s.* into src from public.stocktakes s
   where s.id = any (ids)
     and exists (select 1 from public.stocktake_book b where b.stocktake_id = s.id)
   order by s.created_at desc limit 1;
  if src.id is null then raise exception 'no book'; end if;
  insert into public.stocktakes
    (company_id, name, client_name, branch, address, lat, lng, kind, created_by, form_kind)
  values
    (co, src.name, src.client_name, src.branch, src.address, src.lat, src.lng, 'stock',
     auth.uid(), 'missed')
  returning id into new_id;
  insert into public.stocktake_book
    (company_id, stocktake_id, product_id, location_id, book_qty, unit_cost)
  select co, new_id, b.product_id, b.location_id, b.book_qty, b.unit_cost
    from public.stocktake_book b
   where b.stocktake_id = src.id
     and b.product_id in (
       select product_id from public.stocktake_book where stocktake_id = src.id
        group by product_id having sum(book_qty) > 0)
     and not exists (
       select 1 from public.stocktake_entries e
        where e.stocktake_id = any (ids) and e.product_id = b.product_id);
  return new_id;
end;
$$;
revoke all on function public.open_missed_form(uuid[]) from public, anon;
grant execute on function public.open_missed_form(uuid[]) to authenticated;
