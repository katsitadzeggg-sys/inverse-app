-- 0068: a frozen item can be corrected when its shelf is reopened (Giorgi,
-- 26.11, 1P A--56). LEGO 71423 was missed on the first count, left empty in
-- the recount (0) and froze; the counter then found it, reopened the shelf
-- with "ჩასწორება" and could not add it: "item is frozen after three recounts".
--   * The guard blocks changes to a frozen item only while its shelf is closed
--     (zone done). A reopened shelf (zone counting) can be corrected.
--   * Closing the shelf again: a frozen item that now matches the book becomes
--     ok; one that still differs stays frozen (no new recount round).
-- Tenant isolation is unchanged: both functions read only rows of the same
-- stocktake and shelf, and close_stocktake_zone still checks auth_company_id().

create or replace function public.stocktake_entry_frozen_guard()
 returns trigger
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  r record;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  if r.product_id is not null
     and coalesce(public.auth_role()::text, '') not in ('owner', 'admin')
     and exists (select 1 from public.stocktake_checks c
                 where c.stocktake_id = r.stocktake_id and c.location_id = r.location_id
                   and c.product_id = r.product_id and c.status = 'frozen')
     and not exists (select 1 from public.stocktake_zones z
                     where z.stocktake_id = r.stocktake_id and z.location_id = r.location_id
                       and z.status <> 'done') then
    raise exception 'item is frozen';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

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
                   when sc.status = 'frozen' and excluded.status = 'ok' then 'ok'
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
