-- From 2026-10-30 Supabase no longer grants Data API access automatically to
-- tables created in `public` — including when migrations rebuild the schema on
-- a new project, a preview branch or `supabase db reset`. Production keeps the
-- grants it already has; this migration makes a fresh database end up with the
-- same working privileges, stated explicitly.

-- The keepalive cron (src/app/api/keepalive/route.ts) runs
-- `select id from newsletter_subscribers` as anon. RLS has no SELECT policy, so
-- it still returns no rows; the grant only lets the query run instead of
-- failing with "permission denied". Only the id column is exposed.
grant select (id) on public.newsletter_subscribers to anon;

-- The service role reads leads, contact requests and subscribers. Supabase used
-- to grant it everything by default; state that here for every table and view.
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Rule for every later migration: a new table carries its own grants in the
-- same file that creates it, e.g.
--   grant select, insert, update, delete on public.<table> to authenticated;
--   grant all on public.<table> to service_role;
-- and anon only where a public form needs it.
