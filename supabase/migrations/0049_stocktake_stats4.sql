-- Book lines with no shelf are matched at warehouse level: while the
-- stocktake is open, what was counted of such a product on closed shelves is
-- matched against its book; only a count above the book is surplus, the rest
-- of the book stays "remaining" until found or the stocktake is closed.
-- Also returns left_skus (products still to count).
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
    select b.stocktake_id sid, b.product_id pid, b.location_id lid, b.book_qty q, b.unit_cost c,
           (i.fin or exists (select 1 from dz where dz.sid = b.stocktake_id and dz.lid = b.location_id)) on_done
      from public.stocktake_book b join ids i on i.id = b.stocktake_id
  ), price as (
    select sid, pid, max(c) c from b group by 1, 2
  ), bs as (   -- shelved book on closed shelves
    select sid, pid, sum(q) q from b where lid is not null and on_done group by 1, 2
  ), bu as (   -- book with no shelf
    select sid, pid, sum(q) q from b where lid is null group by 1, 2
  ), ed as (
    select e.stocktake_id sid, e.product_id pid, sum(e.quantity) q
      from public.stocktake_entries e join ids i on i.id = e.stocktake_id
     where i.fin or exists (select 1 from dz where dz.sid = e.stocktake_id and dz.lid = e.location_id)
     group by 1, 2
  ), um as (   -- the part of the no-shelf book matched so far
    select bu.sid, bu.pid, bu.q,
           case when i.fin then bu.q
                else least(bu.q, greatest(coalesce(ed.q, 0) - coalesce(bs.q, 0), 0)) end m
      from bu join ids i on i.id = bu.sid
      left join ed on ed.sid = bu.sid and ed.pid = bu.pid
      left join bs on bs.sid = bu.sid and bs.pid = bu.pid
  ), bd as (
    select sid, pid, sum(q) q from (
      select sid, pid, q from bs union all select sid, pid, m from um
    ) x group by 1, 2
  ), d as (
    select coalesce(bd.sid, ed.sid) sid, coalesce(ed.q, 0) - coalesce(bd.q, 0) diff, p.c
      from bd full join ed on ed.sid = bd.sid and ed.pid is not distinct from bd.pid
      left join price p on p.sid = coalesce(bd.sid, ed.sid) and p.pid = coalesce(bd.pid, ed.pid)
  ), dd as (
    select sid,
           sum(diff) filter (where diff > 0) pq, sum(diff * coalesce(c, 0)) filter (where diff > 0) ps,
           count(*) filter (where diff > 0 and coalesce(c, 0) = 0) pn,
           -sum(diff) filter (where diff < 0) mq, -sum(diff * coalesce(c, 0)) filter (where diff < 0) ms
      from d group by sid
  ), lrows as (
    select sid, pid, lid, q from b where lid is not null and not on_done
    union all
    select sid, pid, null, q - m from um where q - m <> 0
  ), lft as (
    select l.sid, sum(l.q) q, sum(l.q * coalesce(p.c, 0)) s,
           count(distinct l.lid) n, count(distinct l.pid) k
      from lrows l left join price p on p.sid = l.sid and p.pid = l.pid
     where l.sid in (select id from ids where not fin)
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
