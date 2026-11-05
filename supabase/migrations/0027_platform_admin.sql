-- Platform view for Inverse itself: every registered person across all
-- companies, with company, role and status, and the right to change roles.
-- Only people listed in platform_admins may use it.

create table public.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
alter table public.platform_admins force row level security;
-- No policies: read and written only through the functions below.

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.platform_admins where user_id = auth.uid()); $$;
grant execute on function public.is_platform_admin() to authenticated;

-- Every account: email, name, company, role, confirmed, last sign-in, removed.
create or replace function public.platform_users()
returns table (
  user_id uuid, email text, full_name text, company_id uuid, company_name text, role public.user_role,
  disabled_at timestamptz, registered_at timestamptz, confirmed boolean, last_sign_in_at timestamptz
)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select u.id, u.email::text, coalesce(p.full_name, nullif(u.raw_user_meta_data ->> 'full_name', '')),
           c.id, c.name, p.role, p.disabled_at, u.created_at, u.email_confirmed_at is not null, u.last_sign_in_at
      from auth.users u
      left join public.user_profiles p on p.id = u.id
      left join public.companies c on c.id = p.company_id
     order by c.name nulls last, u.created_at;
end;
$$;
grant execute on function public.platform_users() to authenticated;

-- Change someone's role, or remove / restore their access. Owners stay owners.
create or replace function public.platform_set_access(p_user uuid, p_role public.user_role, p_disabled boolean)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare target public.user_profiles;
begin
  if not public.is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into target from public.user_profiles where id = p_user;
  if target.id is null then raise exception 'no profile' using errcode = 'P0002'; end if;
  if target.role = 'owner' and (p_role <> 'owner' or p_disabled) then
    raise exception 'the owner cannot be changed here' using errcode = '42501';
  end if;
  if p_role = 'owner' and target.role <> 'owner' then
    raise exception 'owner cannot be granted here' using errcode = '42501';
  end if;
  update public.user_profiles
     set role = p_role, disabled_at = case when p_disabled then coalesce(disabled_at, now()) else null end
   where id = p_user;
end;
$$;
grant execute on function public.platform_set_access(uuid, public.user_role, boolean) to authenticated;

insert into public.platform_admins (user_id)
select id from auth.users where lower(email) = 'info@inverse.ge'
on conflict do nothing;
