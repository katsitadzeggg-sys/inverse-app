-- Shelf check: one recount is enough. An item that still differs after the
-- counter's recount is accepted as counted (frozen), instead of asking up to
-- three times.
create or replace function public.close_stocktake_zone(p_stocktake uuid, p_location uuid)
returns table (product_id uuid, product_name text, sku text, status public.stocktake_check_status, attempts smallint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_company uuid := public.auth_company_id();
  v_zone public.stocktake_zones;
  v_has_shelf_book boolean;
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

  -- Only books kept per shelf can be checked shelf by shelf; a book kept per
  -- warehouse is compared on the manager's screen at the end.
  select exists (select 1 from public.stocktake_book b
                 where b.stocktake_id = p_stocktake and b.location_id is not null)
    into v_has_shelf_book;

  if v_has_shelf_book then
    with counted as (
      select e.product_id, sum(e.quantity) as qty
      from public.stocktake_entries e
      where e.stocktake_id = p_stocktake and e.location_id = p_location and e.product_id is not null
      group by e.product_id
    ),
    book as (
      select b.product_id, sum(b.book_qty) as qty
      from public.stocktake_book b
      where b.stocktake_id = p_stocktake and b.location_id = p_location
      group by b.product_id
    ),
    cmp as (
      select coalesce(c.product_id, b.product_id) as product_id,
             coalesce(c.qty, 0) = coalesce(b.qty, 0) as matches
      from counted c full join book b on b.product_id = c.product_id
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
                     -- the first recount that still differs is accepted (frozen)
                     when sc.status = 'recount' then 'frozen' -- one recount is enough
                     else 'recount'
                   end::public.stocktake_check_status,
          updated_at = now();
  end if;

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
$$;
