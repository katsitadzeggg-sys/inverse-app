-- Book lines with no shelf: the object's book is what counts. Once a product
-- has been counted on a closed shelf, its whole book is compared — a shortage
-- shows at once and the shelf asks for a recount, like any shelf difference.
-- Products not counted anywhere yet stay "remaining" until the stocktake closes.

-- 1) Closing a shelf: products with no-shelf book are checked against the
--    object's book (everything counted of them in this stocktake).
create or replace function public.close_stocktake_zone(p_stocktake uuid, p_location uuid)
 returns table(product_id uuid, product_name text, sku text, status stocktake_check_status, attempts smallint)
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
declare
  v_company uuid := public.auth_company_id();
  v_zone public.stocktake_zones;
begin
  select * into v_zone from public.stocktake_zones z
    where z.stocktake_id = p_stocktake and z.location_id = p_location and z.company_id = v_company;
  if v_zone.id is null then
    raise exception 'zone not found';
  end if;
  if v_zone.counter_id is distinct from auth.uid()
     and coalesce(public.auth_role()::text, '') not in ('owner', 'admin') then
    raise exception 'not your zone';
  end if;
  if (select s.status from public.stocktakes s where s.id = p_stocktake) <> 'open' then
    raise exception 'stocktake is closed';
  end if;

  with unloc as (
    select distinct b.product_id from public.stocktake_book b
     where b.stocktake_id = p_stocktake and b.location_id is null
  ),
  counted as (
    select e.product_id, sum(e.quantity) as qty
    from public.stocktake_entries e
    where e.stocktake_id = p_stocktake and e.location_id = p_location and e.product_id is not null
      and e.product_id not in (select product_id from unloc)
    group by e.product_id
  ),
  book as (
    select b.product_id, sum(b.book_qty) as qty
    from public.stocktake_book b
    where b.stocktake_id = p_stocktake and b.location_id = p_location
      and b.product_id not in (select product_id from unloc)
    group by b.product_id
  ),
  here as (  -- no-shelf products counted on this shelf: whole object compared
    select distinct e.product_id from public.stocktake_entries e
     where e.stocktake_id = p_stocktake and e.location_id = p_location
       and e.product_id in (select product_id from unloc)
  ),
  wh as (
    select h.product_id,
           (select coalesce(sum(e.quantity), 0) from public.stocktake_entries e
             where e.stocktake_id = p_stocktake and e.product_id = h.product_id)
           = (select coalesce(sum(b.book_qty), 0) from public.stocktake_book b
               where b.stocktake_id = p_stocktake and b.product_id = h.product_id) as matches
      from here h
  ),
  cmp as (
    select coalesce(c.product_id, b.product_id) as product_id,
           coalesce(c.qty, 0) = coalesce(b.qty, 0) as matches
      from counted c full join book b on b.product_id = c.product_id
    union all
    select product_id, matches from wh
  )
  insert into public.stocktake_checks as sc (company_id, stocktake_id, location_id, product_id, attempts, status)
  select v_company, p_stocktake, p_location, cmp.product_id,
         0,
         case when cmp.matches then 'ok'::public.stocktake_check_status else 'recount' end
  from cmp
  on conflict (stocktake_id, location_id, product_id) do update
    set attempts = case when excluded.status = 'ok' or sc.status <> 'recount' then sc.attempts
                        else sc.attempts + 1 end,
        status = case
                   when sc.status = 'frozen' then 'frozen'
                   when excluded.status = 'ok' then 'ok'
                   when sc.status = 'ok' then 'ok'
                   when sc.status = 'recount' then 'frozen'
                   else 'recount'
                 end::public.stocktake_check_status,
        updated_at = now();

  if not exists (select 1 from public.stocktake_checks c
                 where c.stocktake_id = p_stocktake and c.location_id = p_location and c.status = 'recount') then
    update public.stocktake_zones set status = 'done', done_at = now() where id = v_zone.id;
  end if;

  return query
    select c.product_id, p.name, p.sku, c.status, c.attempts
    from public.stocktake_checks c
    join public.products p on p.id = c.product_id
    where c.stocktake_id = p_stocktake and c.location_id = p_location and c.status <> 'ok'
    order by c.status, p.name;
end;
$function$;

-- 2) The closed shelf's differences: no-shelf products counted here show
--    their object-wide difference, surplus or shortage.
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
      where b.stocktake_id = p_stocktake and b.product_id in (
        select x.product_id from public.stocktake_book x
         where x.stocktake_id = p_stocktake and x.location_id is null)
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
             null::text as h
      from unloc u
      join (select e.product_id, sum(e.quantity) as qty
              from public.stocktake_entries e
             where e.stocktake_id = p_stocktake
               and e.product_id in (select e2.product_id from public.stocktake_entries e2
                                     where e2.stocktake_id = p_stocktake and e2.location_id = p_location)
             group by 1) t on t.product_id = u.product_id
      left join public.products p on p.id = u.product_id
      where t.qty <> u.qty
    )
    select r.n, r.cd, r.d, r.h from (select * from shelf_rows union all select * from wh) r
    order by 3, 1;
end;
$function$;

-- 3) Stats: a no-shelf product counted on a closed shelf is compared in full.
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
           case when i.fin or ed.pid is not null then bu.q else 0 end m
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
