-- A count of one warehouse runs for days: several stocktakes, a fresh balance
-- every morning, sales in between.
--  1) stocktake_book_log  — a stocktake's previous balance, kept when it is
--     replaced, so "it was in the first balance" is never lost.
--  2) spread_book         — the morning balance loaded into one open stocktake
--     goes to the other open stocktakes of the warehouse; closed ones keep theirs.
--  3) stocktake_moves     — turnover per product and day (sales, receipts...).
--  4) pool_lines          — one line per product over the warehouse's stocktakes:
--     missed / review / ok, and why. pool stats and the forms are built on it.
--  5) open_review_form    — the "to re-check" form; its count replaces the
--     earlier ones for its products.

-- 1) -------------------------------------------------------------------------
create table if not exists public.stocktake_book_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  stocktake_id uuid not null references public.stocktakes (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  qty numeric(14, 3) not null,
  loaded_at timestamptz not null,
  logged_at timestamptz not null default now()
);
create index if not exists stocktake_book_log_st_idx on public.stocktake_book_log (stocktake_id);
alter table public.stocktake_book_log enable row level security;
create policy stocktake_book_log_select on public.stocktake_book_log
  for select to authenticated using (company_id = public.auth_company_id());

-- Keeps a stocktake's current balance in the log (before it is replaced).
create or replace function public.log_book(p_stocktake uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(public.auth_role()::text, '') not in ('owner', 'admin') then
    raise exception 'not allowed';
  end if;
  insert into public.stocktake_book_log (company_id, stocktake_id, product_id, qty, loaded_at)
  select b.company_id, b.stocktake_id, b.product_id, sum(b.book_qty), min(b.created_at)
    from public.stocktake_book b join public.stocktakes s on s.id = b.stocktake_id
   where b.stocktake_id = p_stocktake and s.company_id = public.auth_company_id()
   group by 1, 2, 3;
end;
$$;
revoke all on function public.log_book(uuid) from public, anon;
grant execute on function public.log_book(uuid) to authenticated;

-- 2) -------------------------------------------------------------------------
create or replace function public.spread_book(p_from uuid)
returns table (number text, stale boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  co uuid := public.auth_company_id();
  src public.stocktakes;
  sib record;
  today date := (now() at time zone 'Asia/Tbilisi')::date;
begin
  if coalesce(public.auth_role()::text, '') not in ('owner', 'admin') then
    raise exception 'not allowed';
  end if;
  select * into src from public.stocktakes where id = p_from and company_id = co;
  if src.id is null or src.status <> 'open' then raise exception 'not open'; end if;
  for sib in
    select s.id from public.stocktakes s
     where s.company_id = co and s.status = 'open' and s.archived_at is null
       and s.kind = src.kind and s.form_kind is null and s.id <> src.id
       and coalesce(s.branch, s.client_name, s.name) = coalesce(src.branch, src.client_name, src.name)
  loop
    insert into public.stocktake_book_log (company_id, stocktake_id, product_id, qty, loaded_at)
    select company_id, stocktake_id, product_id, sum(book_qty), min(created_at)
      from public.stocktake_book where stocktake_id = sib.id group by 1, 2, 3;
    delete from public.stocktake_book where stocktake_id = sib.id;
    insert into public.stocktake_book
      (company_id, stocktake_id, product_id, location_id, book_qty, unit_cost, expiry_date)
    select company_id, sib.id, product_id, location_id, book_qty, unit_cost, expiry_date
      from public.stocktake_book where stocktake_id = src.id;
  end loop;
  -- The open stocktakes of the warehouse (the source too); "stale" = counted
  -- before today, so its count now meets today's balance.
  return query
    select s.number, exists (
             select 1 from public.stocktake_entries e
              where e.stocktake_id = s.id
                and (e.created_at at time zone 'Asia/Tbilisi')::date < today)
      from public.stocktakes s
     where s.company_id = co and s.status = 'open' and s.archived_at is null
       and s.kind = src.kind and s.form_kind is null
       and coalesce(s.branch, s.client_name, s.name) = coalesce(src.branch, src.client_name, src.name)
     order by s.number;
end;
$$;
revoke all on function public.spread_book(uuid) from public, anon;
grant execute on function public.spread_book(uuid) to authenticated;

-- 3) -------------------------------------------------------------------------
create table if not exists public.stocktake_moves (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  stocktake_id uuid not null references public.stocktakes (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  day date not null,
  qty numeric(14, 3) not null,
  created_at timestamptz not null default now(),
  unique (stocktake_id, product_id, day)
);
alter table public.stocktake_moves enable row level security;
create policy stocktake_moves_select on public.stocktake_moves
  for select to authenticated using (company_id = public.auth_company_id());
create policy stocktake_moves_insert on public.stocktake_moves
  for insert to authenticated with check (
    company_id = public.auth_company_id()
    and coalesce(public.auth_role()::text, '') in ('owner', 'admin'));
create policy stocktake_moves_delete on public.stocktake_moves
  for delete to authenticated using (
    company_id = public.auth_company_id()
    and coalesce(public.auth_role()::text, '') in ('owner', 'admin'));

-- 4) -------------------------------------------------------------------------
-- status: 'missed'  — in today's balance, counted nowhere;
--         'review'  — counted and differs, or gone from the balance uncounted
--                     (zeroed), or moved on the day it was counted (moved);
--         'ok'.
create or replace function public.pool_lines(p_ids uuid[])
returns table (
  product_id uuid, cur_qty numeric, ref_qty numeric, counted_qty numeric,
  price numeric, status text, zeroed boolean, moved boolean
)
language sql stable security definer set search_path = public, pg_temp
as $$
  with ids as (
    select id, created_at, form_kind from public.stocktakes
     where id = any (p_ids) and company_id = public.auth_company_id() and kind <> 'assets'
  ), bk as (
    select b.stocktake_id sid, b.product_id pid, sum(b.book_qty) q, max(b.unit_cost) c,
           max(b.created_at) at
      from public.stocktake_book b join ids on ids.id = b.stocktake_id
     group by 1, 2
  ), cur_sid as (   -- the latest balance loaded (the forms carry only a part of it)
    select bk.sid from bk join ids on ids.id = bk.sid
     where ids.form_kind is null
     group by bk.sid order by max(bk.at) desc limit 1
  ), cur as (
    select pid, q from bk where sid = (select sid from cur_sid)
  ), ever as (
    select pid from bk where q > 0
    union
    select l.product_id from public.stocktake_book_log l join ids on ids.id = l.stocktake_id
     where l.qty > 0
  ), price as (
    select pid, max(c) c from bk group by pid
  ), e as (
    select e.stocktake_id sid, e.product_id pid, e.quantity q,
           (e.created_at at time zone 'Asia/Tbilisi')::date d,
           coalesce(ids.form_kind = 'review', false) rv, ids.created_at sat
      from public.stocktake_entries e join ids on ids.id = e.stocktake_id
     where e.product_id is not null
  ), last_rv as (   -- the latest re-check form that counted the product
    select distinct on (pid) pid, sid from e where rv order by pid, sat desc
  ), used as (      -- its count replaces the earlier ones
    select e.* from e left join last_rv r on r.pid = e.pid
     where (r.sid is null and not e.rv) or e.sid = r.sid
  ), cnt as (
    select pid, sum(q) q from used group by pid
  ), ref_sid as (   -- the balance of the latest stocktake that counted it
    select distinct on (pid) pid, sid from used order by pid, sat desc
  ), ref as (
    select r.pid, coalesce(bk.q, 0) q from ref_sid r left join bk on bk.sid = r.sid and bk.pid = r.pid
  ), mv as (
    select distinct u.pid from used u
      join public.stocktake_moves m on m.product_id = u.pid and m.day = u.d and m.qty <> 0
      join ids on ids.id = m.stocktake_id
  ), all_p as (
    select pid from cur union select pid from cnt union select pid from ever
  )
  select a.pid, coalesce(cur.q, 0), ref.q, cnt.q, coalesce(price.c, 0),
         case
           when cnt.pid is null and coalesce(cur.q, 0) > 0 then 'missed'
           when cnt.pid is null and ever.pid is not null then 'review'
           when cnt.pid is not null and (cnt.q <> coalesce(ref.q, 0) or mv.pid is not null) then 'review'
           else 'ok'
         end,
         cnt.pid is null and coalesce(cur.q, 0) <= 0 and ever.pid is not null,
         mv.pid is not null
    from all_p a
    left join cur on cur.pid = a.pid
    left join cnt on cnt.pid = a.pid
    left join ref on ref.pid = a.pid
    left join ever on ever.pid = a.pid
    left join price on price.pid = a.pid
    left join mv on mv.pid = a.pid;
