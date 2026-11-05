-- The first version let a counter record only when listed in
-- stocktake_counters, which nothing fills any more. Counting permission now
-- comes from one place, can_count_in(): managers always; counters when the
-- stocktake's module is theirs and they are assigned (or nobody is).
create or replace function public.auth_can_count(p_stocktake uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select public.can_count_in(p_stocktake); $$;
