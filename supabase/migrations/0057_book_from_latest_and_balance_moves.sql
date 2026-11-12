-- 1) A new stocktake takes the warehouse's latest balance loaded (not the
--    latest stocktake's, which may be a form with only a part of it).
-- 2) Turnover comes from the daily balances only (no turnover file): a product
--    whose balance changed from one morning to the next moved that day;
--    counted that day → "to re-check".
create or replace function public.copy_stock_book(p_stocktake uuid)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare
  st record;
  src uuid;
  n integer;
begin
  select id, company_id, branch, kind into st from stocktakes where id = p_stocktake;
  if st.id is null or st.company_id <> auth_company_id() or st.kind not in ('stock', 'expiry') then
    return 0;
  end if;
  if exists (select 1 from stocktake_book where stocktake_id = st.id) then
    return 0;
  end if;
  select s.id into src
    from stocktakes s join stocktake_book b on b.stocktake_id = s.id
   where s.company_id = st.company_id and s.kind = st.kind and s.id <> st.id
     and s.form_kind is null
     and coalesce(s.branch, '') = coalesce(st.branch, '')
   group by s.id
   order by max(b.created_at) desc
   limit 1;
  if src is null then
    return 0;
  end if;
  insert into stocktake_book (company_id, stocktake_id, product_id, location_id, book_qty, unit_cost, expiry_date)
  select company_id, st.id, product_id, location_id, book_qty, unit_cost, expiry_date
    from stocktake_book where stocktake_id = src;
  get diagnostics n = row_count;
  return n;
end;
$function$;

create or replace function public.pool_lines(p_ids uuid[])
returns table (
  product_id uuid, cur_qty numeric, ref_qty numeric, counted_qty numeric,
  price numeric, status text, zeroed boolean, moved boolean
)
language sql stable security definer set search_path = public, pg_temp
as $$
  with ids as (
    select id, created_at, form_kind from public.stocktakes
     where id = any (p_ids) and company_id = public.auth_company_id() and kind <> 'assets'
  ), bk as (
    select b.stocktake_id sid, b.product_id pid, sum(b.book_qty) q, max(b.unit_cost) c,
           max(b.created_at) at
      from public.stocktake_book b join ids on ids.id = b.stocktake_id
     group by 1, 2
  ), cur_sid as (   -- the latest balance loaded (the forms carry only a part of it)
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
  ), last_rv as (   -- the latest re-check form that counted the product
    select distinct on (pid) pid, sid from e where rv order by pid, sat desc
  ), used as (      -- its count replaces the earlier ones
    select e.* from e left join last_rv r on r.pid = e.pid
     where (r.sid is null and not e.rv) or e.sid = r.sid
  ), cnt as (
    select pid, sum(q) q from used group by pid
  ), ref_sid as (   -- the balance of the latest stocktake that counted it
    select distinct on (pid) pid, sid from used order by pid, sat desc
  ), ref as (
    select r.pid, coalesce(bk.q, 0) q from ref_sid r left join bk on bk.sid = r.sid and bk.pid = r.pid
  ), snaps as (    -- every balance loaded: the logged ones and the current ones
    select l.stocktake_id sid, l.loaded_at ts, l.product_id pid, l.qty q
      from public.stocktake_book_log l join ids on ids.id = l.stocktake_id
    union all
    select b.stocktake_id, min(b.created_at) over (partition by b.stocktake_id), b.product_id, b.book_qty
      from public.stocktake_book b join ids on ids.id = b.stocktake_id
     where ids.form_kind is null
  ), sp as (
    select sid, ts, pid, sum(q) q from snaps group by 1, 2, 3
  ), pick as (     -- one balance per day: the last one loaded that day
    select distinct on (d) d, sid, ts
      from (select distinct (ts at time zone 'Asia/Tbilisi')::date d, sid, ts from sp) x
     order by d, ts desc
  ), dq as (
    select pk.d, sp.pid, sp.q from pick pk join sp on sp.sid = pk.sid and sp.ts = pk.ts
  ), span as (
    select d, lead(d) over (order by d) nd from pick
  ), chg as (      -- the balance changed from one morning to the next: it moved in between
    select s.d, s.nd, p.pid
      from span s cross join (select distinct pid from dq) p
      left join dq a on a.d = s.d and a.pid = p.pid
      left join dq b on b.d = s.nd and b.pid = p.pid
     where s.nd is not null and coalesce(a.q, 0) <> coalesce(b.q, 0)
  ), mv as (       -- counted on a day its balance moved
    select distinct u.pid from used u join chg c on c.pid = u.pid and u.d >= c.d and u.d < c.nd
  ), all_p as (
    select pid from cur union select pid from cnt union select pid from ever
  )
  select a.pid, coalesce(cur.q, 0), ref.q, cnt.q, coalesce(price.c, 0),
         case
           when cnt.pid is null and coalesce(cur.q, 0) > 0 then 'missed'
           when cnt.pid is null and ever.pid is not null then 'review'
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
$$;
