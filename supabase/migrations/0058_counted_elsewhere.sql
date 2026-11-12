-- While counting: the same product already counted on another shelf of this
-- stocktake, or in another stocktake of the same warehouse. The counter is told
-- (the counts are summed in the warehouse's comparison, so it shows once there).
create or replace function public.counted_elsewhere(p_stocktake uuid, p_location uuid, p_product uuid)
returns table (number text, shelf text, qty numeric)
language sql stable security definer set search_path = public, pg_temp
as $$
  with me as (
    select * from public.stocktakes
     where id = p_stocktake and company_id = public.auth_company_id()
  ), pool as (
    select s.id, s.number from public.stocktakes s, me
     where s.company_id = me.company_id and s.kind = me.kind and s.archived_at is null
       and coalesce(s.branch, s.client_name, s.name) = coalesce(me.branch, me.client_name, me.name)
  )
  select p.number, coalesce(l.code, '—'), sum(e.quantity)
    from public.stocktake_entries e
    join pool p on p.id = e.stocktake_id
    left join public.locations l on l.id = e.location_id
   where e.product_id = p_product
     and not (e.stocktake_id = p_stocktake and e.location_id is not distinct from p_location)
   group by 1, 2
  having sum(e.quantity) <> 0
   order by 1, 2;
$$;
revoke all on function public.counted_elsewhere(uuid, uuid, uuid) from public, anon;
grant execute on function public.counted_elsewhere(uuid, uuid, uuid) to authenticated;
