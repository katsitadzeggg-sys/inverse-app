-- The site now offers five service lines, and a request says which one it is
-- about. Nullable: "not sure yet" is a legitimate answer, and rows written
-- before this migration have no value.

create type public.service_line as enum
  ('inventory', 'audit', 'accounting', 'valuation', 'consulting');

alter table public.contact_requests
  add column service public.service_line;
