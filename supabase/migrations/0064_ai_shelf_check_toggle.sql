-- 0064: the company's switch for the automatic photo check when a counter
-- closes a shelf (Giorgi, 18.11). Off by default: it costs per shelf.
alter table public.companies
  add column if not exists ai_shelf_check boolean not null default false;
notify pgrst, 'reload schema';

-- (applied as 0065) A counter's own shelf may be checked — and its result
-- kept for the manager — when the company has the switch on. Counters still
-- cannot read the results (select stays manager-only); the warnings reach
-- them straight from the check.
drop policy if exists shelf_ai_checks_insert_counter on public.shelf_ai_checks;
create policy shelf_ai_checks_insert_counter on public.shelf_ai_checks
  for insert to authenticated
  with check (
    company_id = public.auth_company_id()
    and exists (select 1 from public.companies c where c.id = company_id and c.ai_shelf_check)
    and exists (select 1 from public.stocktake_zones z
                 where z.stocktake_id = shelf_ai_checks.stocktake_id
                   and z.location_id = shelf_ai_checks.location_id
                   and z.counter_id = auth.uid())
  );
