-- Fixed assets module (ძირითადი საშუალებები).
--
-- The manager imports the register (inventory number, name, room, responsible
-- person, value, serial). Counters open a room the same way they open a shelf,
-- scan each asset's label (QR/barcode = inventory number) and record that it
-- was found, its condition, and photos/video. Anything scanned that is not in
-- the register is surplus; register lines never scanned are missing; found in
-- another room than the register says is moved.

create table public.asset_register (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  stocktake_id  uuid not null references public.stocktakes (id) on delete cascade,
  inv_no        text not null check (length(trim(inv_no)) > 0),
  name          text not null,
  room          text,
  responsible   text,
  value         numeric(14, 2),
  serial        text,
  created_at    timestamptz not null default now(),
  unique (stocktake_id, inv_no)
);
create index asset_register_stocktake_idx on public.asset_register (stocktake_id);

create table public.asset_checks (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  stocktake_id  uuid not null references public.stocktakes (id) on delete cascade,
  -- Null for surplus: found but not in the register.
  register_id   uuid references public.asset_register (id) on delete set null,
  -- The room it was found in (opened like a shelf).
  location_id   uuid not null references public.locations (id) on delete cascade,
  inv_no        text not null,
  name          text not null,
  condition     text not null default 'good' check (condition in ('good', 'damaged', 'writeoff')),
  responsible   text,
  serial        text,
  needs_label   boolean not null default false,
  note          text check (note is null or length(note) <= 1000),
  counter_id    uuid references public.user_profiles (id) on delete set null,
  lat           double precision,
  lng           double precision,
  checked_at    timestamptz not null default now(),
  unique (stocktake_id, inv_no)
);
create index asset_checks_stocktake_idx on public.asset_checks (stocktake_id, location_id);

-- Photos and videos can belong to one asset.
alter table public.stocktake_media
  add column asset_check_id uuid references public.asset_checks (id) on delete cascade;

alter table public.asset_register enable row level security;
alter table public.asset_register force row level security;
alter table public.asset_checks   enable row level security;
alter table public.asset_checks   force row level security;

-- Counters see the register (name and room help them confirm the asset);
-- only managers change it.
create policy asset_register_select on public.asset_register
  for select to authenticated using (company_id = public.auth_company_id());
create policy asset_register_manage on public.asset_register
  for all to authenticated
  using (company_id = public.auth_company_id() and public.auth_role() in ('owner', 'admin'))
  with check (company_id = public.auth_company_id() and public.auth_role() in ('owner', 'admin'));

create policy asset_checks_select on public.asset_checks
  for select to authenticated using (company_id = public.auth_company_id());
create policy asset_checks_insert on public.asset_checks
  for insert to authenticated
  with check (company_id = public.auth_company_id() and public.auth_can_write() and counter_id = auth.uid());
create policy asset_checks_update on public.asset_checks
  for update to authenticated
  using (company_id = public.auth_company_id() and public.auth_can_write()
         and (counter_id = auth.uid() or public.auth_role() in ('owner', 'admin')))
  with check (company_id = public.auth_company_id());
create policy asset_checks_delete on public.asset_checks
  for delete to authenticated
  using (company_id = public.auth_company_id() and public.auth_can_write()
         and (counter_id = auth.uid() or public.auth_role() in ('owner', 'admin')));

grant select, insert, update, delete on public.asset_register to authenticated;
grant select, insert, update, delete on public.asset_checks to authenticated;
grant all on public.asset_register, public.asset_checks to service_role;

-- Nothing is recorded on a closed stocktake.
create trigger asset_checks_guard before insert or update on public.asset_checks
  for each row execute function public.stocktake_child_guard();
