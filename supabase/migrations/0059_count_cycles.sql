-- Count cycles (e.g. a quarter): the stocktakes of one warehouse are one count
-- only within a cycle. Closing a cycle freezes its result for analytics; the
-- next stocktake of that warehouse starts a new cycle, so its missed / to
-- re-check products start from scratch and never mix with the old ones.

-- 1) -------------------------------------------------------------------------
-- How often the company counts: it only names the cycles (2026 ნოემბერი /
-- 2026 Q4 / 2026 H2 / 2026); a cycle still ends when the manager closes it.
alter table public.companies
  add column if not exists cycle_period text not null default 'quarter'
  check (cycle_period in ('month', 'quarter', 'half', 'year'));

create table if not exists public.count_cycles (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  warehouse   text not null,
  started_at  timestamptz not null default now(),
  closed_at   timestamptz,
  closed_by   uuid references auth.users (id) on delete set null,
  summary     jsonb
);
create unique index if not exists count_cycles_one_open
  on public.count_cycles (company_id, warehouse) where closed_at is null;
create index if not exists count_cycles_company_idx on public.count_cycles (company_id, warehouse, started_at);
alter table public.count_cycles enable row level security;
drop policy if exists count_cycles_select on public.count_cycles;
create policy count_cycles_select on public.count_cycles
  for select to authenticated using (company_id = public.auth_company_id());

-- Per product, as it stood when the cycle was closed.
create table if not exists public.count_cycle_lines (
  cycle_id    uuid not null references public.count_cycles (id) on delete cascade,
  company_id  uuid not null references public.companies (id) on delete cascade,
  product_id  uuid not null references public.products (id) on delete cascade,
  book        numeric(14, 3) not null,
  counted     numeric(14, 3),
  price       numeric(14, 4) not null default 0,
  status      text not null,
  primary key (cycle_id, product_id)
);
create index if not exists count_cycle_lines_product_idx on public.count_cycle_lines (company_id, product_id);
alter table public.count_cycle_lines enable row level security;
drop policy if exists count_cycle_lines_select on public.count_cycle_lines;
create policy count_cycle_lines_select on public.count_cycle_lines
  for select to authenticated using (company_id = public.auth_company_id());

alter table public.stocktakes
  add column if not exists cycle_id uuid references public.count_cycles (id) on delete set null;
create index if not exists stocktakes_cycle_idx on public.stocktakes (cycle_id);

-- 2) A new stocktake joins its warehouse's open cycle (one is started if none).
create or replace function public.stocktake_cycle()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  wh text := coalesce(nullif(new.branch, ''), nullif(new.client_name, ''), new.name);
  c uuid;
begin
  if new.kind = 'assets' or new.cycle_id is not null then return new; end if;
  select id into c from public.count_cycles
   where company_id = new.company_id and warehouse = wh and closed_at is null;
  if c is null then
    insert into public.count_cycles (company_id, warehouse) values (new.company_id, wh)
    on conflict do nothing returning id into c;
    if c is null then
      select id into c from public.count_cycles
       where company_id = new.company_id and warehouse = wh and closed_at is null;
    end if;
  end if;
  new.cycle_id := c;
  return new;
end;
$$;
drop trigger if exists stocktakes_cycle on public.stocktakes;
create trigger stocktakes_cycle before insert on public.stocktakes
  for each row execute function public.stocktake_cycle();

-- Existing stocktakes: one open cycle per warehouse, holding all of them.
insert into public.count_cycles (company_id, warehouse, started_at)
select company_id, coalesce(nullif(branch, ''), nullif(client_name, ''), name), min(created_at)
  from public.stocktakes
 where kind <> 'assets' and cycle_id is null
 group by 1, 2
on conflict do nothing;
update public.stocktakes s
   set cycle_id = c.id
  from public.count_cycles c
 where s.cycle_id is null and s.kind <> 'assets'
   and c.company_id = s.company_id and c.closed_at is null
   and c.warehouse = coalesce(nullif(s.branch, ''), nullif(s.client_name, ''), s.name);

