-- 0067: what each AI call costs (Giorgi, 19.11): the assistant and the photo
-- identification were not recorded anywhere; shelf checks already keep their
-- tokens in shelf_ai_checks. One row per call (the assistant: per question,
-- all rounds together). Readable by the company's owner/admin only.

create table if not exists public.ai_usage (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null default public.auth_company_id()
                  references public.companies (id) on delete cascade,
  user_id       uuid default auth.uid() references auth.users (id) on delete set null,
  kind          text not null check (kind in ('assistant', 'identify')),
  model         text not null,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists ai_usage_company_created on public.ai_usage (company_id, created_at desc);

alter table public.ai_usage enable row level security;

-- Anyone signed in writes only their own company's rows, as themselves.
create policy ai_usage_insert on public.ai_usage
  for insert to authenticated
  with check (company_id = public.auth_company_id() and user_id = auth.uid());

-- Only the company's managers read them; nobody updates or deletes.
create policy ai_usage_select on public.ai_usage
  for select to authenticated
  using (company_id = public.auth_company_id()
         and coalesce(public.auth_role()::text, '') in ('owner', 'admin'));

revoke all on public.ai_usage from anon;
