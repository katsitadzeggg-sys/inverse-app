-- 0071: every balance load is kept as a version — nothing in the balance is
-- ever deleted (Giorgi, 28.11: "წაშლა ამ საქმეში არ მომწონს").
--   1) stocktake_book_versions — one row per load of a stocktake's balance:
--      when, who, file, lines / units / value, status active | replaced |
--      cancelled. The active version's lines are in stocktake_book; the
--      lines of replaced and cancelled versions are in stocktake_book_log,
--      now in full (shelf, price, expiry too, not only product and qty).
--   2) log_book(stocktake) keeps the current balance as a replaced version
--      before a new one is loaded (as before, now with every column).
--   3) new_book_version(stocktake, file, note) records the balance just
--      loaded as the active version.
--   4) cancel_book_version(version) — "this balance is wrong" (another
--      warehouse, a wrong file): the version is marked cancelled and ignored
--      everywhere — missed, re-check, balance changes. If it was the active
--      one, the previous version comes back as the balance (or none). Counts
--      are never touched: what was counted is real.
--   5) pool_lines: lines of cancelled versions are left out of "it was in a
--      balance" (missed) and of the daily balance changes (re-check).
--   6) spread_book: a sibling stocktake's balance is kept as a version too.
-- Isolation: the new table has row-level security on company_id =
-- auth_company_id(); every function checks the caller's company and the
-- owner/admin role, as log_book and spread_book did. Existing log rows keep
-- version_id null and count as before.

-- 1) -------------------------------------------------------------------------
create table if not exists public.stocktake_book_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  stocktake_id uuid not null references public.stocktakes (id) on delete cascade,
  loaded_at timestamptz not null,
  loaded_by uuid references auth.users (id) on delete set null,
  file_name text,
  note text,
  lines integer not null default 0,
  units numeric(16, 3) not null default 0,
  value numeric(16, 2) not null default 0,
  status text not null default 'active' check (status in ('active', 'replaced', 'cancelled')),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists stocktake_book_versions_st_idx
  on public.stocktake_book_versions (stocktake_id, loaded_at desc);
alter table public.stocktake_book_versions enable row level security;
alter table public.stocktake_book_versions force row level security;
create policy stocktake_book_versions_select on public.stocktake_book_versions
  for select to authenticated using (company_id = public.auth_company_id());
grant select on public.stocktake_book_versions to authenticated;

alter table public.stocktake_book_log
  add column if not exists version_id uuid references public.stocktake_book_versions (id) on delete set null,
  add column if not exists location_id uuid references public.locations (id) on delete set null,
  add column if not exists unit_cost numeric(14, 4),
  add column if not exists expiry_date date;
create index if not exists stocktake_book_log_version_idx on public.stocktake_book_log (version_id);

