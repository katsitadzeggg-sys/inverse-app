-- Manager's list figures, counted shelf by shelf: surplus and shortage only
-- for closed shelves (book on those shelves against what was counted there);
-- the book on shelves not closed yet is "remaining". Several counters over
-- several days add up in the same stocktake. Replaces stocktake_stats2.
create or replace function public.stocktake_stats3(p_ids uuid[])
returns table (
  stocktake_id uuid, shelves int, shelves_done int, skus int, counted_qty numeric,
  plus_qty numeric, plus_sum numeric, plus_nocost int,
  minus_qty numeric, minus_sum numeric,
  left_qty numeric, left_sum numeric, left_shelves int
)
language sql stable security definer set search_path = public, pg_temp
as $$
  with ids as (
    select id from public.stocktakes
     where id = any (p_ids) and company_id = public.auth_company_id()
  ), dz as (
    select z.stocktake_id sid, z.location_id lid from public.stocktake_zones z
     where z.stocktake_id in (select id from ids) and z.status = 'done'
  ), b as (
    select b.stocktake_id sid, b.product_id pid, b.location_id lid, b.book_qty q, b.unit_cost c
      from public.stocktake_book b where b.stocktake_id in (select id from ids)
  ), bd as (
    select b.sid, b.pid, sum(b.q) q, max(b.c) c from b
      join dz on dz.sid = b.sid and dz.lid = b.lid group by 1, 2
  ), price as (
    select sid, pid, max(c) c from b group by 1, 2
  ), ed as (
    select e.stocktake_id sid, e.product_id pid, sum(e.quantity) q
      from public.stocktake_entries e
      join dz on dz.sid = e.stocktake_id and dz.lid = e.location_id
     group by 1, 2
  ), d as (
    select coalesce(bd.sid, ed.sid) sid, coalesce(ed.q, 0) - coalesce(bd.q, 0) diff,
           coalesce(bd.c, p.c) c
      from bd full join ed on ed.sid = bd.sid and ed.pid is not distinct from bd.pid
      left join price p on p.sid = ed.sid and p.pid = ed.pid
  ), dd as (
    select sid,
           sum(diff) filter (where diff > 0) pq, sum(diff * coalesce(c, 0)) filter (where diff > 0) ps,
           count(*) filter (where diff > 0 and coalesce(c, 0) = 0) pn,
           -sum(diff) filter (where diff < 0) mq, -sum(diff * coalesce(c, 0)) filter (where diff < 0) ms
      from d group by sid
  ), lft as (
    select b.sid, sum(b.q) q, sum(b.q * coalesce(b.c, 0)) s, count(distinct b.lid) n
      from b where not exists (select 1 from dz where dz.sid = b.sid and dz.lid = b.lid)
     group by 1
  ), e as (
    select e.stocktake_id sid, e.product_id pid, sum(e.quantity) q
      from public.stocktake_entries e where e.stocktake_id in (select id from ids) group by 1, 2
  ), ee as (
    select sid, count(*) filter (where q <> 0) skus, sum(q) qty from e group by sid
  ), z as (
    select z.stocktake_id sid, count(*) n, count(*) filter (where z.status = 'done') done
      from public.stocktake_zones z where z.stocktake_id in (select id from ids) group by 1
  )
  select s.id, coalesce(z.n, 0)::int, coalesce(z.done, 0)::int,
         coalesce(ee.skus, 0)::int, coalesce(ee.qty, 0),
         coalesce(dd.pq, 0), coalesce(dd.ps, 0), coalesce(dd.pn, 0)::int,
         coalesce(dd.mq, 0), coalesce(dd.ms, 0),
         coalesce(lft.q, 0), coalesce(lft.s, 0), coalesce(lft.n, 0)::int
    from ids s
    left join z on z.sid = s.id
    left join ee on ee.sid = s.id
    left join dd on dd.sid = s.id
    left join lft on lft.sid = s.id;
$$;
revoke all on function public.stocktake_stats3(uuid[]) from public, anon;
grant execute on function public.stocktake_stats3(uuid[]) to authenticated;
notify pgrst, 'reload schema';
