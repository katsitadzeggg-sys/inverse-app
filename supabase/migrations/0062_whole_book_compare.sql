-- 0062: the difference always comes from the product's whole balance (Giorgi,
-- 18.11). A product booked on shelf X and counted on shelf Y (3 booked, 3
-- counted) showed +3 surplus while X was still open: the balance was compared
-- shelf by shelf. Now, per product, the whole balance (every shelf) enters the
-- comparison as soon as the product is counted on any closed shelf, or one of
-- its balance shelves is closed (not found there = shortage), or the stocktake
-- is closed. Until then it is "remaining". The "it is on another shelf" note
-- while counting stays as it is.

create or replace function public.stocktake_stats4(p_ids uuid[])
returns table (
  stocktake_id uuid, shelves int, shelves_done int, skus int, counted_qty numeric,
  plus_qty numeric, plus_sum numeric, plus_nocost int,
  minus_qty numeric, minus_sum numeric,
  left_qty numeric, left_sum numeric, left_shelves int, left_skus int
)
language sql stable security definer set search_path = public, pg_temp
as $$
  with ids as (
    select id, status = 'closed' fin from public.stocktakes
     where id = any (p_ids) and company_id = public.auth_company_id()
  ), dz as (
    select z.stocktake_id sid, z.location_id lid from public.stocktake_zones z
     where z.stocktake_id in (select id from ids) and z.status = 'done'
  ), b as (
    select b.stocktake_id sid, b.product_id pid, b.location_id lid, b.book_qty q, b.unit_cost c
      from public.stocktake_book b join ids i on i.id = b.stocktake_id
  ), price as (
    select sid, pid, max(c) c from b group by 1, 2
  ), bt as (   -- the product's whole balance
    select sid, pid, sum(q) q from b group by 1, 2
  ), bdone as ( -- products with a balance line on a closed shelf
    select distinct b.sid, b.pid from b join dz on dz.sid = b.sid and dz.lid = b.lid
  ), ed as (
    select e.stocktake_id sid, e.product_id pid, sum(e.quantity) q
      from public.stocktake_entries e join ids i on i.id = e.stocktake_id
     where i.fin or exists (select 1 from dz where dz.sid = e.stocktake_id and dz.lid = e.location_id)
     group by 1, 2
  ), um as (   -- compared now (whole balance) or still remaining
    select bt.sid, bt.pid, bt.q,
           (i.fin or ed.pid is not null or bdone.pid is not null) engaged
      from bt join ids i on i.id = bt.sid
      left join ed on ed.sid = bt.sid and ed.pid = bt.pid
      left join bdone on bdone.sid = bt.sid and bdone.pid = bt.pid
  ), d as (
    select coalesce(um.sid, ed.sid) sid,
           coalesce(ed.q, 0) - coalesce(case when um.engaged then um.q end, 0) diff, p.c
      from um full join ed on ed.sid = um.sid and ed.pid = um.pid
      left join price p on p.sid = coalesce(um.sid, ed.sid) and p.pid = coalesce(um.pid, ed.pid)
     where um.pid is null or um.engaged or ed.pid is not null
  ), dd as (
    select sid,
           sum(diff) filter (where diff > 0) pq, sum(diff * coalesce(c, 0)) filter (where diff > 0) ps,
           count(*) filter (where diff > 0 and coalesce(c, 0) = 0) pn,
           -sum(diff) filter (where diff < 0) mq, -sum(diff * coalesce(c, 0)) filter (where diff < 0) ms
      from d group by sid
  ), lft as (
    select b.sid, sum(b.q) q, sum(b.q * coalesce(p.c, 0)) s,
           count(distinct b.lid) n, count(distinct b.pid) k
      from b join um on um.sid = b.sid and um.pid = b.pid and not um.engaged
      left join price p on p.sid = b.sid and p.pid = b.pid
     where b.sid in (select id from ids where not fin)
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
         coalesce(lft.q, 0), coalesce(lft.s, 0), coalesce(lft.n, 0)::int, coalesce(lft.k, 0)::int
    from ids s
    left join z on z.sid = s.id
    left join ee on ee.sid = s.id
    left join dd on dd.sid = s.id
    left join lft on lft.sid = s.id;
$$;
revoke all on function public.stocktake_stats4(uuid[]) from public, anon;
grant execute on function public.stocktake_stats4(uuid[]) to authenticated;
notify pgrst, 'reload schema';
