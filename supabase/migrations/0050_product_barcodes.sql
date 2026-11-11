-- One product, several barcodes: a supplier's other code, an old code, a
-- different pack. A counter who scans an unknown code can attach it to the
-- product it really is; from then on that code finds the product.
create table if not exists public.product_barcodes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  barcode text not null check (length(btrim(barcode)) between 3 and 64),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (company_id, barcode)
);
create index if not exists product_barcodes_product_idx on public.product_barcodes (product_id);

alter table public.product_barcodes enable row level security;
create policy product_barcodes_select on public.product_barcodes
  for select to authenticated using (company_id = public.auth_company_id());
create policy product_barcodes_insert on public.product_barcodes
  for insert to authenticated
  with check (company_id = public.auth_company_id()
              and exists (select 1 from public.products p
                           where p.id = product_id and p.company_id = public.auth_company_id()));
create policy product_barcodes_delete on public.product_barcodes
  for delete to authenticated
  using (company_id = public.auth_company_id()
         and coalesce(public.auth_role()::text, '') in ('owner', 'admin'));
