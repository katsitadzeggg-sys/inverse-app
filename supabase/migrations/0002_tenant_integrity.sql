-- Composite foreign keys so a row can never reference a parent in another tenant.
-- RLS stops the wrong company from *reading* a row; these stop a compromised or
-- buggy writer from *stitching* rows across tenants.

alter table public.locations  add constraint locations_company_id_key  unique (company_id, id);
alter table public.categories add constraint categories_company_id_key unique (company_id, id);
alter table public.products   add constraint products_company_id_key   unique (company_id, id);
alter table public.inventory_checks add constraint inventory_checks_company_id_key unique (company_id, id);

alter table public.locations
  drop constraint locations_parent_id_fkey,
  add constraint locations_parent_same_company
    foreign key (company_id, parent_id) references public.locations (company_id, id) on delete set null;

alter table public.categories
  drop constraint categories_parent_id_fkey,
  add constraint categories_parent_same_company
    foreign key (company_id, parent_id) references public.categories (company_id, id) on delete set null;

alter table public.products
  drop constraint products_category_id_fkey,
  add constraint products_category_same_company
    foreign key (company_id, category_id) references public.categories (company_id, id) on delete set null;

alter table public.inventory_levels
  drop constraint inventory_levels_product_id_fkey,
  drop constraint inventory_levels_location_id_fkey,
  add constraint inventory_levels_product_same_company
    foreign key (company_id, product_id) references public.products (company_id, id) on delete cascade,
  add constraint inventory_levels_location_same_company
    foreign key (company_id, location_id) references public.locations (company_id, id) on delete cascade;

alter table public.inventory_checks
  drop constraint inventory_checks_location_id_fkey,
  add constraint inventory_checks_location_same_company
    foreign key (company_id, location_id) references public.locations (company_id, id) on delete cascade;

alter table public.inventory_check_items
  drop constraint inventory_check_items_check_id_fkey,
  drop constraint inventory_check_items_product_id_fkey,
  add constraint inventory_check_items_check_same_company
    foreign key (company_id, check_id) references public.inventory_checks (company_id, id) on delete cascade,
  add constraint inventory_check_items_product_same_company
    foreign key (company_id, product_id) references public.products (company_id, id) on delete set null;
