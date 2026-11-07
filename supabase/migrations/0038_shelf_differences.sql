-- After a shelf is closed, its counter sees the differences against the book
-- (the book itself stays hidden from counters while counting: blind count).
create or replace function public.shelf_differences(p_stocktake uuid, p_location uuid)
returns table (product_name text, code text, diff numeric)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
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
    with counted as (
      select coalesce(e.product_id::text, '?' || e.unknown_label) as k, e.product_id, max(e.unknown_label) as label, sum(e.quantity) as qty
      from public.stocktake_entries e
      where e.stocktake_id = p_stocktake and e.location_id = p_location
      group by 1, 2
    ),
    book as (
      select b.product_id::text as k, b.product_id, sum(b.book_qty) as qty
      from public.stocktake_book b
      where b.stocktake_id = p_stocktake and b.location_id = p_location
      group by 1, 2
    )
    select coalesce(p.name, c.label, '')::text,
           coalesce(p.barcode, p.sku, '')::text,
           coalesce(c.qty, 0) - coalesce(b.qty, 0)
    from counted c
    full join book b on b.k = c.k
    left join public.products p on p.id = coalesce(c.product_id, b.product_id)
    where coalesce(c.qty, 0) <> coalesce(b.qty, 0)
    order by 3, 1;
end;
$$;

revoke all on function public.shelf_differences(uuid, uuid) from public;
grant execute on function public.shelf_differences(uuid, uuid) to authenticated;
