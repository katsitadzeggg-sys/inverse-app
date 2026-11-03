-- Signup path. `companies` has no INSERT policy on purpose — a new tenant is only
-- ever created through this function, which also makes the caller its owner.

create or replace function public.create_company_for_current_user(
  company_name text,
  company_slug text default null
)
returns public.companies
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid          uuid := auth.uid();
  user_email   text;
  resolved_slug text;
  new_company  public.companies;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if exists (select 1 from public.user_profiles where id = uid) then
    raise exception 'user already belongs to a company' using errcode = '23505';
  end if;

  select email into user_email from auth.users where id = uid;

  resolved_slug := coalesce(
    nullif(trim(company_slug), ''),
    regexp_replace(lower(trim(company_name)), '[^a-z0-9]+', '-', 'g')
  );
  resolved_slug := trim(both '-' from resolved_slug);
  if length(resolved_slug) < 2 then
    resolved_slug := 'co';
  end if;
  -- Slug is globally unique; suffix until it lands.
  if exists (select 1 from public.companies c where c.slug = resolved_slug) then
    resolved_slug := resolved_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  end if;

  insert into public.companies (name, slug)
  values (trim(company_name), resolved_slug)
  returning * into new_company;

  insert into public.user_profiles (id, company_id, email, full_name, role)
  values (
    uid,
    new_company.id,
    coalesce(user_email, ''),
    nullif(trim(coalesce((select raw_user_meta_data ->> 'full_name' from auth.users where id = uid), '')), ''),
    'owner'
  );

  return new_company;
end;
$$;

revoke execute on function public.create_company_for_current_user(text, text) from public;
grant execute on function public.create_company_for_current_user(text, text) to authenticated;
