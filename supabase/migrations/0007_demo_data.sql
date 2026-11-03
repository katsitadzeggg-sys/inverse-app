-- Optional demo catalogue, callable from Settings → "Load demo data".
-- Mirrors the shelf the original manual verification work was done against:
-- near-identical hairbrush lines plus cosmetics on shelf R-2.

create or replace function public.seed_demo_data()
returns void
language plpgsql
security invoker
as $$
declare
  cid          uuid := public.auth_company_id();
  wh           uuid;
  shelf_r2     uuid;
  shelf_a1     uuid;
  cat_hair     uuid;
  cat_cosm     uuid;
  pid          uuid;
  item         record;
begin
  if cid is null then
    raise exception 'no company for current user' using errcode = '28000';
  end if;
  if not public.auth_can_write() then
    raise exception 'insufficient privileges' using errcode = '42501';
  end if;
  if exists (select 1 from public.products where company_id = cid) then
    return; -- never overwrite a real catalogue
  end if;

  insert into public.locations (company_id, code, name, kind)
  values (cid, 'WH-1', 'Main warehouse', 'warehouse')
  returning id into wh;

  insert into public.locations (company_id, parent_id, code, name, kind)
  values (cid, wh, 'R-2', 'Rack 2 — cosmetics', 'shelf')
  returning id into shelf_r2;

  insert into public.locations (company_id, parent_id, code, name, kind)
  values (cid, wh, 'A-1', 'Rack 1 — hair care', 'shelf')
  returning id into shelf_a1;

  insert into public.categories (company_id, name) values (cid, 'Hair care')
  returning id into cat_hair;
  insert into public.categories (company_id, name) values (cid, 'Cosmetics')
  returning id into cat_cosm;

  for item in
    select * from (values
      ('JAN-1362', 'Janeke', 'Hairbrush 1362 Superbrush', 'Large flat brush, matte black handle, gold logo band', 12, 6, cat_hair, shelf_a1),
      ('JAN-1363', 'Janeke', 'Hairbrush 1363 Superbrush', 'Same silhouette as 1362 but one size smaller — barcode required to separate', 8, 6, cat_hair, shelf_a1),
      ('SPZ-0041', 'Spazzola', 'Wooden paddle brush', 'Light wood paddle, oval, natural bristles', 15, 5, cat_hair, shelf_a1),
      ('SPZ-0042', 'Spazzola', 'Wooden round brush', 'Light wood round barrel, near-identical handle to 0041', 4, 5, cat_hair, shelf_a1),
      ('RHD-PP01', 'Rhode', 'Peptide lip treatment', 'Small squeeze tube, cream body, thin sans-serif wordmark', 24, 10, cat_cosm, shelf_r2),
      ('RHD-GB02', 'Rhode', 'Glazing milk', 'Tall white pump bottle, minimal label', 9, 10, cat_cosm, shelf_r2),
      ('RHD-BP03', 'Rhode', 'Barrier butter', 'Squat round tub, matte cream lid', 0, 4, cat_cosm, shelf_r2)
    ) as t(sku, brand, name, visual_notes, qty, reorder, category_id, location_id)
  loop
    insert into public.products (company_id, category_id, sku, brand, name, visual_notes, reorder_point)
    values (cid, item.category_id, item.sku, item.brand, item.name, item.visual_notes, item.reorder)
    returning id into pid;

    insert into public.inventory_levels (company_id, product_id, location_id, quantity, counted_at)
    values (cid, pid, item.location_id, item.qty, now());
  end loop;
end;
$$;

grant execute on function public.seed_demo_data() to authenticated;
