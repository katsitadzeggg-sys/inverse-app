-- The public form is now a contact form for a services business, not an
-- early-access signup, and it collects more than an email address.
--
-- `leads` is dropped rather than kept alongside: it served the previous landing
-- page, it has never been deployed to a live project, and two tables for the
-- same purpose would only invite writes to the wrong one.

drop table if exists public.leads;

create type public.contact_topic as enum ('service', 'question', 'career', 'other');

create table public.contact_requests (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  company    text,
  email      text not null,
  phone      text,
  topic      public.contact_topic not null default 'service',
  message    text not null,
  locale     text not null default 'ka',
  created_at timestamptz not null default now(),
  constraint contact_email_format
    check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint contact_email_length   check (char_length(email) <= 320),
  constraint contact_name_length    check (char_length(name) between 1 and 200),
  constraint contact_company_length check (company is null or char_length(company) <= 200),
  constraint contact_phone_length   check (phone is null or char_length(phone) <= 40),
  constraint contact_message_length check (char_length(message) between 1 and 5000)
);

create index contact_requests_created_at_idx on public.contact_requests (created_at desc);

alter table public.contact_requests enable row level security;
alter table public.contact_requests force row level security;

-- The one table an unauthenticated visitor may write to, and only write:
-- there is no SELECT policy, so a submission cannot be read back through the
-- API — only by the service role.
create policy contact_requests_insert on public.contact_requests
  for insert to anon, authenticated
  with check (true);

grant insert on public.contact_requests to anon, authenticated;
