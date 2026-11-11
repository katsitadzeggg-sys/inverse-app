-- AI check of a closed shelf: its photos are read by a vision model and what
-- is visible is compared with what was counted. One row per run.
create table if not exists public.shelf_ai_checks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  stocktake_id uuid not null references public.stocktakes (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  result jsonb not null,
  photos int not null default 0,
  model text,
  input_tokens int,
  output_tokens int,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists shelf_ai_checks_zone_idx
  on public.shelf_ai_checks (stocktake_id, location_id, created_at desc);

alter table public.shelf_ai_checks enable row level security;
create policy shelf_ai_checks_select on public.shelf_ai_checks
  for select to authenticated
  using (company_id = public.auth_company_id()
         and coalesce(public.auth_role()::text, '') in ('owner', 'admin'));
create policy shelf_ai_checks_insert on public.shelf_ai_checks
  for insert to authenticated
  with check (company_id = public.auth_company_id()
              and coalesce(public.auth_role()::text, '') in ('owner', 'admin')
              and exists (select 1 from public.stocktakes s
                           where s.id = stocktake_id and s.company_id = public.auth_company_id()));
