-- A counter says "I'm done" for the whole stocktake (after closing their
-- open shelf/room); the manager sees who has finished and when.
-- finished_at null = they came back and are counting again.
create table public.stocktake_finished (
  stocktake_id uuid not null references public.stocktakes (id) on delete cascade,
  user_id      uuid not null references public.user_profiles (id) on delete cascade,
  company_id   uuid not null references public.companies (id) on delete cascade,
  finished_at  timestamptz,
  primary key (stocktake_id, user_id)
);

grant select on public.stocktake_finished to authenticated;
alter table public.stocktake_finished enable row level security;
alter table public.stocktake_finished force row level security;
create policy stocktake_finished_select on public.stocktake_finished
  for select to authenticated using (company_id = public.auth_company_id());

create or replace function public.set_my_count_finished(p_stocktake uuid, p_finished boolean)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_company uuid;
begin
  select company_id into v_company from public.stocktakes
   where id = p_stocktake and company_id = public.auth_company_id() and status = 'open';
  if v_company is null or not public.can_count_in(p_stocktake) then
    raise exception 'not allowed';
  end if;
  if p_finished and exists (select 1 from public.stocktake_zones
       where stocktake_id = p_stocktake and counter_id = auth.uid() and status = 'counting') then
    raise exception 'close the open shelf first';
  end if;
  insert into public.stocktake_finished (stocktake_id, user_id, company_id, finished_at)
  values (p_stocktake, auth.uid(), v_company, case when p_finished then now() end)
  on conflict (stocktake_id, user_id) do update set finished_at = excluded.finished_at;
end;
$$;
revoke all on function public.set_my_count_finished(uuid, boolean) from public, anon;
grant execute on function public.set_my_count_finished(uuid, boolean) to authenticated;