$$;
revoke all on function public.pool_lines(uuid[]) from public, anon;
grant execute on function public.pool_lines(uuid[]) to authenticated;

drop function if exists public.stocktake_pool_stats(uuid[]);
create function public.stocktake_pool_stats(p_ids uuid[])
returns table (
  missed_skus int, missed_qty numeric, missed_sum numeric,
  review_skus int, plus_qty numeric, plus_sum numeric, minus_qty numeric, minus_sum numeric,
  zeroed_skus int, moved_skus int
)
language sql stable security definer set search_path = public, pg_temp
as $$
  select
    (count(*) filter (where status = 'missed'))::int,
    coalesce(sum(cur_qty) filter (where status = 'missed'), 0),
    coalesce(sum(cur_qty * price) filter (where status = 'missed'), 0),
    (count(*) filter (where status = 'review'))::int,
    coalesce(sum(counted_qty - ref_qty) filter (where counted_qty > ref_qty), 0),
    coalesce(sum((counted_qty - ref_qty) * price) filter (where counted_qty > ref_qty), 0),
    coalesce(sum(ref_qty - counted_qty) filter (where counted_qty < ref_qty), 0),
    coalesce(sum((ref_qty - counted_qty) * price) filter (where counted_qty < ref_qty), 0),
    (count(*) filter (where status = 'review' and zeroed))::int,
    (count(*) filter (where status = 'review' and moved))::int
  from public.pool_lines(p_ids);
