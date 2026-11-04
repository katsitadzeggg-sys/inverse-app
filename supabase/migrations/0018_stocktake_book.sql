-- Book balances and the recount rule for stocktakes.
--
-- The manager loads the book balance (from Balance, FINA, 1C … via Excel).
-- Counters never read it. When a counter closes a zone, close_stocktake_zone()
-- compares what they counted with the book for that shelf and tells them only
-- which items to count again — never the book number.
--
-- Rule (Giorgi, 4 Nov 2026): an item that does not match may be corrected up to
-- three times. If it still does not match after the third recount it is frozen — the counter can no
-- longer change it — and it goes to the final recheck list for the manager.

create type public.stocktake_check_status as enum ('ok', 'recount', 'frozen');

create table public.stocktake_book (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  stocktake_id  uuid not null references public.stocktakes (id) on delete cascade,
  product_id    uuid not null references public.products (id) on delete cascade,
  -- Null when the book keeps the item per warehouse, not per shelf.
  location_id   uuid references public.locations (id) on delete cascade,
  book_qty      numeric(14, 3) not null,
  unit_cost     numeric(14, 4),
  created_at    timestamptz not null default now()
);
create unique index stocktake_book_line_idx
  on public.stocktake_book (stocktake_id, product_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index stocktake_book_stocktake_idx on public.stocktake_book (stocktake_id);

create table public.stocktake_checks (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  stocktake_id  uuid not null references public.stocktakes (id) on delete cascade,
  location_id   uuid not null references public.locations (id) on delete cascade,
  product_id    uuid not null references public.products (id) on delete cascade,
  attempts      smallint not null default 0 check (attempts between 0 and 3),
  status        public.stocktake_check_status not null default 'recount',
  updated_at    timestamptz not null default now(),
  unique (stocktake_id, location_id, product_id)
);
create index stocktake_checks_stocktake_idx on public.stocktake_checks (stocktake_id, location_id);

-- ---------------------------------------------------------------------------
-- RLS. The book is for owners/admins only: counters must not see it.
-- Checks are readable by the company (status and attempts, no quantities) and
-- written only by close_stocktake_zone().
-- ---------------------------------------------------------------------------
alter table public.stocktake_book   enable row level security;
alter table public.stocktake_checks enable row level security;
alter table public.stocktake_book   force row level security;
alter table public.stocktake_checks force row level security;

create policy stocktake_book_manage on public.stocktake_book
  for all to authenticated
  using (company_id = public.auth_company_id() and public.auth_role() in ('owner', 'admin'))
  with check (company_id = public.auth_company_id() and public.auth_role() in ('owner', 'admin'));

create policy stocktake_checks_select on public.stocktake_checks
  for select to authenticated
  using (company_id = public.auth_company_id());

grant select, insert, update, delete on public.stocktake_book to authenticated;
grant select on public.stocktake_checks to authenticated;
grant all on public.stocktake_book, public.stocktake_checks to service_role;

-- ---------------------------------------------------------------------------
-- A frozen item cannot be changed by a counter any more.
-- ---------------------------------------------------------------------------
create or replace function public.stocktake_entry_frozen_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  if r.product_id is not null
     and coalesce(public.auth_role()::text, '') not in ('owner', 'admin')
     and exists (select 1 from public.stocktake_checks c
                 where c.stocktake_id = r.stocktake_id and c.location_id = r.location_id
                   and c.product_id = r.product_id and c.status = 'frozen') then
    raise exception 'item is frozen after three recounts';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger stocktake_entries_frozen before insert or update or delete on public.stocktake_entries
  for each row execute function public.stocktake_entry_frozen_guard();

-- ---------------------------------------------------------------------------
-- close_stocktake_zone: compare the zone with the book and apply the rule.
-- Returns one row per item that is not yet fine — product, status, attempts —
-- and no quantities. An empty result means the zone is done.
-- ---------------------------------------------------------------------------
create or replace function public.close_stocktake_zone(p_stocktake uuid, p_location uuid)
returns table (product_id uuid, product_name text, sku text, status public.stocktake_check_status, attempts smallint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_company uuid := public.auth_company_id();
  v_zone public.stocktake_zones;
  v_has_shelf_book boolean;
begin
  select * into v_zone from public.stocktake_zones z
    where z.stocktake_id = p_stocktake and z.location_id = p_location and z.company_id = v_company;
  if v_zone.id is null then
    raise exception 'zone not found';
  end if;
  if v_zone.counter_id is distinct from auth.uid()
     and coalesce(public.auth_role()::text, '') not in ('owner', 'admin') then
    raise exception 'not your zone';
  end if;
  if (select s.status from public.stocktakes s where s.id = p_stocktake) <> 'open' then
    raise exception 'stocktake is closed';
  end if;

  -- Only books kept per shelf can be checked shelf by shelf; a book kept per
  -- warehouse is compared on the manager's screen at the end.
  select exists (select 1 from public.stocktake_book b
                 where b.stocktake_id = p_stocktake and b.location_id is not null)
    into v_has_shelf_book;

  if v_has_shelf_book then
    with counted as (
      select e.product_id, sum(e.quantity) as qty
      from public.stocktake_entries e
      where e.stocktake_id = p_stocktake and e.location_id = p_location and e.product_id is not null
      group by e.product_id
    ),
    book as (
      select b.product_id, sum(b.book_qty) as qty
      from public.stocktake_book b
      where b.stocktake_id = p_stocktake and b.location_id = p_location
      group by b.product_id
    ),
    cmp as (
      select coalesce(c.product_id, b.product_id) as product_id,
             coalesce(c.qty, 0) = coalesce(b.qty, 0) as matches
      from counted c full join book b on b.product_id = c.product_id
    )
    insert into public.stocktake_checks as sc (company_id, stocktake_id, location_id, product_id, attempts, status)
    select v_company, p_stocktake, p_location, cmp.product_id,
           0,
           case when cmp.matches then 'ok'::public.stocktake_check_status else 'recount' end
    from cmp
    on conflict (stocktake_id, location_id, product_id) do update
      set attempts = case when excluded.status = 'ok' or sc.status <> 'recount' then sc.attempts
                          else least(sc.attempts + 1, 3) end,
          status = case
                     when sc.status = 'frozen' then 'frozen'
                     when excluded.status = 'ok' then 'ok'
                     when sc.status = 'ok' then 'ok'
                     -- attempts counts recounts; the third failed recount freezes it
                     when sc.attempts + 1 >= 3 then 'frozen'
                     else 'recount'
                   end::public.stocktake_check_status,
          updated_at = now();
  end if;

  if not exists (select 1 from public.stocktake_checks c
                 where c.stocktake_id = p_stocktake and c.location_id = p_location and c.status = 'recount') then
    update public.stocktake_zones set status = 'done', done_at = now() where id = v_zone.id;
  end if;

  return query
    select c.product_id, p.name, p.sku, c.status, c.attempts
    from public.stocktake_checks c
    join public.products p on p.id = c.product_id
    where c.stocktake_id = p_stocktake and c.location_id = p_location and c.status <> 'ok'
    order by c.status, p.name;
end;
$$;

revoke execute on function public.close_stocktake_zone(uuid, uuid) from public;
grant execute on function public.close_stocktake_zone(uuid, uuid) to authenticated;
