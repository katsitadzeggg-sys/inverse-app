-- A new stock (or expiry) count of an object starts from that object's last
-- book: the rows of the latest stocktake of the same company, kind and branch
-- that has one. SECURITY DEFINER so a counter who opens the count gets it.
create or replace function public.copy_stock_book(p_stocktake uuid)
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
  if st.id is null or st.company_id <> auth_company_id() or st.kind not in ('stock', 'expiry') then
    return 0;
  end if;
  if exists (select 1 from stocktake_book where stocktake_id = st.id) then
    return 0;
  end if;
  select s.id into src
    from stocktakes s
   where s.company_id = st.company_id and s.kind = st.kind and s.id <> st.id
     and coalesce(s.branch, '') = coalesce(st.branch, '')
     and exists (select 1 from stocktake_book b where b.stocktake_id = s.id)
   order by s.created_at desc
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
$$;

revoke all on function public.copy_stock_book(uuid) from public;
grant execute on function public.copy_stock_book(uuid) to authenticated;
