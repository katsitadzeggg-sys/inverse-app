-- The manager assigns counters to each stocktake. A counter sees and counts
-- only the stocktakes they are assigned to; owners and admins see all.

create table public.stocktake_counters (
  stocktake_id  uuid not null references public.stocktakes (id) on delete cascade,
  user_id       uuid not null references public.user_profiles (id) on delete cascade,
  company_id    uuid not null references public.companies (id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (stocktake_id, user_id)
);
create index stocktake_counters_user_idx on public.stocktake_counters (user_id);

alter table public.stocktake_counters enable row level security;
alter table public.stocktake_counters force row level security;
create policy stocktake_counters_select on public.stocktake_counters
  for select to authenticated using (company_id = public.auth_company_id());
create policy stocktake_counters_manage on public.stocktake_counters
  for all to authenticated
  using (company_id = public.auth_company_id() and public.auth_role() in ('owner', 'admin'))
  with check (company_id = public.auth_company_id() and public.auth_role() in ('owner', 'admin'));
grant select, insert, delete on public.stocktake_counters to authenticated;
grant all on public.stocktake_counters to service_role;

-- May the caller count in this stocktake? Managers always; counters if assigned.
create or replace function public.auth_can_count(p_stocktake uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.auth_role() in ('owner', 'admin')
      or exists (select 1 from public.stocktake_counters c
                 where c.stocktake_id = p_stocktake and c.user_id = auth.uid()
                   and c.company_id = public.auth_company_id());
$$;
revoke execute on function public.auth_can_count(uuid) from public;
grant execute on function public.auth_can_count(uuid) to authenticated;

drop policy stocktake_zones_insert on public.stocktake_zones;
create policy stocktake_zones_insert on public.stocktake_zones
  for insert to authenticated
  with check (company_id = public.auth_company_id() and public.auth_can_write()
              and counter_id = auth.uid() and public.auth_can_count(stocktake_id));

drop policy stocktake_entries_insert on public.stocktake_entries;
create policy stocktake_entries_insert on public.stocktake_entries
  for insert to authenticated
  with check (company_id = public.auth_company_id() and public.auth_can_write()
              and counter_id = auth.uid() and public.auth_can_count(stocktake_id));

drop policy asset_checks_insert on public.asset_checks;
create policy asset_checks_insert on public.asset_checks
  for insert to authenticated
  with check (company_id = public.auth_company_id() and public.auth_can_write()
              and counter_id = auth.uid() and public.auth_can_count(stocktake_id));
