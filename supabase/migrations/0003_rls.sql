-- Row Level Security: every tenant table is scoped by company_id.
--
-- Reading the caller's company out of user_profiles inside a user_profiles policy
-- would recurse, so both helpers are SECURITY DEFINER and bypass RLS themselves.
-- They are STABLE, so Postgres evaluates them once per statement, not per row.

create or replace function public.auth_company_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select company_id from public.user_profiles where id = auth.uid();
$$;

create or replace function public.auth_role()
returns public.user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.user_profiles where id = auth.uid();
$$;

-- Anyone but a 'viewer' may write.
create or replace function public.auth_can_write()
returns boolean
language sql
stable
as $$
  select coalesce(public.auth_role() <> 'viewer', false);
$$;

revoke execute on function public.auth_company_id() from public;
revoke execute on function public.auth_role() from public;
grant execute on function public.auth_company_id() to authenticated;
grant execute on function public.auth_role() to authenticated;
grant execute on function public.auth_can_write() to authenticated;

alter table public.companies             enable row level security;
alter table public.user_profiles         enable row level security;
alter table public.locations             enable row level security;
alter table public.categories            enable row level security;
alter table public.products              enable row level security;
alter table public.inventory_levels      enable row level security;
alter table public.inventory_checks      enable row level security;
alter table public.inventory_check_items enable row level security;

-- Force RLS on the table owner too, so a definer function elsewhere can't leak rows.
alter table public.companies             force row level security;
alter table public.user_profiles         force row level security;
alter table public.locations             force row level security;
alter table public.categories            force row level security;
alter table public.products              force row level security;
alter table public.inventory_levels      force row level security;
alter table public.inventory_checks      force row level security;
alter table public.inventory_check_items force row level security;

-- ---------------------------------------------------------------------------
-- companies — read your own; only an owner/admin may rename it.
-- Company creation goes through the service role during signup.
-- ---------------------------------------------------------------------------
create policy companies_select on public.companies
  for select to authenticated
  using (id = public.auth_company_id());

create policy companies_update on public.companies
  for update to authenticated
  using (id = public.auth_company_id() and public.auth_role() in ('owner', 'admin'))
  with check (id = public.auth_company_id());

-- ---------------------------------------------------------------------------
-- user_profiles — see colleagues; edit yourself; owners/admins manage the team.
-- ---------------------------------------------------------------------------
create policy user_profiles_select on public.user_profiles
  for select to authenticated
  using (company_id = public.auth_company_id());

create policy user_profiles_update_self on public.user_profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and company_id = public.auth_company_id());

create policy user_profiles_admin_write on public.user_profiles
  for all to authenticated
  using (company_id = public.auth_company_id() and public.auth_role() in ('owner', 'admin'))
  with check (company_id = public.auth_company_id() and public.auth_role() in ('owner', 'admin'));

-- ---------------------------------------------------------------------------
-- Tenant data tables — identical shape: read within the company, write unless viewer.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'locations', 'categories', 'products',
    'inventory_levels', 'inventory_checks', 'inventory_check_items'
  ] loop
    execute format($f$
      create policy %1$s_select on public.%1$I
        for select to authenticated
        using (company_id = public.auth_company_id());

      create policy %1$s_insert on public.%1$I
        for insert to authenticated
        with check (company_id = public.auth_company_id() and public.auth_can_write());

      create policy %1$s_update on public.%1$I
        for update to authenticated
        using (company_id = public.auth_company_id() and public.auth_can_write())
        with check (company_id = public.auth_company_id());

      create policy %1$s_delete on public.%1$I
        for delete to authenticated
        using (company_id = public.auth_company_id() and public.auth_can_write());
    $f$, t);
  end loop;
end;
$$;
