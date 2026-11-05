-- Client analytics for the Inverse platform console: per company usage, and
-- activity by month across all clients. Platform admins only.

create or replace function public.platform_analytics()
returns table (
  company_id uuid, name text, plan public.company_plan, created_at timestamptz,
  people bigint, counters bigint, stocktakes bigint, open_stocktakes bigint,
  stock_count bigint, expiry_count bigint, assets_count bigint,
  shelves_done bigint, lines bigint, assets_checked bigint, media bigint,
  last_activity timestamptz, active_30d boolean
)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  with s as (select * from public.stocktakes),
  act as (
    select x.co, max(x.t) as t from (
      select st.company_id as co, st.created_at as t from public.stocktakes st
      union all select sz.company_id, coalesce(sz.done_at, sz.started_at) from public.stocktake_zones sz
      union all select se.company_id, se.created_at from public.stocktake_entries se
      union all select ac.company_id, ac.checked_at from public.asset_checks ac
    ) x group by x.co
  )
  select c.id, c.name, c.plan, c.created_at,
    (select count(*) from public.user_profiles p where p.company_id = c.id and p.disabled_at is null),
    (select count(*) from public.user_profiles p where p.company_id = c.id and p.disabled_at is null and p.role = 'member'),
    (select count(*) from s where s.company_id = c.id),
    (select count(*) from s where s.company_id = c.id and s.status = 'open'),
    (select count(*) from s where s.company_id = c.id and s.kind = 'stock'),
    (select count(*) from s where s.company_id = c.id and s.kind = 'expiry'),
    (select count(*) from s where s.company_id = c.id and s.kind = 'assets'),
    (select count(*) from public.stocktake_zones z where z.company_id = c.id and z.status = 'done'),
    (select count(*) from public.stocktake_entries e where e.company_id = c.id),
    (select count(*) from public.asset_checks a where a.company_id = c.id),
    (select count(*) from public.stocktake_media m where m.company_id = c.id),
    act.t,
    coalesce(act.t > now() - interval '30 days', false)
  from public.companies c left join act on act.co = c.id
  order by act.t desc nulls last;
end;
$$;
grant execute on function public.platform_analytics() to authenticated;

-- Last 12 months: new clients, stocktakes and counted shelves per month.
create or replace function public.platform_monthly()
returns table (month date, new_companies bigint, stocktakes bigint, shelves_done bigint, active_companies bigint)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  with months as (
    select generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month')::date as m
  )
  select m.m,
    (select count(*) from public.companies c where date_trunc('month', c.created_at)::date = m.m),
    (select count(*) from public.stocktakes s where date_trunc('month', s.created_at)::date = m.m),
    (select count(*) from public.stocktake_zones z where z.status = 'done' and date_trunc('month', coalesce(z.done_at, z.started_at))::date = m.m),
    (select count(distinct s.company_id) from public.stocktakes s where date_trunc('month', s.created_at)::date = m.m)
  from months m order by m.m;
end;
$$;
grant execute on function public.platform_monthly() to authenticated;
