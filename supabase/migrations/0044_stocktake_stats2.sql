-- Faster figures for the manager's list (one pass per table, grouped), plus
-- SKUs counted and the counted quantity. Replaces stocktake_stats.
-- Security definer, limited to the caller's company.
create or replace function public.stocktake_stats2(p_ids uuid[])
returns table (
  stocktake_id uuid, shelves int, shelves_done int, skus int, counted_qty numeric,
  plus_qty numeric, plus_sum numeric, minus_qty numeric, minus_sum numeric
)
language sql stable security definer set search_path = public, pg_temp
as $$
  -- Definer: row-level checks per book line made it slow; only the caller's
  -- own company's stocktakes are let through here instead.
  with ids as (
    select id from public.stocktakes
     where id = any (p_ids) and company_id = public.auth_company_id()
  ), b as (
    select b.stocktake_id sid, b.product_id pid, sum(b.book_qty) q, max(b.unit_cost) c
      from public.stocktake_book b where b.stocktake_id in (select id from ids) group by 1, 2
  ), e as (
    select e.stocktake_id sid, e.product_id pid, sum(e.quantity) q
      from public.stocktake_entries e where e.stocktake_id in (select id from ids) group by 1, 2
  ), d as (
    select coalesce(b.sid, e.sid) sid, coalesce(e.q, 0) - coalesce(b.q, 0) diff, coalesce(b.c, 0) c
      from b full join e on e.sid = b.sid and e.pid is not distinct from b.pid
  ), dd as (
    select sid,
           sum(diff) filter (where diff > 0) pq, sum(diff * c) filter (where diff > 0) ps,
           -sum(diff) filter (where diff < 0) mq, -sum(diff * c) filter (where diff < 0) ms
      from d group by sid
  ), ee as (
    select sid, count(*) filter (where q <> 0) skus, sum(q) qty from e group by sid
  ), z as (
    select z.stocktake_id sid, count(*) n, count(*) filter (where z.status = 'done') done
      from public.stocktake_zones z where z.stocktake_id in (select id from ids) group by 1
  )
  select s.id, coalesce(z.n, 0)::int, coalesce(z.done, 0)::int,
         coalesce(ee.skus, 0)::int, coalesce(ee.qty, 0),
         coalesce(dd.pq, 0), coalesce(dd.ps, 0), coalesce(dd.mq, 0), coalesce(dd.ms, 0)
    from ids s
    left join z on z.sid = s.id
    left join ee on ee.sid = s.id
    left join dd on dd.sid = s.id;
$$;
revoke all on function public.stocktake_stats2(uuid[]) from public, anon;
grant execute on function public.stocktake_stats2(uuid[]) to authenticated;
notify pgrst, 'reload schema';
