-- Invites: an owner/admin adds a counter or manager by email. When that person
-- signs up (or signs in without a company), onboarding joins them to the
-- inviting company instead of creating a new one.
--
-- Removing someone does not delete their profile (their name stays on every
-- act they counted); it sets disabled_at, and the auth helpers then return
-- null for them, so every RLS policy shuts them out.

alter table public.user_profiles add column disabled_at timestamptz;

create or replace function public.auth_company_id()
returns uuid language sql stable security definer set search_path = public, pg_temp
as $$ select company_id from public.user_profiles where id = auth.uid() and disabled_at is null; $$;

create or replace function public.auth_role()
returns public.user_role language sql stable security definer set search_path = public, pg_temp
as $$ select role from public.user_profiles where id = auth.uid() and disabled_at is null; $$;

create table public.company_invites (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  email        text not null check (email = lower(trim(email)) and email like '%@%'),
  role         public.user_role not null default 'member' check (role in ('admin', 'member', 'viewer')),
  invited_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '30 days',
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users (id) on delete set null
);
create index company_invites_company_idx on public.company_invites (company_id);
-- One open invite per email per company.
create unique index company_invites_open_uq on public.company_invites (company_id, email) where accepted_at is null;

grant select, insert, update, delete on public.company_invites to authenticated;

alter table public.company_invites enable row level security;
alter table public.company_invites force row level security;

create policy company_invites_admin on public.company_invites
  for all to authenticated
  using (company_id = public.auth_company_id() and public.auth_role() in ('owner', 'admin'))
  with check (company_id = public.auth_company_id() and public.auth_role() in ('owner', 'admin') and invited_by = auth.uid());

-- Joins the caller to the company that invited their email.
-- Returns 'member' (already in a company), 'joined', 'disabled' (removed and
-- not invited again) or 'none' (no invite: may create their own company).
create or replace function public.accept_company_invite()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid   uuid := auth.uid();
  mail  text;
  me    public.user_profiles;
  inv   public.company_invites;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into me from public.user_profiles where id = uid;
  if me.id is not null and me.disabled_at is null then
    return 'member';
  end if;

  select lower(trim(email)) into mail from auth.users where id = uid;
  select * into inv from public.company_invites
   where email = mail and accepted_at is null and expires_at > now()
     and (me.id is null or company_id = me.company_id)
   order by created_at desc limit 1
   for update;
  if not found then
    return case when me.id is null then 'none' else 'disabled' end;
  end if;

  if me.id is null then
    insert into public.user_profiles (id, company_id, email, full_name, role)
    values (
      uid, inv.company_id, mail,
      nullif(trim(coalesce((select raw_user_meta_data ->> 'full_name' from auth.users where id = uid), '')), ''),
      inv.role
    );
  else
    update public.user_profiles set disabled_at = null, role = inv.role where id = uid;
  end if;
  update public.company_invites set accepted_at = now(), accepted_by = uid where id = inv.id;
  return 'joined';
end;
$$;

revoke execute on function public.accept_company_invite() from public;
grant execute on function public.accept_company_invite() to authenticated;

-- Removes a colleague's access (keeps their name on past work). Owners cannot
-- be removed, nobody removes themselves, admins cannot remove other admins.
create or replace function public.remove_team_member(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me     public.user_profiles;
  target public.user_profiles;
begin
  select * into me from public.user_profiles where id = auth.uid() and disabled_at is null;
  if me.id is null or me.role not in ('owner', 'admin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into target from public.user_profiles where id = p_user and company_id = me.company_id;
  if target.id is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if target.id = me.id or target.role = 'owner' or (me.role = 'admin' and target.role = 'admin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.user_profiles set disabled_at = now() where id = target.id;
end;
$$;

revoke execute on function public.remove_team_member(uuid) from public;
grant execute on function public.remove_team_member(uuid) to authenticated;
