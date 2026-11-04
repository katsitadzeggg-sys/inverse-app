-- Invites and removal (0022). Run against a database with the migrations applied:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/invites.sql
begin;

create or replace function pg_temp.expect(condition boolean, what text)
returns void language plpgsql as $$
begin
  if not condition then raise exception 'FAILED: %', what; end if;
  raise notice 'ok: %', what;
end;
$$;

insert into auth.users (id, email) values
  ('c1111111-1111-1111-1111-111111111111', 'owner@gamma.ge'),
  ('c2222222-2222-2222-2222-222222222222', 'Counter@Gamma.ge'),
  ('c3333333-3333-3333-3333-333333333333', 'stranger@x.ge'),
  ('c4444444-4444-4444-4444-444444444444', 'boss@gamma.ge');

set local role authenticated;
set local request.jwt.claim.sub = 'c1111111-1111-1111-1111-111111111111';
select public.create_company_for_current_user('Gamma');
insert into public.company_invites (company_id, email, role, invited_by)
  values (public.auth_company_id(), 'counter@gamma.ge', 'member', auth.uid()),
         (public.auth_company_id(), 'boss@gamma.ge', 'admin', auth.uid());

do $$ begin
  -- counter joins
  perform set_config('request.jwt.claim.sub', 'c2222222-2222-2222-2222-222222222222', true);
  perform pg_temp.expect(public.accept_company_invite() = 'joined', 'invited email joins (case-insensitive)');
  perform pg_temp.expect(public.auth_role() = 'member', 'joins with invited role');
  perform pg_temp.expect(public.accept_company_invite() = 'member', 'second call is a no-op');
  perform pg_temp.expect((select count(*) from public.company_invites) = 0, 'counter cannot see invites');

  -- stranger has nothing
  perform set_config('request.jwt.claim.sub', 'c3333333-3333-3333-3333-333333333333', true);
  perform pg_temp.expect(public.accept_company_invite() = 'none', 'no invite → none');

  -- admin joins, cannot remove owner or other admin-level
  perform set_config('request.jwt.claim.sub', 'c4444444-4444-4444-4444-444444444444', true);
  perform pg_temp.expect(public.accept_company_invite() = 'joined', 'admin joins');
  begin
    perform public.remove_team_member('c1111111-1111-1111-1111-111111111111');
    raise exception 'FAILED: admin removed owner';
  exception when insufficient_privilege then raise notice 'ok: owner cannot be removed';
  end;

  -- counter cannot remove anyone
  perform set_config('request.jwt.claim.sub', 'c2222222-2222-2222-2222-222222222222', true);
  begin
    perform public.remove_team_member('c4444444-4444-4444-4444-444444444444');
    raise exception 'FAILED: counter removed admin';
  exception when insufficient_privilege then raise notice 'ok: counter cannot remove';
  end;

  -- owner removes counter: access gone, name kept
  perform set_config('request.jwt.claim.sub', 'c1111111-1111-1111-1111-111111111111', true);
  perform public.remove_team_member('c2222222-2222-2222-2222-222222222222');
  perform pg_temp.expect((select email from public.user_profiles where id = 'c2222222-2222-2222-2222-222222222222') = 'counter@gamma.ge', 'removed profile still listed for owner');

  perform set_config('request.jwt.claim.sub', 'c2222222-2222-2222-2222-222222222222', true);
  perform pg_temp.expect(public.auth_company_id() is null, 'removed user has no company');
  perform pg_temp.expect((select count(*) from public.user_profiles) = 0, 'removed user sees no profiles');
  perform pg_temp.expect(public.accept_company_invite() = 'disabled', 'removed, not re-invited → disabled');

  -- re-invite brings them back
  perform set_config('request.jwt.claim.sub', 'c1111111-1111-1111-1111-111111111111', true);
  insert into public.company_invites (company_id, email, role, invited_by)
    values (public.auth_company_id(), 'counter@gamma.ge', 'viewer', auth.uid());
  perform set_config('request.jwt.claim.sub', 'c2222222-2222-2222-2222-222222222222', true);
  perform pg_temp.expect(public.accept_company_invite() = 'joined', 're-invite rejoins');
  perform pg_temp.expect(public.auth_role() = 'viewer', 'rejoins with new role');
end $$;

rollback;
