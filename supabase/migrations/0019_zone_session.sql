-- One shelf at a time, a note per shelf, and an explicit close (Giorgi, 4 Nov 2026).
--
-- A counter works one zone at a time: a second open zone for the same counter
-- in the same stocktake is refused until the first is closed. After the book
-- check only the items that differ stay on screen; the counter fixes them or
-- presses Close, which freezes whatever is still unresolved and sends it to the
-- final recheck list.

alter table public.stocktake_zones add column note text check (note is null or length(note) <= 2000);

create unique index stocktake_zones_one_open_per_counter
  on public.stocktake_zones (stocktake_id, counter_id)
  where status = 'counting';

create or replace function public.finish_stocktake_zone(p_stocktake uuid, p_location uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_zone public.stocktake_zones;
begin
  select * into v_zone from public.stocktake_zones z
    where z.stocktake_id = p_stocktake and z.location_id = p_location
      and z.company_id = public.auth_company_id();
  if v_zone.id is null then
    raise exception 'zone not found';
  end if;
  if v_zone.counter_id is distinct from auth.uid()
     and coalesce(public.auth_role()::text, '') not in ('owner', 'admin') then
    raise exception 'not your zone';
  end if;
  update public.stocktake_checks c set status = 'frozen', updated_at = now()
    where c.stocktake_id = p_stocktake and c.location_id = p_location and c.status = 'recount';
  update public.stocktake_zones set status = 'done', done_at = now() where id = v_zone.id;
end;
$$;

revoke execute on function public.finish_stocktake_zone(uuid, uuid) from public;
grant execute on function public.finish_stocktake_zone(uuid, uuid) to authenticated;
