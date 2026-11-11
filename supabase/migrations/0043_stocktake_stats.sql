-- One line of figures per stocktake for the manager's list: shelves done,
-- entries, book lines, products counted, surplus / shortage in quantity and
-- money (unit cost from the book), as in the act. Runs as the caller (RLS).
create or replace function public.stocktake_stats(p_ids uuid[])
returns table (
  stocktake_id uuid, shelves int, shelves_done int, entries int, book_lines int,
  products int, plus_qty numeric, plus_sum numeric, minus_qty numeric, minus_sum numeric
)
language sql stable security invoker set search_path = public, pg_temp
as $$
  with b as (
    select stocktake_id, product_id, sum(book_qty) q, max(unit_cost) c, count(*) n
      from public.stocktake_book where stocktake_id = any (p_ids) group by 1, 2
  ), e as (
    select stocktake_id, product_id, sum(quantity) q, count(*) n
      from public.stocktake_entries where stocktake_id = any (p_ids) group by 1, 2
  ), d as (
    select coalesce(b.stocktake_id, e.stocktake_id) sid,
           coalesce(e.q, 0) - coalesce(b.q, 0) diff, coalesce(b.c, 0) c
      from b full join e
        on e.stocktake_id = b.stocktake_id and e.product_id = b.product_id
  ), z as (
    select stocktake_id, count(*) n, count(*) filter (where status = 'done') done
      from public.stocktake_zones where stocktake_id = any (p_ids) group by 1
  )
  select s.id,
         coalesce((select z.n from z where z.stocktake_id = s.id), 0)::int,
         coalesce((select z.done from z where z.stocktake_id = s.id), 0)::int,
         coalesce((select sum(e.n) from e where e.stocktake_id = s.id), 0)::int,
         coalesce((select sum(b.n) from b where b.stocktake_id = s.id), 0)::int,
         (select count(*) from e where e.stocktake_id = s.id)::int,
         coalesce((select sum(diff) from d where sid = s.id and diff > 0), 0),
         coalesce((select sum(diff * c) from d where sid = s.id and diff > 0), 0),
         coalesce((select -sum(diff) from d where sid = s.id and diff < 0), 0),
         coalesce((select -sum(diff * c) from d where sid = s.id and diff < 0), 0)
    from unnest(p_ids) s (id);
$$;
revoke all on function public.stocktake_stats(uuid[]) from public, anon;
grant execute on function public.stocktake_stats(uuid[]) to authenticated;
