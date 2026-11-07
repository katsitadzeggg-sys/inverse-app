-- Items found on the wrong shelf.
-- 1) book_shelves: which shelves each product of the stocktake is booked on
--    (codes only, no quantities — the count stays blind).
-- 2) shelf_differences_v2 (replaces shelf_differences) also says, for an item counted here but booked on
--    another shelf, which shelf that is ("home"), so it shows as moved, not surplus.
create or replace function public.book_shelves(p_stocktake uuid)
returns table (product_id uuid, location_id uuid, code text, shelf_done boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct b.product_id, b.location_id, l.code,
         coalesce((select z.status = 'done' from public.stocktake_zones z
                   where z.stocktake_id = b.stocktake_id and z.location_id = b.location_id limit 1), false)
  from public.stocktake_book b
  join public.stocktakes s on s.id = b.stocktake_id
  join public.locations l on l.id = b.location_id
  where b.stocktake_id = p_stocktake
    and s.company_id = public.auth_company_id()
    and b.location_id is not null;
$$;

revoke all on function public.book_shelves(uuid) from public;
grant execute on function public.book_shelves(uuid) to authenticated;

create or replace function public.shelf_differences_v2(p_stocktake uuid, p_location uuid)
returns table (product_name text, code text, diff numeric, home text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_zone public.stocktake_zones;
begin
  select * into v_zone from public.stocktake_zones z
    where z.stocktake_id = p_stocktake and z.location_id = p_location and z.company_id = public.auth_company_id();
  if v_zone.id is null or v_zone.status <> 'done' then
    return;
  end if;
  if v_zone.counter_id is distinct from auth.uid()
     and coalesce(public.auth_role()::text, '') not in ('owner', 'admin') then
    return;
  end if;
  return query
    with counted as (
      select coalesce(e.product_id::text, '?' || e.unknown_label) as k, e.product_id, max(e.unknown_label) as label, sum(e.quantity) as qty
      from public.stocktake_entries e
      where e.stocktake_id = p_stocktake and e.location_id = p_location
      group by 1, 2
    ),
    book as (
      select b.product_id::text as k, b.product_id, sum(b.book_qty) as qty
      from public.stocktake_book b
      where b.stocktake_id = p_stocktake and b.location_id = p_location
      group by 1, 2
    )
    select coalesce(p.name, c.label, '')::text,
           coalesce(p.barcode, p.sku, '')::text,
           coalesce(c.qty, 0) - coalesce(b.qty, 0),
           case when b.k is null and c.product_id is not null then
             (select string_agg(distinct l.code, ', ') from public.stocktake_book ob
                join public.locations l on l.id = ob.location_id
               where ob.stocktake_id = p_stocktake and ob.product_id = c.product_id and ob.location_id <> p_location)
           end
    from counted c
    full join book b on b.k = c.k
    left join public.products p on p.id = coalesce(c.product_id, b.product_id)
    where coalesce(c.qty, 0) <> coalesce(b.qty, 0)
    order by 3, 1;
end;
$$;

revoke all on function public.shelf_differences_v2(uuid, uuid) from public;
grant execute on function public.shelf_differences_v2(uuid, uuid) to authenticated;
