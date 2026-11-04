-- Three modules on one platform: stock count (what exists), expiry-date count
-- and fixed assets. A stocktake belongs to one of them.
alter table public.stocktakes
  add column kind text not null default 'stock' check (kind in ('stock', 'expiry', 'assets'));
create index stocktakes_kind_idx on public.stocktakes (company_id, kind);

-- Expiry-date count: the book and the count are kept per batch (expiry date).
-- The recount rule still compares per product and shelf (all batches summed).
alter table public.stocktake_book    add column expiry_date date;
alter table public.stocktake_entries add column expiry_date date;

create unique index stocktake_book_batch_idx
  on public.stocktake_book (
    stocktake_id, product_id,
    coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(expiry_date, '0001-01-01'::date)
  );
-- The old per-product line index would block two batches of one product.
drop index public.stocktake_book_line_idx;
