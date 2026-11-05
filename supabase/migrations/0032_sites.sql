-- Warehouses / objects of a company, kept by its manager. When a stocktake is
-- opened the site is picked from this list and its address and map point come
-- with it.
create table public.sites (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  address     text,
  lat         double precision check (lat between -90 and 90),
  lng         double precision check (lng between -180 and 180),
  created_at  timestamptz not null default now(),
  unique (company_id, name)
);
grant select, insert, update, delete on public.sites to authenticated;
alter table public.sites enable row level security;
alter table public.sites force row level security;
create policy sites_select on public.sites for select to authenticated using (company_id = public.auth_company_id());
create policy sites_manage on public.sites for all to authenticated
  using (company_id = public.auth_company_id() and public.auth_role() in ('owner', 'admin'))
  with check (company_id = public.auth_company_id() and public.auth_role() in ('owner', 'admin'));