-- 3) Daily balance and "counted elsewhere" stay within the cycle.
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
       and s.cycle_id is not distinct from src.cycle_id
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
  return query
    select s.number, exists (
             select 1 from public.stocktake_entries e
              where e.stocktake_id = s.id
                and (e.created_at at time zone 'Asia/Tbilisi')::date < today)
      from public.stocktakes s
     where s.company_id = co and s.status = 'open' and s.archived_at is null
       and s.kind = src.kind and s.form_kind is null
       and s.cycle_id is not distinct from src.cycle_id
       and coalesce(s.branch, s.client_name, s.name) = coalesce(src.branch, src.client_name, src.name)
     order by s.number;
end;
$$;
revoke all on function public.spread_book(uuid) from public, anon;
grant execute on function public.spread_book(uuid) to authenticated;

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
       and s.cycle_id is not distinct from me.cycle_id
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

-- 4) Closing a cycle: its stocktakes still open are closed, every product's
--    result is frozen (count_cycle_lines) with a summary for analytics.
create or replace function public.close_count_cycle(p_cycle uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  co uuid := public.auth_company_id();
  cy public.count_cycles;
  ids uuid[];
  n_open int;
  s jsonb;
begin
  if coalesce(public.auth_role()::text, '') not in ('owner', 'admin') then
    raise exception 'not allowed';
  end if;
  select * into cy from public.count_cycles where id = p_cycle and company_id = co for update;
  if cy.id is null then raise exception 'not found'; end if;
  if cy.closed_at is not null then raise exception 'already closed'; end if;

  select array_agg(id), count(*) filter (where status = 'open') into ids, n_open
    from public.stocktakes
   where cycle_id = cy.id and company_id = co and archived_at is null and kind <> 'assets';

  update public.stocktakes set status = 'closed', closed_at = now()
   where cycle_id = cy.id and company_id = co and status = 'open';

  if ids is not null then
    insert into public.count_cycle_lines (cycle_id, company_id, product_id, book, counted, price, status)
    select cy.id, co, l.product_id, coalesce(l.ref_qty, l.cur_qty, 0), l.counted_qty,
           coalesce(l.price, 0), l.status
      from public.pool_lines(ids) l
    on conflict do nothing;
  end if;

  select jsonb_build_object(
           'stocktakes', coalesce(array_length(ids, 1), 0),
           'closed_open', n_open,
           'products', count(*),
           'ok', count(*) filter (where status = 'ok'),
           'missed', count(*) filter (where status = 'missed'),
           'review', count(*) filter (where status = 'review'),
           'book_qty', coalesce(sum(book), 0),
           'book_value', coalesce(sum(book * price), 0),
           'counted_qty', coalesce(sum(counted), 0),
           'shortage_qty', coalesce(-sum(coalesce(counted, 0) - book) filter (where coalesce(counted, 0) < book), 0),
           'shortage_value', coalesce(-sum((coalesce(counted, 0) - book) * price) filter (where coalesce(counted, 0) < book), 0),
           'surplus_qty', coalesce(sum(coalesce(counted, 0) - book) filter (where coalesce(counted, 0) > book), 0),
           'surplus_value', coalesce(sum((coalesce(counted, 0) - book) * price) filter (where coalesce(counted, 0) > book), 0),
           'shelves', (select count(distinct z.location_id) from public.stocktake_zones z
                        where z.stocktake_id = any (coalesce(ids, '{}'::uuid[])) and z.status = 'done')
         )
    into s
    from public.count_cycle_lines where cycle_id = cy.id;

  update public.count_cycles
     set closed_at = now(), closed_by = auth.uid(), summary = s
   where id = cy.id;
  return s;
end;
$$;
revoke all on function public.close_count_cycle(uuid) from public, anon;
grant execute on function public.close_count_cycle(uuid) to authenticated;
