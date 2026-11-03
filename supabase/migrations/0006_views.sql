-- Read models for the dashboard. `security_invoker` makes each view run as the
-- caller, so the underlying tables' RLS policies still apply.

create view public.product_stock
with (security_invoker = true)
as
select
  p.id                as product_id,
  p.company_id,
  p.sku,
  p.name,
  p.brand,
  p.variant,
  p.unit,
  p.barcode,
  p.image_url,
  p.reorder_point,
  p.active,
  p.category_id,
  c.name              as category_name,
  coalesce(sum(il.quantity), 0)::integer as total_quantity,
  count(il.id) filter (where il.quantity > 0)::integer as stocked_locations,
  max(il.updated_at)  as stock_updated_at,
  coalesce(sum(il.quantity), 0) <= p.reorder_point as is_low_stock
from public.products p
left join public.categories c on c.id = p.category_id
left join public.inventory_levels il on il.product_id = p.id
group by p.id, c.name;

create view public.location_stock
with (security_invoker = true)
as
select
  il.company_id,
  il.location_id,
  l.code           as location_code,
  l.name           as location_name,
  il.product_id,
  p.sku,
  p.name           as product_name,
  p.reorder_point,
  il.quantity,
  il.counted_at,
  il.updated_at
from public.inventory_levels il
join public.locations l on l.id = il.location_id
join public.products  p on p.id = il.product_id;

create view public.check_summary
with (security_invoker = true)
as
select
  ic.id,
  ic.company_id,
  ic.location_id,
  l.code    as location_code,
  l.name    as location_name,
  ic.status,
  ic.summary,
  ic.image_path,
  ic.started_at,
  ic.completed_at,
  ic.created_by,
  up.full_name as created_by_name,
  count(ici.id)::integer                                          as item_count,
  count(ici.id) filter (where ici.status = 'match')::integer       as match_count,
  count(ici.id) filter (where ici.status = 'partial')::integer     as partial_count,
  count(ici.id) filter (where ici.status = 'mismatch')::integer    as mismatch_count,
  count(ici.id) filter (where ici.needs_barcode)::integer          as needs_barcode_count
from public.inventory_checks ic
join public.locations l on l.id = ic.location_id
left join public.user_profiles up on up.id = ic.created_by
left join public.inventory_check_items ici on ici.check_id = ic.id
group by ic.id, l.code, l.name, up.full_name;

grant select on public.product_stock, public.location_stock, public.check_summary to authenticated;
