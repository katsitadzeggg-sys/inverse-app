-- A new fixed-asset count of an object starts from that object's last register:
-- the rows of the latest stocktake of the same company and branch that has one.
-- SECURITY DEFINER so a counter who opens the count gets the register too
-- (the register itself stays manager-only to edit).
create or replace function public.copy_asset_register(p_stocktake uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  st record;
  src uuid;
  n integer;
begin
  select id, company_id, branch, kind into st from stocktakes where id = p_stocktake;
  if st.id is null or st.company_id <> auth_company_id() or st.kind <> 'assets' then
    return 0;
  end if;
  if exists (select 1 from asset_register where stocktake_id = st.id) then
    return 0;
  end if;
  select s.id into src
    from stocktakes s
   where s.company_id = st.company_id and s.kind = 'assets' and s.id <> st.id
     and coalesce(s.branch, '') = coalesce(st.branch, '')
     and exists (select 1 from asset_register r where r.stocktake_id = s.id)
   order by s.created_at desc
   limit 1;
  if src is null then
    return 0;
  end if;
  insert into asset_register (company_id, stocktake_id, inv_no, name, room, responsible, value, serial, group_name)
  select company_id, st.id, inv_no, name, room, responsible, value, serial, group_name
    from asset_register where stocktake_id = src;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.copy_asset_register(uuid) from public;
grant execute on function public.copy_asset_register(uuid) to authenticated;
