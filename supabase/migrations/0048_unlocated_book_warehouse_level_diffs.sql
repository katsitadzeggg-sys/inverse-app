-- Applied to production on 2026-11-11 from another session (recorded here):
-- book lines with no shelf are compared against the whole warehouse, so a
-- product counted on a shelf is not reported as surplus just because its book
-- line has no shelf.
-- The same migration also changed stocktake_stats3 the same way (now superseded
-- by stocktake_stats4 in 0049, which the app uses).
create or replace function public.shelf_differences_v2(p_stocktake uuid, p_location uuid)
 returns table(product_name text, code text, diff numeric, home text)
 language plpgsql stable security definer set search_path to 'public', 'pg_temp'
as $function$
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
    with unloc as (
      select b.product_id, sum(b.book_qty) as qty
      from public.stocktake_book b
      where b.stocktake_id = p_stocktake and b.location_id is null and b.product_id is not null
      group by 1
    ),
    counted as (
      select coalesce(e.product_id::text, '?' || e.unknown_label) as k, e.product_id, max(e.unknown_label) as label, sum(e.quantity) as qty
      from public.stocktake_entries e
      where e.stocktake_id = p_stocktake and e.location_id = p_location
        and (e.product_id is null or e.product_id not in (select u.product_id from unloc u))
      group by 1, 2
    ),
    book as (
      select b.product_id::text as k, b.product_id, sum(b.book_qty) as qty
      from public.stocktake_book b
      where b.stocktake_id = p_stocktake and b.location_id = p_location
        and b.product_id not in (select u.product_id from unloc u)
      group by 1, 2
    ),
    shelf_rows as (
      select coalesce(p.name, c.label, '')::text as n,
             coalesce(p.barcode, p.sku, '')::text as cd,
             coalesce(c.qty, 0) - coalesce(b.qty, 0) as d,
             case when b.k is null and c.product_id is not null then
               (select string_agg(distinct l.code, ', ') from public.stocktake_book ob
                  join public.locations l on l.id = ob.location_id
                 where ob.stocktake_id = p_stocktake and ob.product_id = c.product_id and ob.location_id <> p_location)
             end as h
      from counted c
      full join book b on b.k = c.k
      left join public.products p on p.id = coalesce(c.product_id, b.product_id)
      where coalesce(c.qty, 0) <> coalesce(b.qty, 0)
    ),
    wh as (
      select coalesce(p.name, '')::text as n,
             coalesce(p.barcode, p.sku, '')::text as cd,
             t.qty - u.qty as d,
             'მთელ საწყობში'::text as h
      from unloc u
      join (select e.product_id, sum(e.quantity) as qty
              from public.stocktake_entries e
             where e.stocktake_id = p_stocktake
               and e.product_id in (select e2.product_id from public.stocktake_entries e2
                                     where e2.stocktake_id = p_stocktake and e2.location_id = p_location)
             group by 1) t on t.product_id = u.product_id
      left join public.products p on p.id = u.product_id
      where t.qty > u.qty
    )
    select r.n, r.cd, r.d, r.h from (select * from shelf_rows union all select * from wh) r
    order by 3, 1;
end;
$function$;
