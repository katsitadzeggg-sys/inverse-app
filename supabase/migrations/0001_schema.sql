-- Inverse — multi-tenant inventory schema
-- Every tenant-scoped table carries company_id; isolation is enforced by RLS in 0002.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.company_plan as enum ('free', 'starter', 'growth', 'enterprise');
create type public.user_role as enum ('owner', 'admin', 'member', 'viewer');
create type public.location_kind as enum ('warehouse', 'shelf', 'store', 'transit', 'other');
create type public.check_status as enum ('pending', 'analyzing', 'completed', 'failed');
create type public.match_status as enum ('match', 'partial', 'mismatch', 'unknown');

-- ---------------------------------------------------------------------------
-- companies
-- ---------------------------------------------------------------------------
create table public.companies (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,
  plan          public.company_plan not null default 'free',
  country       text not null default 'GE',
  currency      text not null default 'GEL',
  stripe_customer_id      text unique,
  stripe_subscription_id  text unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint companies_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$')
);

-- ---------------------------------------------------------------------------
-- user_profiles — one row per auth user, pinned to exactly one company
-- ---------------------------------------------------------------------------
create table public.user_profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  company_id    uuid not null references public.companies (id) on delete cascade,
  email         text not null,
  full_name     text,
  role          public.user_role not null default 'member',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index user_profiles_company_id_idx on public.user_profiles (company_id);

-- ---------------------------------------------------------------------------
-- locations — warehouses, shelves ("R-2"), stores
-- ---------------------------------------------------------------------------
create table public.locations (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  parent_id     uuid references public.locations (id) on delete set null,
  code          text not null,
  name          text not null,
  kind          public.location_kind not null default 'shelf',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, code)
);
create index locations_company_id_idx on public.locations (company_id);
create index locations_parent_id_idx on public.locations (parent_id);

-- ---------------------------------------------------------------------------
-- categories — folder hierarchy for products (Sortly-style)
-- ---------------------------------------------------------------------------
create table public.categories (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  parent_id     uuid references public.categories (id) on delete set null,
  name          text not null,
  created_at    timestamptz not null default now(),
  unique (company_id, parent_id, name)
);
create index categories_company_id_idx on public.categories (company_id);

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
create table public.products (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  category_id   uuid references public.categories (id) on delete set null,
  sku           text not null,
  barcode       text,
  name          text not null,
  brand         text,
  variant       text,
  description   text,
  unit          text not null default 'pcs',
  image_url     text,
  -- Free-text cues the vision model uses to tell near-identical variants apart.
  visual_notes  text,
  reorder_point integer not null default 0 check (reorder_point >= 0),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, sku)
);
create index products_company_id_idx on public.products (company_id);
create index products_category_id_idx on public.products (category_id);
create unique index products_company_barcode_idx
  on public.products (company_id, barcode) where barcode is not null;

-- ---------------------------------------------------------------------------
-- inventory_levels — quantity of one product at one location
-- ---------------------------------------------------------------------------
create table public.inventory_levels (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  product_id    uuid not null references public.products (id) on delete cascade,
  location_id   uuid not null references public.locations (id) on delete cascade,
  quantity      integer not null default 0,
  counted_at    timestamptz,
  updated_at    timestamptz not null default now(),
  unique (product_id, location_id)
);
create index inventory_levels_company_id_idx on public.inventory_levels (company_id);
create index inventory_levels_location_id_idx on public.inventory_levels (location_id);

-- ---------------------------------------------------------------------------
-- inventory_checks — one AI verification run against one photo
-- ---------------------------------------------------------------------------
create table public.inventory_checks (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  location_id   uuid not null references public.locations (id) on delete cascade,
  created_by    uuid references public.user_profiles (id) on delete set null,
  status        public.check_status not null default 'pending',
  -- Path inside the private `inventory-checks` storage bucket, never a public URL.
  image_path    text not null,
  model         text,
  summary       text,
  error         text,
  input_tokens  integer,
  output_tokens integer,
  started_at    timestamptz not null default now(),
  completed_at  timestamptz
);
create index inventory_checks_company_id_idx on public.inventory_checks (company_id, started_at desc);
create index inventory_checks_location_id_idx on public.inventory_checks (location_id);

-- ---------------------------------------------------------------------------
-- inventory_check_items — per-product result of a check (the green/yellow/red rows)
-- ---------------------------------------------------------------------------
create table public.inventory_check_items (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  check_id      uuid not null references public.inventory_checks (id) on delete cascade,
  product_id    uuid references public.products (id) on delete set null,
  -- Kept denormalised so a deleted product doesn't erase audit history.
  product_label text not null,
  expected_qty  integer,
  detected_qty  integer,
  confidence    numeric(4, 3) check (confidence >= 0 and confidence <= 1),
  status        public.match_status not null default 'unknown',
  -- True when the model could not separate visually identical variants on its own.
  needs_barcode boolean not null default false,
  notes         text,
  created_at    timestamptz not null default now()
);
create index inventory_check_items_check_id_idx on public.inventory_check_items (check_id);
create index inventory_check_items_company_id_idx on public.inventory_check_items (company_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger companies_touch       before update on public.companies       for each row execute function public.touch_updated_at();
create trigger user_profiles_touch   before update on public.user_profiles   for each row execute function public.touch_updated_at();
create trigger locations_touch       before update on public.locations       for each row execute function public.touch_updated_at();
create trigger products_touch        before update on public.products        for each row execute function public.touch_updated_at();
create trigger inventory_levels_touch before update on public.inventory_levels for each row execute function public.touch_updated_at();
