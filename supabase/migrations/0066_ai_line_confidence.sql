-- 0066: the photo check's match probability per product, for the lists
-- (Giorgi, 18.11). Each shelf's latest check (shelf_ai_checks.result.items)
-- is read per product: the lowest confidence over its shelves, what the
-- photos showed, and one verdict (match only if every shelf matched).
-- Items carry product_id from now on; older ones are matched by code.

create or replace function public.stocktake_ai_lines(p_stocktake uuid)
returns table (product_id uuid, detected numeric, confidence numeric, status text,
               shelves int, checked_at timestamptz)
language sql stable security definer set search_path = public, pg_temp
as $$
  with latest as (
    select distinct on (c.location_id) c.location_id, c.created_at, c.result
      from public.shelf_ai_checks c
     where c.stocktake_id = p_stocktake and c.company_id = public.auth_company_id()
       and coalesce(public.auth_role()::text, '') in ('owner', 'admin')
     order by c.location_id, c.created_at desc
  ), items as (
    select l.location_id, l.created_at, i
      from latest l cross join lateral jsonb_array_elements(l.result -> 'items') i
  ), m as (
    select coalesce(nullif(i ->> 'product_id', '')::uuid, p.id) pid,
           (i ->> 'detected')::numeric det, (i ->> 'confidence')::numeric conf,
           i ->> 'status' st, items.created_at
      from items
      left join lateral (
        select pr.id from public.products pr
         where pr.company_id = public.auth_company_id() and coalesce(i ->> 'code', '') <> ''
           and (pr.barcode = i ->> 'code' or pr.sku = i ->> 'code')
         limit 1) p on true
  )
  select pid, sum(det), min(conf),
         case when bool_and(st = 'match') then 'match'
              when bool_or(st = 'mismatch') then 'mismatch'
              else 'partial' end,
         count(*)::int, max(created_at)
    from m where pid is not null
   group by pid;
$$;
revoke all on function public.stocktake_ai_lines(uuid) from public, anon;
grant execute on function public.stocktake_ai_lines(uuid) to authenticated;

-- Per stocktake, for the list: products checked, how many matched, the mean
-- match probability.
create or replace function public.stocktake_ai_summary(p_ids uuid[])
returns table (stocktake_id uuid, checked int, matched int, confidence numeric)
language sql stable security definer set search_path = public, pg_temp
as $$
  select s.id, count(l.*)::int, count(l.*) filter (where l.status = 'match')::int,
         round(avg(l.confidence), 3)
    from unnest(p_ids) s(id)
    cross join lateral public.stocktake_ai_lines(s.id) l
   group by s.id;
$$;
revoke all on function public.stocktake_ai_summary(uuid[]) from public, anon;
grant execute on function public.stocktake_ai_summary(uuid[]) to authenticated;

notify pgrst, 'reload schema';
