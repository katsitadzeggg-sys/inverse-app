-- A counter may be allowed to open a stocktake themselves (in their own
-- modules), e.g. when they go to a site alone. Managers grant it per person.
alter table public.user_profiles add column can_open boolean not null default false;

create or replace function public.auth_can_open(p_kind text)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_profiles p
     where p.id = auth.uid() and p.disabled_at is null and p.can_open and p_kind = any (p.modules)
  );
$$;
grant execute on function public.auth_can_open(text) to authenticated;

-- Added next to the managers' insert policy (policies combine with OR).
create policy stocktakes_insert_counter on public.stocktakes
  for insert to authenticated
  with check (company_id = public.auth_company_id() and public.auth_can_open(kind) and created_by = auth.uid());

create or replace function public.platform_set_can_open(p_user uuid, p_can_open boolean)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.user_profiles set can_open = p_can_open where id = p_user;
end;
$$;
grant execute on function public.platform_set_can_open(uuid, boolean) to authenticated;

update public.user_profiles set can_open = true where lower(email) = 'katsitadzeggg@gmail.com';

-- Who may open stocktakes, for the platform console.
create or replace function public.platform_can_open()
returns table (user_id uuid, can_open boolean)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return query select p.id, p.can_open from public.user_profiles p;
end;
$$;
grant execute on function public.platform_can_open() to authenticated;