$$;
revoke all on function public.stocktake_pool_stats(uuid[]) from public, anon;
grant execute on function public.stocktake_pool_stats(uuid[]) to authenticated;

-- 5) The forms, both built on pool_lines. ------------------------------------
create or replace function public.open_pool_form(p_ids uuid[], p_kind text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  co uuid := public.auth_company_id();
  ids uuid[];
  src public.stocktakes;
  found uuid;
  new_id uuid;
begin
  if coalesce(public.auth_role()::text, '') not in ('owner', 'admin') then
    raise exception 'not allowed';
  end if;
  if p_kind not in ('missed', 'review') then raise exception 'kind'; end if;
  select array_agg(id) into ids from public.stocktakes
   where id = any (p_ids) and company_id = co and kind <> 'assets';
  if ids is null then raise exception 'not found'; end if;
  select id into found from public.stocktakes
   where id = any (ids) and form_kind = p_kind and status = 'open'
   order by created_at desc limit 1;
  if found is not null then return found; end if;
  -- Today's balance: the stocktake with the latest balance loaded.
  select s.* into src from public.stocktakes s
    join public.stocktake_book b on b.stocktake_id = s.id
   where s.id = any (ids) and s.form_kind is null
   group by s.id order by max(b.created_at) desc limit 1;
  if src.id is null then raise exception 'no book'; end if;
  insert into public.stocktakes
    (company_id, name, client_name, branch, address, lat, lng, kind, created_by, form_kind)
  values
    (co, src.name, src.client_name, src.branch, src.address, src.lat, src.lng, 'stock',
     auth.uid(), p_kind)
  returning id into new_id;
  insert into public.stocktake_book
    (company_id, stocktake_id, product_id, location_id, book_qty, unit_cost, expiry_date)
  select co, new_id, b.product_id, b.location_id, b.book_qty, b.unit_cost, b.expiry_date
    from public.stocktake_book b
   where b.stocktake_id = src.id
     and b.product_id in (select l.product_id from public.pool_lines(ids) l where l.status = p_kind);
  -- Gone from today's balance: a zero line, so the counters still see it.
  insert into public.stocktake_book (company_id, stocktake_id, product_id, location_id, book_qty, unit_cost)
  select co, new_id, p.product_id, null, 0, nullif(p.price, 0)
    from public.pool_lines(ids) p
   where p.status = p_kind
     and not exists (select 1 from public.stocktake_book b
                      where b.stocktake_id = new_id and b.product_id = p.product_id);
  return new_id;
end;
$$;
revoke all on function public.open_pool_form(uuid[], text) from public, anon;
grant execute on function public.open_pool_form(uuid[], text) to authenticated;

-- Kept for the button already deployed.
create or replace function public.open_missed_form(p_ids uuid[])
returns uuid language sql security definer set search_path = public, pg_temp as $$
  select public.open_pool_form(p_ids, 'missed');
$$;