-- The active version of a stocktake, created for a balance loaded before
-- versions existed (its time is the balance's load time).
create or replace function public.book_active_version(p_stocktake uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  co uuid := public.auth_company_id();
  v uuid;
begin
  if not exists (select 1 from public.stocktakes where id = p_stocktake and company_id = co) then
    raise exception 'not found';
  end if;
  select id into v from public.stocktake_book_versions
   where stocktake_id = p_stocktake and status = 'active'
   order by loaded_at desc limit 1;
  if v is null and exists (select 1 from public.stocktake_book where stocktake_id = p_stocktake) then
    insert into public.stocktake_book_versions
      (company_id, stocktake_id, loaded_at, lines, units, value, status)
    select co, p_stocktake, min(created_at), count(*), coalesce(sum(book_qty), 0),
           coalesce(sum(book_qty * coalesce(unit_cost, 0)), 0), 'active'
      from public.stocktake_book where stocktake_id = p_stocktake
    returning id into v;
  end if;
  return v;
end;
$$;
revoke all on function public.book_active_version(uuid) from public, anon;
grant execute on function public.book_active_version(uuid) to authenticated;

-- 2) -------------------------------------------------------------------------
-- Keeps a stocktake's current balance as a replaced version, line by line.
create or replace function public.log_book(p_stocktake uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v uuid;
begin
  if coalesce(public.auth_role()::text, '') not in ('owner', 'admin') then
    raise exception 'not allowed';
  end if;
  v := public.book_active_version(p_stocktake);
  if v is null then return; end if;
  insert into public.stocktake_book_log
    (company_id, stocktake_id, product_id, qty, loaded_at, version_id, location_id, unit_cost, expiry_date)
  select b.company_id, b.stocktake_id, b.product_id, b.book_qty,
         (select loaded_at from public.stocktake_book_versions where id = v),
         v, b.location_id, b.unit_cost, b.expiry_date
    from public.stocktake_book b join public.stocktakes s on s.id = b.stocktake_id
   where b.stocktake_id = p_stocktake and s.company_id = public.auth_company_id();
  update public.stocktake_book_versions set status = 'replaced' where id = v;
end;
$$;
revoke all on function public.log_book(uuid) from public, anon;
grant execute on function public.log_book(uuid) to authenticated;

-- 3) -------------------------------------------------------------------------
create or replace function public.new_book_version(p_stocktake uuid, p_file text, p_note text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  co uuid := public.auth_company_id();
  v uuid;
begin
  if coalesce(public.auth_role()::text, '') not in ('owner', 'admin') then
    raise exception 'not allowed';
  end if;
  if not exists (select 1 from public.stocktakes where id = p_stocktake and company_id = co) then
    raise exception 'not found';
  end if;
  -- An older active one (should not happen) gives way.
  update public.stocktake_book_versions set status = 'replaced'
   where stocktake_id = p_stocktake and status = 'active';
  insert into public.stocktake_book_versions
    (company_id, stocktake_id, loaded_at, loaded_by, file_name, note, lines, units, value, status)
  select co, p_stocktake, coalesce(min(created_at), now()), auth.uid(),
         left(p_file, 200), left(p_note, 200), count(*), coalesce(sum(book_qty), 0),
         coalesce(sum(book_qty * coalesce(unit_cost, 0)), 0), 'active'
    from public.stocktake_book where stocktake_id = p_stocktake
  returning id into v;
  return v;
end;
$$;
revoke all on function public.new_book_version(uuid, text, text) from public, anon;
grant execute on function public.new_book_version(uuid, text, text) to authenticated;

-- 4) -------------------------------------------------------------------------
create or replace function public.cancel_book_version(p_version uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  co uuid := public.auth_company_id();
  ver public.stocktake_book_versions;
  st public.stocktakes;
  prev public.stocktake_book_versions;
begin
  if coalesce(public.auth_role()::text, '') not in ('owner', 'admin') then
    raise exception 'not allowed';
  end if;
  select * into ver from public.stocktake_book_versions where id = p_version and company_id = co;
  if ver.id is null then raise exception 'not found'; end if;
  if ver.status = 'cancelled' then return 'already'; end if;
  select * into st from public.stocktakes where id = ver.stocktake_id and company_id = co;
  if st.status <> 'open' then raise exception 'closed'; end if;

  if ver.status = 'active' then
    -- Its lines go to the log (kept, marked cancelled) ...
    insert into public.stocktake_book_log
      (company_id, stocktake_id, product_id, qty, loaded_at, version_id, location_id, unit_cost, expiry_date)
    select company_id, stocktake_id, product_id, book_qty, ver.loaded_at, ver.id,
           location_id, unit_cost, expiry_date
      from public.stocktake_book where stocktake_id = ver.stocktake_id;
    delete from public.stocktake_book where stocktake_id = ver.stocktake_id;
    -- ... and the latest earlier version that is not cancelled comes back.
    select * into prev from public.stocktake_book_versions
     where stocktake_id = ver.stocktake_id and status = 'replaced' and id <> ver.id
     order by loaded_at desc limit 1;
    if prev.id is not null and exists (
      select 1 from public.stocktake_book_log where version_id = prev.id
    ) then
      insert into public.stocktake_book
        (company_id, stocktake_id, product_id, location_id, book_qty, unit_cost, expiry_date, created_at)
      select company_id, stocktake_id, product_id, location_id, sum(qty), max(unit_cost), expiry_date,
             prev.loaded_at
        from public.stocktake_book_log where version_id = prev.id
       group by company_id, stocktake_id, product_id, location_id, expiry_date;
      delete from public.stocktake_book_log where version_id = prev.id;
      update public.stocktake_book_versions set status = 'active' where id = prev.id;
    end if;
  end if;
  update public.stocktake_book_versions
     set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid()
   where id = ver.id;
  return coalesce(prev.id::text, 'none');
end;
$$;
revoke all on function public.cancel_book_version(uuid) from public, anon;
grant execute on function public.cancel_book_version(uuid) to authenticated;

-- 5) -------------------------------------------------------------------------
create or replace function public.pool_lines(p_ids uuid[])
 returns table(product_id uuid, cur_qty numeric, ref_qty numeric, counted_qty numeric, price numeric, status text, zeroed boolean, moved boolean)
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  with ids as (
    select id, created_at, form_kind from public.stocktakes
     where id = any (p_ids) and company_id = public.auth_company_id() and kind <> 'assets'
  ), bk as (
    select b.stocktake_id sid, b.product_id pid, sum(b.book_qty) q, max(b.unit_cost) c,
           max(b.created_at) at
      from public.stocktake_book b join ids on ids.id = b.stocktake_id
     group by 1, 2
  ), cur_sid as (
    select bk.sid from bk join ids on ids.id = bk.sid
     where ids.form_kind is null
     group by bk.sid order by max(bk.at) desc limit 1
  ), cur as (
    select pid, q from bk where sid = (select sid from cur_sid)
  ), ever as (
    select pid from bk where q > 0
    union
    select l.product_id from public.stocktake_book_log l join ids on ids.id = l.stocktake_id
      left join public.stocktake_book_versions v on v.id = l.version_id
     where l.qty > 0 and v.status is distinct from 'cancelled'
  ), price as (
    select pid, max(c) c from bk group by pid
  ), e as (
    select e.stocktake_id sid, e.product_id pid, e.quantity q,
           (e.created_at at time zone 'Asia/Tbilisi')::date d,
           coalesce(ids.form_kind = 'review', false) rv, ids.created_at sat
      from public.stocktake_entries e join ids on ids.id = e.stocktake_id
     where e.product_id is not null
  ), last_rv as (
    select distinct on (pid) pid, sid from e where rv order by pid, sat desc
  ), used as (
    select e.* from e left join last_rv r on r.pid = e.pid
     where (r.sid is null and not e.rv) or e.sid = r.sid
  ), cnt as (
    select pid, sum(q) q from used group by pid
  ), ref_sid as (
    select distinct on (pid) pid, sid from used order by pid, sat desc
  ), ref as (
    select r.pid, coalesce(bk.q, 0) q from ref_sid r left join bk on bk.sid = r.sid and bk.pid = r.pid
  ), snaps as (
    select l.stocktake_id sid, l.loaded_at ts, l.product_id pid, l.qty q
      from public.stocktake_book_log l join ids on ids.id = l.stocktake_id
      left join public.stocktake_book_versions v on v.id = l.version_id
     where v.status is distinct from 'cancelled'
    union all
    select b.stocktake_id, min(b.created_at) over (partition by b.stocktake_id), b.product_id, b.book_qty
      from public.stocktake_book b join ids on ids.id = b.stocktake_id
     where ids.form_kind is null
  ), sp as (
    select sid, ts, pid, sum(q) q from snaps group by 1, 2, 3
  ), pick as (
    select distinct on (d) d, sid, ts
      from (select distinct (ts at time zone 'Asia/Tbilisi')::date d, sid, ts from sp) x
     order by d, ts desc
  ), dq as (
    select pk.d, sp.pid, sp.q from pick pk join sp on sp.sid = pk.sid and sp.ts = pk.ts
  ), span as (
    select d, lead(d) over (order by d) nd from pick
  ), chg as (
    select s.d, s.nd, p.pid
      from span s cross join (select distinct pid from dq) p
      left join dq a on a.d = s.d and a.pid = p.pid
      left join dq b on b.d = s.nd and b.pid = p.pid
     where s.nd is not null and coalesce(a.q, 0) <> coalesce(b.q, 0)
  ), mv as (
    select distinct u.pid from used u join chg c on c.pid = u.pid and u.d >= c.d and u.d < c.nd
  ), all_p as (
    select pid from cur union select pid from cnt union select pid from ever
  )
  select a.pid, coalesce(cur.q, 0), ref.q, cnt.q, coalesce(price.c, 0),
         case
           when cnt.pid is null and coalesce(cur.q, 0) > 0 then 'missed'
           when cnt.pid is null and ever.pid is not null then 'missed'
           when cnt.pid is not null and (cnt.q <> coalesce(ref.q, 0) or mv.pid is not null) then 'review'
           else 'ok'
         end,
         cnt.pid is null and coalesce(cur.q, 0) <= 0 and ever.pid is not null,
         mv.pid is not null
    from all_p a
    left join cur on cur.pid = a.pid
    left join cnt on cnt.pid = a.pid
    left join ref on ref.pid = a.pid
    left join ever on ever.pid = a.pid
    left join price on price.pid = a.pid
    left join mv on mv.pid = a.pid;
$function$;

-- 6) -------------------------------------------------------------------------
create or replace function public.spread_book(p_from uuid)
 returns table(number text, stale boolean)
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  co uuid := public.auth_company_id();
  src public.stocktakes;
  sib record;
  srcv public.stocktake_book_versions;
  today date := (now() at time zone 'Asia/Tbilisi')::date;
