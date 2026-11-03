-- Newsletter: visitors leave an email in the site footer, and Inverse sends
-- them news about once a month. Each subscriber carries a random token so the
-- unsubscribe link in every email works without an account.

create table public.newsletter_subscribers (
  id              uuid primary key default gen_random_uuid(),
  email           text not null,
  locale          text not null default 'ka',
  token           uuid not null default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  unsubscribed_at timestamptz,
  constraint newsletter_email_format
    check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint newsletter_email_length check (char_length(email) <= 320)
);

-- One row per address, whatever its case.
create unique index newsletter_subscribers_email_idx
  on public.newsletter_subscribers (lower(email));
create unique index newsletter_subscribers_token_idx
  on public.newsletter_subscribers (token);

alter table public.newsletter_subscribers enable row level security;
alter table public.newsletter_subscribers force row level security;

-- Visitors may only add themselves; nothing can be read back through the API.
create policy newsletter_subscribers_insert on public.newsletter_subscribers
  for insert to anon, authenticated
  with check (unsubscribed_at is null);

grant insert (email, locale) on public.newsletter_subscribers to anon, authenticated;

-- Unsubscribing goes through this function rather than an UPDATE policy, so a
-- visitor can only touch the one row whose token they hold.
create or replace function public.newsletter_unsubscribe(p_token uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  with updated as (
    update public.newsletter_subscribers
       set unsubscribed_at = coalesce(unsubscribed_at, now())
     where token = p_token
    returning 1
  )
  select exists (select 1 from updated);
$$;

revoke all on function public.newsletter_unsubscribe(uuid) from public;
grant execute on function public.newsletter_unsubscribe(uuid) to anon, authenticated;
