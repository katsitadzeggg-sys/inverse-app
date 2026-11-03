-- Supabase grants these by default, but stating them makes the schema portable
-- and makes the privilege surface reviewable in one place.
-- RLS still decides which *rows* each grant can reach.

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on
  public.companies,
  public.user_profiles,
  public.locations,
  public.categories,
  public.products,
  public.inventory_levels,
  public.inventory_checks,
  public.inventory_check_items
to authenticated;

grant select on public.product_stock, public.location_stock, public.check_summary to authenticated;

-- Anonymous visitors get nothing: every table is behind a session.
revoke all on all tables in schema public from anon;
