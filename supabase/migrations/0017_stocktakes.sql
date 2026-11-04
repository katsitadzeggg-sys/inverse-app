-- Physical stocktakes counted on the phone (the counter screen at /count).
--
-- A stocktake is one inventory project for a company. Counters claim zones
-- (a location, usually a shelf), scan the products on it and enter how many
-- they found. The book quantity is never shown to them: inventory_levels stays
-- out of this flow, so the count stays blind.
--
-- Giorgi's method, which later migrations build on: first a full shelf-by-shelf
-- count, then the "missed" round (book items nobody counted), then the
-- "recheck" round for every +/- difference.

create type public.stocktake_status as enum ('open', 'closed');
create type public.zone_status as enum ('counting', 'done');

create table public.stocktakes (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 120),
  status      public.stocktake_status not null default 'open',
  created_by  uuid references public.user_profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  closed_at   timestamptz
);
create index stocktakes_company_idx on public.stocktakes (company_id, created_at desc);

-- One counter per zone at a time: the unique key makes a second claim fail.
create table public.stocktake_zones (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  stocktake_id  uuid not null references public.stocktakes (id) on delete cascade,
  location_id   uuid not null references public.locations (id) on delete cascade,
  counter_id    uuid references public.user_profiles (id) on delete set null,
  status        public.zone_status not null default 'counting',
  started_at    timestamptz not null default now(),
  done_at       timestamptz,
  unique (stocktake_id, location_id)
);
create index stocktake_zones_stocktake_idx on public.stocktake_zones (stocktake_id);

create table public.stocktake_entries (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  stocktake_id   uuid not null references public.stocktakes (id) on delete cascade,
  location_id    uuid not null references public.locations (id) on delete cascade,
  product_id     uuid references public.products (id) on delete set null,
  -- An item that is not in the product list: the counter describes it and a
  -- manager identifies it later.
  unknown_label  text,
  quantity       numeric(14, 3) not null check (quantity >= 0),
  -- Set when the count was entered as boxes × pieces per box.
  boxes          integer check (boxes is null or boxes >= 0),
  per_box        numeric(14, 3) check (per_box is null or per_box >= 0),
  counter_id     uuid references public.user_profiles (id) on delete set null,
  photo_path     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint stocktake_entries_item check (
    product_id is not null or length(trim(coalesce(unknown_label, ''))) > 0
  )
);
create index stocktake_entries_stocktake_idx on public.stocktake_entries (stocktake_id, location_id);
create index stocktake_entries_counter_idx on public.stocktake_entries (counter_id);

create trigger stocktake_entries_touch before update on public.stocktake_entries
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Integrity: a zone or entry must belong to the stocktake's company, and the
-- location and product to the same company. Writes go only into open
-- stocktakes.
-- ---------------------------------------------------------------------------
create or replace function public.stocktake_child_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.stocktakes;
begin
  select * into s from public.stocktakes where id = new.stocktake_id;
  if s.id is null or s.company_id <> new.company_id then
    raise exception 'stocktake does not belong to this company';
  end if;
  if s.status <> 'open' then
    raise exception 'stocktake is closed';
  end if;
  if not exists (select 1 from public.locations l
                 where l.id = new.location_id and l.company_id = new.company_id) then
    raise exception 'location does not belong to this company';
  end if;
  -- Zones have no product column; reading it through to_jsonb keeps one
  -- function for both tables.
  if tg_table_name = 'stocktake_entries' and (to_jsonb(new) ->> 'product_id') is not null
     and not exists (select 1 from public.products p
                     where p.id = (to_jsonb(new) ->> 'product_id')::uuid
                       and p.company_id = new.company_id) then
    raise exception 'product does not belong to this company';
  end if;
  return new;
end;
$$;

create trigger stocktake_zones_guard before insert or update on public.stocktake_zones
  for each row execute function public.stocktake_child_guard();
create trigger stocktake_entries_guard before insert or update on public.stocktake_entries
  for each row execute function public.stocktake_child_guard();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.stocktakes        enable row level security;
alter table public.stocktake_zones   enable row level security;
alter table public.stocktake_entries enable row level security;
alter table public.stocktakes        force row level security;
alter table public.stocktake_zones   force row level security;
alter table public.stocktake_entries force row level security;

-- stocktakes: the whole company reads; owners/admins open and close them.
create policy stocktakes_select on public.stocktakes
  for select to authenticated
  using (company_id = public.auth_company_id());
create policy stocktakes_insert on public.stocktakes
  for insert to authenticated
  with check (company_id = public.auth_company_id() and public.auth_role() in ('owner', 'admin'));
create policy stocktakes_update on public.stocktakes
  for update to authenticated
  using (company_id = public.auth_company_id() and public.auth_role() in ('owner', 'admin'))
  with check (company_id = public.auth_company_id());

-- zones: anyone who may write claims a zone for themselves; the counter (or an
-- owner/admin) closes or reopens it.
create policy stocktake_zones_select on public.stocktake_zones
  for select to authenticated
  using (company_id = public.auth_company_id());
create policy stocktake_zones_insert on public.stocktake_zones
  for insert to authenticated
  with check (company_id = public.auth_company_id() and public.auth_can_write()
              and counter_id = auth.uid());
create policy stocktake_zones_update on public.stocktake_zones
  for update to authenticated
  using (company_id = public.auth_company_id() and public.auth_can_write()
         and (counter_id = auth.uid() or public.auth_role() in ('owner', 'admin')))
  with check (company_id = public.auth_company_id());

-- entries: counters write their own lines; owners/admins may correct any.
create policy stocktake_entries_select on public.stocktake_entries
  for select to authenticated
  using (company_id = public.auth_company_id());
create policy stocktake_entries_insert on public.stocktake_entries
  for insert to authenticated
  with check (company_id = public.auth_company_id() and public.auth_can_write()
              and counter_id = auth.uid());
create policy stocktake_entries_update on public.stocktake_entries
  for update to authenticated
  using (company_id = public.auth_company_id() and public.auth_can_write()
         and (counter_id = auth.uid() or public.auth_role() in ('owner', 'admin')))
  with check (company_id = public.auth_company_id());
create policy stocktake_entries_delete on public.stocktake_entries
  for delete to authenticated
  using (company_id = public.auth_company_id() and public.auth_can_write()
         and (counter_id = auth.uid() or public.auth_role() in ('owner', 'admin')));

grant select, insert, update on public.stocktakes to authenticated;
grant select, insert, update on public.stocktake_zones to authenticated;
grant select, insert, update, delete on public.stocktake_entries to authenticated;
grant all on public.stocktakes, public.stocktake_zones, public.stocktake_entries to service_role;
