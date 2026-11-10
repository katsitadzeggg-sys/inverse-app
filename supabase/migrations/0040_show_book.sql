-- Whether counters see the book quantity of the shelf while counting.
-- On by default for now (testing); the manager can turn it off per stocktake
-- to go back to a blind count.
alter table public.stocktakes
  add column if not exists show_book boolean not null default true;

-- Book quantity per product on one shelf, for the counter — only when the
-- stocktake shows the book. Same company, and the caller may count it.
create or replace function public.shelf_book(p_stocktake uuid, p_location uuid)
returns table (product_id uuid, qty numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.product_id, sum(b.book_qty)::numeric
  from public.stocktake_book b
  join public.stocktakes s on s.id = b.stocktake_id
  where b.stocktake_id = p_stocktake
    and b.location_id = p_location
    and s.company_id = public.auth_company_id()
    and s.show_book
    and (public.auth_can_count(p_stocktake)
         or coalesce(public.auth_role()::text, '') in ('owner', 'admin'))
  group by b.product_id;
$$;

revoke execute on function public.shelf_book(uuid, uuid) from public, anon;
grant execute on function public.shelf_book(uuid, uuid) to authenticated;
