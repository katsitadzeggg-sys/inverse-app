-- Several stocktakes of one warehouse (people counting in parallel) seen as one
-- count: the book once per product (the same balance is loaded into each),
-- the counts summed over all of them.
--   missed  (გამორჩენილი)     — in the book, counted in none of them;
--   review  (გადასამოწმებელი) — counted, but the total differs from the book.
create or replace function public.stocktake_pool_stats(p_ids uuid[])
returns table (
  missed_skus int, missed_qty numeric, missed_sum numeric,
  review_skus int, plus_qty numeric, plus_sum numeric, minus_qty numeric, minus_sum numeric
)
language sql stable security definer set search_path = public, pg_temp
as $$
  with ids as (
    select id from public.stocktakes
     where id = any (p_ids) and company_id = public.auth_company_id()
  ), bk as (
    select b.stocktake_id sid, b.product_id pid, sum(b.book_qty) q, max(b.unit_cost) c
      from public.stocktake_book b join ids on ids.id = b.stocktake_id
     group by 1, 2
  ), book as (
    select pid, max(q) q, max(c) c from bk group by pid
  ), cnt as (
    select e.product_id pid, sum(e.quantity) q
      from public.stocktake_entries e join ids on ids.id = e.stocktake_id
     where e.product_id is not null
     group by 1
  ), d as (
    select coalesce(book.q, 0) bq, cnt.q cq, coalesce(book.c, 0) c
      from book full join cnt on cnt.pid = book.pid
  )
  select
    (count(*) filter (where cq is null and bq > 0))::int,
    coalesce(sum(bq) filter (where cq is null and bq > 0), 0),
    coalesce(sum(bq * c) filter (where cq is null and bq > 0), 0),
    (count(*) filter (where cq is not null and cq <> bq))::int,
    coalesce(sum(cq - bq) filter (where cq > bq), 0),
    coalesce(sum((cq - bq) * c) filter (where cq > bq), 0),
    coalesce(sum(bq - cq) filter (where cq < bq), 0),
    coalesce(sum((bq - cq) * c) filter (where cq < bq), 0)
  from d;
$$;
revoke all on function public.stocktake_pool_stats(uuid[]) from public, anon;
grant execute on function public.stocktake_pool_stats(uuid[]) to authenticated;
