-- Who counts in which stocktake. The manager ticks counters on the stocktake
-- page; a counter then sees only the stocktakes they are assigned to. A
-- stocktake with nobody assigned stays open to the whole team.
create table public.stocktake_members (
  stocktake_id uuid not null references public.stocktakes (id) on delete cascade,
  user_id      uuid not null references public.user_profiles (id) on delete cascade,
  company_id   uuid not null references public.companies (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (stocktake_id, user_id)
);
create index stocktake_members_user_idx on public.stocktake_members (user_id);

grant select, insert, delete on public.stocktake_members to authenticated;
alter table public.stocktake_members enable row level security;
alter table public.stocktake_members force row level security;

create policy stocktake_members_select on public.stocktake_members
  for select to authenticated using (company_id = public.auth_company_id());
create policy stocktake_members_manage on public.stocktake_members
  for all to authenticated
  using (company_id = public.auth_company_id() and public.auth_role() in ('owner', 'admin'))
  with check (company_id = public.auth_company_id() and public.auth_role() in ('owner', 'admin'));

-- True when the caller may count in this stocktake.
create or replace function public.can_count_in(p_stocktake uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select public.auth_role() in ('owner', 'admin')
      or not exists (select 1 from public.stocktake_members m where m.stocktake_id = p_stocktake)
      or exists (select 1 from public.stocktake_members m where m.stocktake_id = p_stocktake and m.user_id = auth.uid());
$$;
grant execute on function public.can_count_in(uuid) to authenticated;
