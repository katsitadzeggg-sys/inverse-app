-- 0061: count cycles the manager names and runs (Giorgi, 17–18.11).
--  * A cycle has a name ("2026 წლის ბოლო აღწერა") and a short company-wide
--    code (C1, C2 …) shown beside the stocktake number — the number itself
--    never changes (printed acts and labels carry it).
--  * Status: open → done (closed_at) → archived (archived_at).
--  * The manager starts a cycle by name (create_count_cycle) or names it when
--    opening a warehouse's first stocktake; a stocktake may be given its
--    cycle, which must be this company's open cycle of the same warehouse.
--    Without one it still joins the warehouse's open cycle (counters' phones).
--  * Still one open cycle per warehouse.

alter table public.count_cycles
  add column if not exists name text,
  add column if not exists code int,
  add column if not exists archived_at timestamptz;

-- Codes for the cycles there are, oldest first, per company.
with n as (
  select id, row_number() over (partition by company_id order by started_at, id) rn
    from public.count_cycles
)
update public.count_cycles c set code = n.rn from n where n.id = c.id and c.code is null;

create unique index if not exists count_cycles_code
  on public.count_cycles (company_id, code);

-- Every new cycle gets the company's next code.
create or replace function public.count_cycle_code()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.code is null then
    perform pg_advisory_xact_lock(hashtext('count_cycle_code:' || new.company_id::text));
    select coalesce(max(code), 0) + 1 into new.code
      from public.count_cycles where company_id = new.company_id;
  end if;
  return new;
end;
$$;
drop trigger if exists count_cycles_code on public.count_cycles;
create trigger count_cycles_code before insert on public.count_cycles
  for each row execute function public.count_cycle_code();

-- A stocktake joins the cycle it was given (checked) or its warehouse's open one.
create or replace function public.stocktake_cycle()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  wh text := coalesce(nullif(new.branch, ''), nullif(new.client_name, ''), new.name);
  c uuid;
begin
  if new.kind = 'assets' then return new; end if;
  if new.cycle_id is not null then
    if not exists (
      select 1 from public.count_cycles
       where id = new.cycle_id and company_id = new.company_id
         and warehouse = wh and closed_at is null
    ) then
      raise exception 'cycle is not this warehouse''s open cycle';
    end if;
    return new;
  end if;
  select id into c from public.count_cycles
   where company_id = new.company_id and warehouse = wh and closed_at is null;
  if c is null then
    insert into public.count_cycles (company_id, warehouse) values (new.company_id, wh)
    on conflict do nothing returning id into c;
    if c is null then
      select id into c from public.count_cycles
       where company_id = new.company_id and warehouse = wh and closed_at is null;
    end if;
  end if;
  new.cycle_id := c;
  return new;
end;
$$;

-- The manager starts a named cycle for a warehouse (none may be open there).
create or replace function public.create_count_cycle(p_warehouse text, p_name text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  co uuid := public.auth_company_id();
  c uuid;
begin
  if coalesce(public.auth_role()::text, '') not in ('owner', 'admin') then
    raise exception 'not allowed';
  end if;
  if coalesce(trim(p_warehouse), '') = '' then raise exception 'no warehouse'; end if;
  if exists (select 1 from public.count_cycles
              where company_id = co and warehouse = trim(p_warehouse) and closed_at is null) then
    raise exception 'open cycle exists';
  end if;
  insert into public.count_cycles (company_id, warehouse, name)
  values (co, trim(p_warehouse), nullif(trim(p_name), ''))
  returning id into c;
  return c;
end;
$$;
revoke all on function public.create_count_cycle(text, text) from public, anon;
grant execute on function public.create_count_cycle(text, text) to authenticated;

-- Rename a cycle; move a closed one to the archive or back.
create or replace function public.update_count_cycle(p_cycle uuid, p_name text, p_archived boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  co uuid := public.auth_company_id();
  cy public.count_cycles;
begin
  if coalesce(public.auth_role()::text, '') not in ('owner', 'admin') then
    raise exception 'not allowed';
  end if;
  select * into cy from public.count_cycles where id = p_cycle and company_id = co for update;
  if cy.id is null then raise exception 'not found'; end if;
  if p_archived and cy.closed_at is null then raise exception 'close it first'; end if;
  update public.count_cycles
     set name = case when p_name is null then name else nullif(trim(p_name), '') end,
         archived_at = case
           when p_archived is null then archived_at
           when p_archived then coalesce(archived_at, now())
           else null end
   where id = p_cycle;
end;
$$;
revoke all on function public.update_count_cycle(uuid, text, boolean) from public, anon;
grant execute on function public.update_count_cycle(uuid, text, boolean) to authenticated;

notify pgrst, 'reload schema';
