-- Per person: may this counting employee see the book quantity? (The
-- stocktake's own switch still applies on top.) And a removed employee can
-- be switched back on without a new invite.
alter table public.user_profiles add column if not exists can_see_book boolean not null default true;

create or replace function public.shelf_book(p_stocktake uuid, p_location uuid)
returns table (product_id uuid, qty numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.product_id, sum(b.book_qty)::numeric
  from public.stocktake_book b
  join public.stocktakes s on s.id = b.stocktake_id
  where b.stocktake_id = p_stocktake
    and b.location_id = p_location
    and s.company_id = public.auth_company_id()
    and s.show_book
    and coalesce((select p.can_see_book from public.user_profiles p where p.id = auth.uid()), false)
    and (public.auth_can_count(p_stocktake)
         or coalesce(public.auth_role()::text, '') in ('owner', 'admin'))
  group by b.product_id;
$$;
revoke execute on function public.shelf_book(uuid, uuid) from public, anon;
grant execute on function public.shelf_book(uuid, uuid) to authenticated;

create or replace function public.restore_team_member(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me     public.user_profiles;
  target public.user_profiles;
begin
  select * into me from public.user_profiles where id = auth.uid() and disabled_at is null;
  if me.id is null or me.role not in ('owner', 'admin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into target from public.user_profiles where id = p_user and company_id = me.company_id;
  if target.id is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if target.role = 'owner' or (me.role = 'admin' and target.role = 'admin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.user_profiles set disabled_at = null where id = target.id;
end;
$$;
revoke execute on function public.restore_team_member(uuid) from public, anon;
grant execute on function public.restore_team_member(uuid) to authenticated;
