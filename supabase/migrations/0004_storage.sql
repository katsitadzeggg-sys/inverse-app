-- Private bucket for shelf photos. Object paths are `<company_id>/<check_id>.<ext>`,
-- so the first path segment is the tenant key the policies match on.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'inventory-checks',
  'inventory-checks',
  false,
  10485760, -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

create policy inventory_checks_objects_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'inventory-checks'
    and (storage.foldername(name))[1] = public.auth_company_id()::text
  );

create policy inventory_checks_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'inventory-checks'
    and (storage.foldername(name))[1] = public.auth_company_id()::text
    and public.auth_can_write()
  );

create policy inventory_checks_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'inventory-checks'
    and (storage.foldername(name))[1] = public.auth_company_id()::text
    and public.auth_can_write()
  );
