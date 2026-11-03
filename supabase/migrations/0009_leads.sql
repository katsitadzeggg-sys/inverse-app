-- Early-access requests from the public landing page.
--
-- This is the one table an unauthenticated visitor may write to. It is
-- insert-only for them: there is no SELECT policy at all, so a lead cannot be
-- read back through the API — only by the service role, from the dashboard.

create table public.leads (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  company    text,
  locale     text not null default 'ka',
  source     text not null default 'landing',
  created_at timestamptz not null default now(),
  constraint leads_email_format check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint leads_email_length check (char_length(email) <= 320),
  constraint leads_company_length check (company is null or char_length(company) <= 200)
);

create index leads_created_at_idx on public.leads (created_at desc);

alter table public.leads enable row level security;
alter table public.leads force row level security;

create policy leads_insert on public.leads
  for insert to anon, authenticated
  with check (true);

grant insert on public.leads to anon, authenticated;