begin
  if coalesce(public.auth_role()::text, '') not in ('owner', 'admin') then
    raise exception 'not allowed';
  end if;
  select * into src from public.stocktakes where id = p_from and company_id = co;
  if src.id is null or src.status <> 'open' then raise exception 'not open'; end if;
  select * into srcv from public.stocktake_book_versions
   where stocktake_id = src.id and status = 'active' order by loaded_at desc limit 1;
  for sib in
    select s.id from public.stocktakes s
     where s.company_id = co and s.status = 'open' and s.archived_at is null
       and s.kind = src.kind and s.form_kind is null and s.id <> src.id
       and s.cycle_id is not distinct from src.cycle_id
       and coalesce(s.branch, s.client_name, s.name) = coalesce(src.branch, src.client_name, src.name)
  loop
    perform public.log_book(sib.id);
    delete from public.stocktake_book where stocktake_id = sib.id;
    insert into public.stocktake_book
      (company_id, stocktake_id, product_id, location_id, book_qty, unit_cost, expiry_date)
    select company_id, sib.id, product_id, location_id, book_qty, unit_cost, expiry_date
      from public.stocktake_book where stocktake_id = src.id;
    perform public.new_book_version(sib.id, srcv.file_name, 'გადმოვიდა ' || src.number || '-დან');
  end loop;
  return query
    select s.number, exists (
             select 1 from public.stocktake_entries e
              where e.stocktake_id = s.id
                and (e.created_at at time zone 'Asia/Tbilisi')::date < today)
      from public.stocktakes s
     where s.company_id = co and s.status = 'open' and s.archived_at is null
       and s.kind = src.kind and s.form_kind is null
       and s.cycle_id is not distinct from src.cycle_id
       and coalesce(s.branch, s.client_name, s.name) = coalesce(src.branch, src.client_name, src.name)
     order by s.number;
end;
$function$;
