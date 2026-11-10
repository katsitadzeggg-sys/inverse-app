-- Security hardening after the 10.11.2026 audit.
-- 1) Counters no longer change or delete products: only owners and managers.
--    A counter may still add a product and name one that came with only its
--    code (name_product below).
alter policy products_update on public.products
  using ((company_id = public.auth_company_id())
         and coalesce(public.auth_role()::text, '') in ('owner', 'admin'))
  with check (company_id = public.auth_company_id());
alter policy products_delete on public.products
  using ((company_id = public.auth_company_id())
         and coalesce(public.auth_role()::text, '') in ('owner', 'admin'));

create or replace function public.name_product(p_product uuid, p_name text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.products;
  n text := btrim(coalesce(p_name, ''));
begin
  if n = '' or not public.auth_can_write() then return null; end if;
  select * into v from public.products
   where id = p_product and company_id = public.auth_company_id();
  if v.id is null then return null; end if;
  -- Only a placeholder name (the code itself, or "ახალი · code") is replaced.
  if v.name = v.sku or v.name = v.barcode or v.name like 'ახალი · %' then
    update public.products set name = n where id = v.id;
    return n;
  end if;
  return v.name;
end;
$$;
revoke execute on function public.name_product(uuid, text) from public, anon;
grant execute on function public.name_product(uuid, text) to authenticated;

-- 2) Signed-out visitors cannot call the app's SECURITY DEFINER functions
--    (all of them already check the caller; this closes the door as well).
--    The newsletter unsubscribe link stays public.
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.proname <> 'newsletter_unsubscribe'
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- 3) Fixed search_path on the three functions the advisor flagged.
alter function public.touch_updated_at() set search_path = public, pg_temp;
alter function public.auth_can_write() set search_path = public, pg_temp;
alter function public.seed_demo_data() set search_path = public, pg_temp;
