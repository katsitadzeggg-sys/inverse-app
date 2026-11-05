-- Fixed assets (0025): psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/assets.sql
begin;
create or replace function pg_temp.expect(c boolean, what text) returns void language plpgsql as $$
begin if not c then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end; $$;

insert into auth.users (id, email) values
  ('d1111111-1111-1111-1111-111111111111', 'owner@delta.ge'),
  ('d2222222-2222-2222-2222-222222222222', 'counter@delta.ge'),
  ('e1111111-1111-1111-1111-111111111111', 'owner@eps.ge');
set local role authenticated;
set local request.jwt.claim.sub = 'e1111111-1111-1111-1111-111111111111';
select public.create_company_for_current_user('Eps');
set local request.jwt.claim.sub = 'd1111111-1111-1111-1111-111111111111';
select public.create_company_for_current_user('Delta');
insert into public.company_invites (company_id, email, role, invited_by) values (public.auth_company_id(), 'counter@delta.ge', 'member', auth.uid());

do $$
declare co uuid; st uuid; room uuid; reg uuid;
begin
  co := public.auth_company_id();
  insert into public.stocktakes (company_id, name, kind, created_by) values (co, 'Delta assets', 'assets', auth.uid()) returning id into st;
  insert into public.locations (company_id, code, name) values (co, 'R-101', 'ოთახი 101') returning id into room;
  insert into public.asset_register (company_id, stocktake_id, inv_no, name, room) values (co, st, 'ინვ-0001', 'მაგიდა', 'R-101') returning id into reg;

  perform set_config('request.jwt.claim.sub', 'd2222222-2222-2222-2222-222222222222', true);
  perform public.accept_company_invite();
  perform set_config('request.jwt.claim.sub', 'd1111111-1111-1111-1111-111111111111', true);
  insert into public.stocktake_counters (stocktake_id, user_id, company_id) values (st, 'd2222222-2222-2222-2222-222222222222', co);
  perform set_config('request.jwt.claim.sub', 'd2222222-2222-2222-2222-222222222222', true);
  perform pg_temp.expect((select count(*) from public.asset_register) = 1, 'counter sees the register');
  begin
    insert into public.asset_register (company_id, stocktake_id, inv_no, name) values (co, st, 'X', 'x');
    raise exception 'FAILED: counter wrote register';
  exception when insufficient_privilege then raise notice 'ok: counter cannot change the register';
  end;
  insert into public.asset_checks (company_id, stocktake_id, register_id, location_id, inv_no, name, counter_id)
    values (co, st, reg, room, 'ინვ-0001', 'მაგიდა', auth.uid());
  insert into public.asset_checks (company_id, stocktake_id, location_id, inv_no, name, condition, counter_id)
    values (co, st, room, 'ზედ-1', 'სკამი', 'damaged', auth.uid());
  perform pg_temp.expect((select count(*) from public.asset_checks) = 2, 'counter records found and surplus');
  begin
    insert into public.asset_checks (company_id, stocktake_id, location_id, inv_no, name, counter_id)
      values (co, st, room, 'ინვ-0001', 'მაგიდა', auth.uid());
    raise exception 'FAILED: same asset twice';
  exception when unique_violation then raise notice 'ok: one record per inventory number';
  end;

  perform set_config('request.jwt.claim.sub', 'e1111111-1111-1111-1111-111111111111', true);
  perform pg_temp.expect((select count(*) from public.asset_checks) + (select count(*) from public.asset_register) = 0, 'other company sees nothing');

  perform set_config('request.jwt.claim.sub', 'd1111111-1111-1111-1111-111111111111', true);
  update public.stocktakes set status = 'closed' where id = st;
  perform set_config('request.jwt.claim.sub', 'd2222222-2222-2222-2222-222222222222', true);
  begin
    insert into public.asset_checks (company_id, stocktake_id, location_id, inv_no, name, counter_id)
      values (co, st, room, 'ზედ-2', 'კარადა', auth.uid());
    raise exception 'FAILED: wrote on closed stocktake';
  exception when raise_exception then raise notice 'ok: closed stocktake takes no records';
  end;
end $$;
rollback;
