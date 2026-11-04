-- Stocktake details for the export, recount marks, and shelf photos/videos
-- (Giorgi, 4 Nov 2026).
--
-- Each stocktake gets a unique number per company (INV-2026-0001…), a count
-- date, the client company and the warehouse/branch. Lines entered in the
-- recount round are marked so the export shows they were counted again.
-- Photos and videos are attached per shelf in the private stocktake-media
-- bucket under <company_id>/<stocktake_id>/<location_id>/….

alter table public.stocktakes
  add column number text,
  add column count_date date not null default current_date,
  add column client_name text check (client_name is null or length(client_name) <= 200),
  add column branch text check (branch is null or length(branch) <= 200);

create or replace function public.stocktake_assign_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year text := to_char(coalesce(new.count_date, current_date), 'YYYY');
  v_next int;
begin
  if new.number is null then
    -- Serialise numbering per company so two openings never share a number.
    perform pg_advisory_xact_lock(hashtext('stocktake_number:' || new.company_id::text));
    select coalesce(max(split_part(number, '-', 3)::int), 0) + 1 into v_next
      from public.stocktakes
      where company_id = new.company_id and number like 'INV-' || v_year || '-%';
    new.number := 'INV-' || v_year || '-' || lpad(v_next::text, 4, '0');
  end if;
  return new;
end;
$$;

create trigger stocktakes_number before insert on public.stocktakes
  for each row execute function public.stocktake_assign_number();

-- Number the stocktakes that already exist, oldest first.
with ordered as (
  select id, company_id, created_at,
         row_number() over (partition by company_id, to_char(count_date, 'YYYY') order by created_at) as n,
         to_char(count_date, 'YYYY') as y
  from public.stocktakes where number is null
)
update public.stocktakes s set number = 'INV-' || o.y || '-' || lpad(o.n::text, 4, '0')
from ordered o where o.id = s.id;

alter table public.stocktakes alter column number set not null;
create unique index stocktakes_company_number_idx on public.stocktakes (company_id, number);

alter table public.stocktake_entries add column recounted boolean not null default false;

create table public.stocktake_media (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  stocktake_id  uuid not null references public.stocktakes (id) on delete cascade,
  location_id   uuid not null references public.locations (id) on delete cascade,
  path          text not null,
  kind          text not null check (kind in ('photo', 'video')),
  created_by    uuid references public.user_profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index stocktake_media_zone_idx on public.stocktake_media (stocktake_id, location_id);

alter table public.stocktake_media enable row level security;
alter table public.stocktake_media force row level security;
create policy stocktake_media_select on public.stocktake_media
  for select to authenticated using (company_id = public.auth_company_id());
create policy stocktake_media_insert on public.stocktake_media
  for insert to authenticated
  with check (company_id = public.auth_company_id() and public.auth_can_write() and created_by = auth.uid());
create policy stocktake_media_delete on public.stocktake_media
  for delete to authenticated
  using (company_id = public.auth_company_id() and public.auth_can_write()
         and (created_by = auth.uid() or public.auth_role() in ('owner', 'admin')));
grant select, insert, delete on public.stocktake_media to authenticated;
grant all on public.stocktake_media to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'stocktake-media',
  'stocktake-media',
  false,
  104857600, -- 100 MB, enough for a short phone video
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do nothing;

create policy stocktake_media_objects_select on storage.objects
  for select to authenticated
  using (bucket_id = 'stocktake-media' and (storage.foldername(name))[1] = public.auth_company_id()::text);
create policy stocktake_media_objects_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'stocktake-media' and (storage.foldername(name))[1] = public.auth_company_id()::text
              and public.auth_can_write());
create policy stocktake_media_objects_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'stocktake-media' and (storage.foldername(name))[1] = public.auth_company_id()::text
         and public.auth_can_write());
