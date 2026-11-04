-- Stocktake rules (0017). Run against a database with the migrations applied:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/stocktakes.sql
-- Raises on the first rule that fails, and rolls back.

begin;

create or replace function pg_temp.expect(condition boolean, what text)
returns void language plpgsql as $$
begin
  if not condition then
    raise exception 'FAILED: %', what;
  end if;
  raise notice 'ok: %', what;
end;
$$;

insert into auth.users (id, email) values
  ('a1111111-1111-1111-1111-111111111111', 'owner@alpha.ge'),
  ('a2222222-2222-2222-2222-222222222222', 'counter1@alpha.ge'),
  ('a3333333-3333-3333-3333-333333333333', 'counter2@alpha.ge'),
  ('b1111111-1111-1111-1111-111111111111', 'owner@beta.ge');

set local role authenticated;
set local request.jwt.claim.sub = 'a1111111-1111-1111-1111-111111111111';
select public.create_company_for_current_user('Alpha Trading');
select public.seed_demo_data();
set local request.jwt.claim.sub = 'b1111111-1111-1111-1111-111111111111';
select public.create_company_for_current_user('Beta Supply');
select public.seed_demo_data();

do $$
declare
  alpha uuid; beta uuid; st uuid; loc uuid; loc2 uuid; prod uuid; beta_loc uuid; e uuid;
begin
  reset role;
  select company_id into alpha from public.user_profiles where id = 'a1111111-1111-1111-1111-111111111111';
  select company_id into beta from public.user_profiles where id = 'b1111111-1111-1111-1111-111111111111';
  insert into public.user_profiles (id, company_id, email, role) values
    ('a2222222-2222-2222-2222-222222222222', alpha, 'counter1@alpha.ge', 'member'),
    ('a3333333-3333-3333-3333-333333333333', alpha, 'counter2@alpha.ge', 'member');
  select id into loc from public.locations where company_id = alpha order by code limit 1;
  select id into loc2 from public.locations where company_id = alpha order by code desc limit 1;
  select id into prod from public.products where company_id = alpha limit 1;
  select id into beta_loc from public.locations where company_id = beta limit 1;

  -- A counter cannot open a stocktake; the owner can.
  set local role authenticated;
  set local request.jwt.claim.sub = 'a2222222-2222-2222-2222-222222222222';
  begin
    insert into public.stocktakes (company_id, name) values (alpha, 'Nope');
    raise exception 'FAILED: a member opened a stocktake';
  exception when insufficient_privilege then
    perform pg_temp.expect(true, 'a member cannot open a stocktake');
  end;

  set local request.jwt.claim.sub = 'a1111111-1111-1111-1111-111111111111';
  insert into public.stocktakes (company_id, name, created_by)
    values (alpha, 'Q4 count', 'a1111111-1111-1111-1111-111111111111') returning id into st;
  perform pg_temp.expect(st is not null, 'the owner opens a stocktake');

  -- Counter 1 claims a zone and counts; counter 2 cannot take the same zone.
  set local request.jwt.claim.sub = 'a2222222-2222-2222-2222-222222222222';
  insert into public.stocktake_zones (company_id, stocktake_id, location_id, counter_id)
    values (alpha, st, loc, 'a2222222-2222-2222-2222-222222222222');
  insert into public.stocktake_entries (company_id, stocktake_id, location_id, product_id, quantity, boxes, per_box, counter_id)
    values (alpha, st, loc, prod, 288, 12, 24, 'a2222222-2222-2222-2222-222222222222') returning id into e;
  perform pg_temp.expect(e is not null, 'a counter records a line (12 × 24)');

  set local request.jwt.claim.sub = 'a3333333-3333-3333-3333-333333333333';
  begin
    insert into public.stocktake_zones (company_id, stocktake_id, location_id, counter_id)
      values (alpha, st, loc, 'a3333333-3333-3333-3333-333333333333');
    raise exception 'FAILED: two counters claimed one zone';
  exception when unique_violation then
    perform pg_temp.expect(true, 'a zone has one counter at a time');
  end;
  -- Another counter cannot edit or delete counter 1's line (RLS hides it from writes).
  update public.stocktake_entries set quantity = 1 where id = e;
  delete from public.stocktake_entries where id = e;
  perform pg_temp.expect(
    (select quantity from public.stocktake_entries where id = e) = 288,
    'a counter cannot change another counter''s line'
  );
  -- Nor can anyone write a line in someone else's name.
  begin
    insert into public.stocktake_entries (company_id, stocktake_id, location_id, product_id, quantity, counter_id)
      values (alpha, st, loc2, prod, 5, 'a2222222-2222-2222-2222-222222222222');
    raise exception 'FAILED: a line was written under another counter';
  exception when insufficient_privilege then
    perform pg_temp.expect(true, 'lines are written only under your own name');
  end;

  -- A location from another company is refused.
  begin
    insert into public.stocktake_entries (company_id, stocktake_id, location_id, product_id, quantity, counter_id)
      values (alpha, st, beta_loc, prod, 5, 'a3333333-3333-3333-3333-333333333333');
    raise exception 'FAILED: a foreign location was accepted';
  exception when raise_exception then
    perform pg_temp.expect(true, 'a location from another company is refused');
  end;

  -- An unknown item needs a description.
  begin
    insert into public.stocktake_entries (company_id, stocktake_id, location_id, quantity, counter_id)
      values (alpha, st, loc2, 3, 'a3333333-3333-3333-3333-333333333333');
    raise exception 'FAILED: a line with neither product nor description was accepted';
  exception when check_violation then
    perform pg_temp.expect(true, 'an unknown item needs a description');
  end;

  -- Beta sees nothing of Alpha's stocktake.
  set local request.jwt.claim.sub = 'b1111111-1111-1111-1111-111111111111';
  perform pg_temp.expect(
    (select count(*) from public.stocktake_entries) = 0 and (select count(*) from public.stocktakes) = 0,
    'another company sees none of the stocktake'
  );

  -- Once closed, nothing more can be written.
  set local request.jwt.claim.sub = 'a1111111-1111-1111-1111-111111111111';
  update public.stocktakes set status = 'closed', closed_at = now() where id = st;
  set local request.jwt.claim.sub = 'a2222222-2222-2222-2222-222222222222';
  begin
    insert into public.stocktake_entries (company_id, stocktake_id, location_id, product_id, quantity, counter_id)
      values (alpha, st, loc, prod, 1, 'a2222222-2222-2222-2222-222222222222');
    raise exception 'FAILED: a line was added to a closed stocktake';
  exception when raise_exception then
    perform pg_temp.expect(true, 'a closed stocktake takes no new lines');
  end;
end;
$$;

rollback;
