-- SaaS structure (Giorgi, 5 Nov 2026):
--   Inverse platform admin  → registers client companies and their managers;
--   company manager (admin) → loads the book, opens stocktakes, invites counters;
--   counter (member)        → counts on site, only in the modules allowed.
-- Each person has a set of modules they may count in: stock, expiry, assets.

alter table public.user_profiles
  add column modules text[] not null default '{stock,expiry,assets}'
  check (modules <@ array['stock', 'expiry', 'assets']::text[]);

-- Counting is allowed for managers, or for a counter whose modules include
-- the stocktake's kind and who is assigned to it (or nobody is assigned).
create or replace function public.can_count_in(p_stocktake uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select public.auth_role() in ('owner', 'admin')
      or (
        exists (
          select 1 from public.stocktakes s, public.user_profiles p
           where s.id = p_stocktake and p.id = auth.uid() and p.disabled_at is null and s.kind = any (p.modules)
        )
        and (
          not exists (select 1 from public.stocktake_members m where m.stocktake_id = p_stocktake)
          or exists (select 1 from public.stocktake_members m where m.stocktake_id = p_stocktake and m.user_id = auth.uid())
        )
      );
$$;

-- Invites carry the modules too.
alter table public.company_invites
  add column modules text[] not null default '{stock,expiry,assets}'
  check (modules <@ array['stock', 'expiry', 'assets']::text[]);

create or replace function public.accept_company_invite()
returns text language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid(); mail text; me public.user_profiles; inv public.company_invites;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into me from public.user_profiles where id = uid;
  if me.id is not null and me.disabled_at is null then return 'member'; end if;
  select lower(trim(email)) into mail from auth.users where id = uid;
  select * into inv from public.company_invites
   where email = mail and accepted_at is null and expires_at > now()
     and (me.id is null or company_id = me.company_id)
   order by created_at desc limit 1 for update;
  if not found then return case when me.id is null then 'none' else 'disabled' end; end if;
  if me.id is null then
    insert into public.user_profiles (id, company_id, email, full_name, role, modules)
    values (uid, inv.company_id, mail,
            nullif(trim(coalesce((select raw_user_meta_data ->> 'full_name' from auth.users where id = uid), '')), ''),
            inv.role, inv.modules);
  else
    update public.user_profiles set disabled_at = null, role = inv.role, modules = inv.modules where id = uid;
  end if;
  update public.company_invites set accepted_at = now(), accepted_by = uid where id = inv.id;
  return 'joined';
end;
$$;

-- ---------------------------------------------------------------------------
-- Platform console (Inverse admins only)
-- ---------------------------------------------------------------------------
create or replace function public.platform_companies()
returns table (id uuid, name text, plan public.company_plan, created_at timestamptz,
               managers bigint, counters bigint, open_invites bigint, stocktakes bigint, last_activity timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
    select c.id, c.name, c.plan, c.created_at,
           (select count(*) from public.user_profiles p where p.company_id = c.id and p.role in ('owner', 'admin') and p.disabled_at is null),
           (select count(*) from public.user_profiles p where p.company_id = c.id and p.role in ('member', 'viewer') and p.disabled_at is null),
           (select count(*) from public.company_invites i where i.company_id = c.id and i.accepted_at is null),
           (select count(*) from public.stocktakes s where s.company_id = c.id),
           (select max(s.created_at) from public.stocktakes s where s.company_id = c.id)
      from public.companies c order by c.created_at;
end;
$$;
grant execute on function public.platform_companies() to authenticated;

create or replace function public.platform_members()
returns table (user_id uuid, email text, full_name text, company_id uuid, company_name text, role public.user_role,
               modules text[], disabled_at timestamptz, registered_at timestamptz, confirmed boolean, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
    select u.id, u.email::text, coalesce(p.full_name, nullif(u.raw_user_meta_data ->> 'full_name', '')),
           c.id, c.name, p.role, p.modules, p.disabled_at, u.created_at, u.email_confirmed_at is not null, u.last_sign_in_at
      from auth.users u
      left join public.user_profiles p on p.id = u.id
      left join public.companies c on c.id = p.company_id
     order by c.name nulls last, u.created_at;
end;
$$;
grant execute on function public.platform_members() to authenticated;

create or replace function public.platform_invites()
returns table (id uuid, company_id uuid, email text, role public.user_role, modules text[], created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return query select i.id, i.company_id, i.email, i.role, i.modules, i.created_at
    from public.company_invites i where i.accepted_at is null order by i.created_at desc;
end;
$$;
grant execute on function public.platform_invites() to authenticated;

-- A new client company and the invite for its manager. The manager signs up
-- with that email and lands in the company as its manager.
create or replace function public.platform_create_company(p_name text, p_manager_email text)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare co uuid; v_slug text; mail text := lower(trim(p_manager_email));
begin
  if not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'name' using errcode = '22023'; end if;
  if mail !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'email' using errcode = '22023'; end if;
  v_slug := trim(both '-' from regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g'));
  if length(v_slug) < 2 then v_slug := 'co'; end if;
  if exists (select 1 from public.companies c where c.slug = v_slug) then
    v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  end if;
  insert into public.companies (name, slug) values (trim(p_name), v_slug) returning id into co;
  insert into public.company_invites (company_id, email, role, invited_by) values (co, mail, 'admin', auth.uid());
  return co;
end;
$$;
grant execute on function public.platform_create_company(text, text) to authenticated;

-- Invite one more person into any company (manager or counter).
create or replace function public.platform_invite(p_company uuid, p_email text, p_role public.user_role, p_modules text[])
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare mail text := lower(trim(p_email));
begin
  if not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_role not in ('admin', 'member', 'viewer') then raise exception 'role' using errcode = '22023'; end if;
  delete from public.company_invites where company_id = p_company and email = mail and accepted_at is null;
  insert into public.company_invites (company_id, email, role, modules, invited_by)
  values (p_company, mail, p_role, coalesce(p_modules, '{stock,expiry,assets}'), auth.uid());
end;
$$;
grant execute on function public.platform_invite(uuid, text, public.user_role, text[]) to authenticated;

-- Role, modules and access of anyone; owners keep their role.
create or replace function public.platform_set_member(p_user uuid, p_role public.user_role, p_modules text[], p_disabled boolean)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare target public.user_profiles;
begin
  if not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into target from public.user_profiles where id = p_user;
  if target.id is null then raise exception 'no profile' using errcode = 'P0002'; end if;
  if target.role = 'owner' and (p_role <> 'owner' or p_disabled) then raise exception 'owner' using errcode = '42501'; end if;
  if p_role = 'owner' and target.role <> 'owner' then raise exception 'owner' using errcode = '42501'; end if;
  update public.user_profiles
     set role = p_role, modules = coalesce(p_modules, modules),
         disabled_at = case when p_disabled then coalesce(disabled_at, now()) else null end
   where id = p_user;
end;
$$;
grant execute on function public.platform_set_member(uuid, public.user_role, text[], boolean) to authenticated;

-- The test counter starts with fixed assets only.
update public.user_profiles set modules = '{assets}' where lower(email) = 'katsitadzeggg@gmail.com';
