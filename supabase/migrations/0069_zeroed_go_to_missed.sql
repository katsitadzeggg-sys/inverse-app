-- 0069: a product that left the balance uncounted goes to "missed", not "to
-- re-check" (Giorgi, 27.11, before loading 1P's new balance).
--   1) A new product in the new balance → missed (as before).
--   2) A product of an earlier balance that is gone (0) from the new one and
--      was never counted → stays, as missed with balance 0; the missed form
--      lists it with 0 and it must be counted (0 if it really is not there).
--   3) Counted products and old stocktakes do not change: their counts stay,
--      compared as before (and re-check when the balance moved meanwhile).
-- Only the status line of pool_lines changes (the old "zeroed → review" now
-- reads "zeroed → missed"); stocktake_pool_stats counts zeroed in any status.
-- Isolation unchanged: both read only the caller's company
-- (auth_company_id()) stocktakes.

create or replace function public.pool_lines(p_ids uuid[])
 returns table(product_id uuid, cur_qty numeric, ref_qty numeric, counted_qty numeric, price numeric, status text, zeroed boolean, moved boolean)
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  with ids as (
    select id, created_at, form_kind from public.stocktakes
     where id = any (p_ids) and company_id = public.auth_company_id() and kind <> 'assets'
  ), bk as (
    select b.stocktake_id sid, b.product_id pid, sum(b.book_qty) q, max(b.unit_cost) c,
           max(b.created_at) at
      from public.stocktake_book b join ids on ids.id = b.stocktake_id
     group by 1, 2
  ), cur_sid as (
    select bk.sid from bk join ids on ids.id = bk.sid
     where ids.form_kind is null
     group by bk.sid order by max(bk.at) desc limit 1
  ), cur as (
    select pid, q from bk where sid = (select sid from cur_sid)
  ), ever as (
    select pid from bk where q > 0
    union
    select l.product_id from public.stocktake_book_log l join ids on ids.id = l.stocktake_id
     where l.qty > 0
  ), price as (
    select pid, max(c) c from bk group by pid
  ), e as (
    select e.stocktake_id sid, e.product_id pid, e.quantity q,
           (e.created_at at time zone 'Asia/Tbilisi')::date d,
           coalesce(ids.form_kind = 'review', false) rv, ids.created_at sat
      from public.stocktake_entries e join ids on ids.id = e.stocktake_id
     where e.product_id is not null
  ), last_rv as (
    select distinct on (pid) pid, sid from e where rv order by pid, sat desc
  ), used as (
    select e.* from e left join last_rv r on r.pid = e.pid
     where (r.sid is null and not e.rv) or e.sid = r.sid
  ), cnt as (
    select pid, sum(q) q from used group by pid
  ), ref_sid as (
    select distinct on (pid) pid, sid from used order by pid, sat desc
  ), ref as (
    select r.pid, coalesce(bk.q, 0) q from ref_sid r left join bk on bk.sid = r.sid and bk.pid = r.pid
  ), snaps as (
    select l.stocktake_id sid, l.loaded_at ts, l.product_id pid, l.qty q
      from public.stocktake_book_log l join ids on ids.id = l.stocktake_id
    union all
    select b.stocktake_id, min(b.created_at) over (partition by b.stocktake_id), b.product_id, b.book_qty
      from public.stocktake_book b join ids on ids.id = b.stocktake_id
     where ids.form_kind is null
  ), sp as (
    select sid, ts, pid, sum(q) q from snaps group by 1, 2, 3
  ), pick as (
    select distinct on (d) d, sid, ts
      from (select distinct (ts at time zone 'Asia/Tbilisi')::date d, sid, ts from sp) x
     order by d, ts desc
  ), dq as (
    select pk.d, sp.pid, sp.q from pick pk join sp on sp.sid = pk.sid and sp.ts = pk.ts
  ), span as (
    select d, lead(d) over (order by d) nd from pick
  ), chg as (
    select s.d, s.nd, p.pid
      from span s cross join (select distinct pid from dq) p
      left join dq a on a.d = s.d and a.pid = p.pid
      left join dq b on b.d = s.nd and b.pid = p.pid
     where s.nd is not null and coalesce(a.q, 0) <> coalesce(b.q, 0)
  ), mv as (
    select distinct u.pid from used u join chg c on c.pid = u.pid and u.d >= c.d and u.d < c.nd
  ), all_p as (
    select pid from cur union select pid from cnt union select pid from ever
  )
  select a.pid, coalesce(cur.q, 0), ref.q, cnt.q, coalesce(price.c, 0),
         case
           when cnt.pid is null and coalesce(cur.q, 0) > 0 then 'missed'
           when cnt.pid is null and ever.pid is not null then 'missed'
           when cnt.pid is not null and (cnt.q <> coalesce(ref.q, 0) or mv.pid is not null) then 'review'
           else 'ok'
         end,
         cnt.pid is null and coalesce(cur.q, 0) <= 0 and ever.pid is not null,
         mv.pid is not null
    from all_p a
    left join cur on cur.pid = a.pid
    left join cnt on cnt.pid = a.pid
    left join ref on ref.pid = a.pid
    left join ever on ever.pid = a.pid
    left join price on price.pid = a.pid
    left join mv on mv.pid = a.pid;
$function$;

create or replace function public.stocktake_pool_stats(p_ids uuid[])
 returns table(missed_skus integer, missed_qty numeric, missed_sum numeric, review_skus integer, plus_qty numeric, plus_sum numeric, minus_qty numeric, minus_sum numeric, zeroed_skus integer, moved_skus integer)
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select
    (count(*) filter (where status = 'missed'))::int,
    coalesce(sum(cur_qty) filter (where status = 'missed'), 0),
    coalesce(sum(cur_qty * price) filter (where status = 'missed'), 0),
    (count(*) filter (where status = 'review'))::int,
    coalesce(sum(counted_qty - ref_qty) filter (where counted_qty > ref_qty), 0),
    coalesce(sum((counted_qty - ref_qty) * price) filter (where counted_qty > ref_qty), 0),
    coalesce(sum(ref_qty - counted_qty) filter (where counted_qty < ref_qty), 0),
    coalesce(sum((ref_qty - counted_qty) * price) filter (where counted_qty < ref_qty), 0),
    (count(*) filter (where zeroed))::int,
    (count(*) filter (where status = 'review' and moved))::int
  from public.pool_lines(p_ids);
$function$;
