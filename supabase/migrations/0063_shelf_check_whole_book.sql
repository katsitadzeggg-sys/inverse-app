-- 0063: the shelf check and the shelf's differences follow the whole-balance
-- rule of 0062 (Giorgi, 18.11). Vera A--2: three detergents booked on K-02
-- (a provisional shelf), found on A--2 in the right quantity, showed +4, +5,
-- +11 and asked for a recount. Per product now:
--   * counted here = booked here                         → ok
--   * whole stocktake: counted = booked (every shelf)     → ok (only moved —
--     the note "from K-02" stays, as Giorgi wants)
--   * counted < booked and a booked shelf is still to be counted → ok for now
--     (the shortage shows when that shelf closes, or in the totals)
--   * otherwise                                           → recount, and the
--     difference shown is the product's whole difference.

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

  with here_c as (
    select e.product_id pid, sum(e.quantity) q from public.stocktake_entries e
     where e.stocktake_id = p_stocktake and e.location_id = p_location and e.product_id is not null
     group by 1
  ), here_b as (
    select b.product_id pid, sum(b.book_qty) q from public.stocktake_book b
     where b.stocktake_id = p_stocktake and b.location_id = p_location
     group by 1
  ), prods as (
    select pid from here_c union select pid from here_b
  ), cmp as (
    select p.pid as product_id,
           coalesce(hc.q, 0) = coalesce(hb.q, 0)
           or tc.q = tb.q
           or (tc.q < tb.q and exists (
                 select 1 from public.stocktake_book ob
                  where ob.stocktake_id = p_stocktake and ob.product_id = p.pid
                    and ob.location_id is not null and ob.location_id <> p_location
                    and not exists (select 1 from public.stocktake_zones z
                                     where z.stocktake_id = p_stocktake
                                       and z.location_id = ob.location_id and z.status = 'done')))
             as matches
      from prods p
      left join here_c hc on hc.pid = p.pid
      left join here_b hb on hb.pid = p.pid
      cross join lateral (select coalesce(sum(e.quantity), 0) q from public.stocktake_entries e
                           where e.stocktake_id = p_stocktake and e.product_id = p.pid) tc
      cross join lateral (select coalesce(sum(b.book_qty), 0) q from public.stocktake_book b
                           where b.stocktake_id = p_stocktake and b.product_id = p.pid) tb
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

-- The closed shelf's lines: a real difference (the product's whole one), or
-- only "moved" (diff 0, with the shelf it is booked on).
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
    with here_c as (
      select e.product_id pid, sum(e.quantity) q from public.stocktake_entries e
       where e.stocktake_id = p_stocktake and e.location_id = p_location and e.product_id is not null
       group by 1
    ), here_b as (
      select b.product_id pid, sum(b.book_qty) q from public.stocktake_book b
       where b.stocktake_id = p_stocktake and b.location_id = p_location
       group by 1
    ), prods as (
      select pid from here_c union select pid from here_b
    ), r as (
      select p.pid,
             coalesce(hc.q, 0) hq, coalesce(hb.q, 0) hbq, tc.q tcq, tb.q tbq,
             exists (
               select 1 from public.stocktake_book ob
                where ob.stocktake_id = p_stocktake and ob.product_id = p.pid
                  and ob.location_id is not null and ob.location_id <> p_location
                  and not exists (select 1 from public.stocktake_zones z
                                   where z.stocktake_id = p_stocktake
                                     and z.location_id = ob.location_id and z.status = 'done')) rem,
             (select string_agg(distinct l.code, ', ') from public.stocktake_book ob
                join public.locations l on l.id = ob.location_id
               where ob.stocktake_id = p_stocktake and ob.product_id = p.pid
                 and ob.location_id <> p_location) other
        from prods p
        left join here_c hc on hc.pid = p.pid
        left join here_b hb on hb.pid = p.pid
        cross join lateral (select coalesce(sum(e.quantity), 0) q from public.stocktake_entries e
                             where e.stocktake_id = p_stocktake and e.product_id = p.pid) tc
        cross join lateral (select coalesce(sum(b.book_qty), 0) q from public.stocktake_book b
                             where b.stocktake_id = p_stocktake and b.product_id = p.pid) tb
       where coalesce(hc.q, 0) <> coalesce(hb.q, 0)
    ), rows_ as (
      select coalesce(pr.name, '')::text n,
             coalesce(pr.barcode, pr.sku, '')::text cd,
             case when r.tcq = r.tbq then 0
                  when r.tcq < r.tbq and r.rem then 0
                  else r.tcq - r.tbq end::numeric d,
             case when r.hq > r.hbq then r.other end::text h
        from r left join public.products pr on pr.id = r.pid
    ), unknown as (
      select coalesce(e.unknown_label, '?')::text n, ''::text cd, sum(e.quantity)::numeric d, null::text h
        from public.stocktake_entries e
       where e.stocktake_id = p_stocktake and e.location_id = p_location and e.product_id is null
       group by 1
    )
    select x.n, x.cd, x.d, x.h from (
      select * from rows_ where d <> 0 or h is not null
      union all select * from unknown
    ) x
    order by (x.d = 0), 3, 1;
end;
$function$;

notify pgrst, 'reload schema';
