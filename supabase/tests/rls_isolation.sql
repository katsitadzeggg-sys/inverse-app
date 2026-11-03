-- Tenant isolation test. Run against a database with the migrations applied:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_isolation.sql
-- It raises an exception on the first policy that fails to hold, and rolls back.

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

-- Two tenants, created the way the app creates them.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'ana@alpha.ge'),
  ('22222222-2222-2222-2222-222222222222', 'beka@beta.ge'),
  ('33333333-3333-3333-3333-333333333333', 'gia@alpha.ge');

set local role authenticated;

set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.create_company_for_current_user('Alpha Trading');
select public.seed_demo_data();

set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select public.create_company_for_current_user('Beta Supply');
select public.seed_demo_data();

-- Each tenant sees only its own catalogue.
select pg_temp.expect(
  (select count(*) from public.products) = 7,
  'Beta sees exactly its own 7 demo products'
);
select pg_temp.expect(
  (select count(distinct company_id) from public.products) = 1,
  'Beta sees rows from exactly one company'
);

set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.expect(
  (select count(*) from public.products) = 7,
  'Alpha sees exactly its own 7 demo products'
);
select pg_temp.expect(
  (select count(*) from public.companies) = 1,
  'Alpha sees only its own company row'
);
select pg_temp.expect(
  (select count(*) from public.product_stock) = 7,
  'The product_stock view is scoped by the caller, not the owner'
);

-- Cross-tenant write is refused by the INSERT policy's WITH CHECK.
do $$
declare
  other uuid;
begin
  reset role; -- back to the superuser/owner role for setup
  select id into other from public.companies where slug like 'beta%';
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
  begin
    insert into public.products (company_id, sku, name) values (other, 'STOLEN-1', 'Injected');
    raise exception 'FAILED: Alpha was able to insert a row into Beta';
  exception
    when insufficient_privilege then
      raise notice 'ok: cross-tenant insert refused';
  end;
end;
$$;

-- Updating another tenant's row matches no rows rather than changing one.
do $$
declare
  touched integer;
begin
  reset role; -- back to the superuser/owner role for setup
  update public.products set name = 'Renamed by owner' where sku = 'JAN-1362';
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
  update public.products set name = 'Hijacked' where sku = 'JAN-1362';
  get diagnostics touched = row_count;
  perform pg_temp.expect(touched = 1, 'Alpha updates exactly its own copy of JAN-1362, not both');
end;
$$;

-- A viewer can read but not write.
do $$
declare
  alpha uuid;
begin
  reset role; -- back to the superuser/owner role for setup
  select company_id into alpha from public.user_profiles
    where id = '11111111-1111-1111-1111-111111111111';
  insert into public.user_profiles (id, company_id, email, role)
    values ('33333333-3333-3333-3333-333333333333', alpha, 'gia@alpha.ge', 'viewer');

  set local role authenticated;
  set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
  perform pg_temp.expect(
    (select count(*) from public.products) = 7,
    'A viewer can read the catalogue'
  );
  begin
    insert into public.products (company_id, sku, name) values (alpha, 'VIEWER-1', 'Nope');
    raise exception 'FAILED: a viewer was able to insert a product';
  exception
    when insufficient_privilege then
      raise notice 'ok: viewer insert refused';
  end;
end;
$$;

-- A second company for the same user is refused.
do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
  begin
    perform public.create_company_for_current_user('Alpha Again');
    raise exception 'FAILED: a user was able to own a second company';
  exception
    when unique_violation then
      raise notice 'ok: second company refused';
  end;
end;
$$;

-- The public contact form writes requests, and only writes them.
do $$
declare
  n integer;
begin
  set local role anon;
  insert into public.contact_requests (name, email, message, topic, locale)
    values ('Anon', 'anon@novora.ge', 'Please quote a full count.', 'service', 'ka');
  begin
    select count(*) into n from public.contact_requests;
    raise exception 'FAILED: anon read % contact rows', n;
  exception
    when insufficient_privilege then
      raise notice 'ok: anon can submit a contact request but cannot read them back';
  end;
end;
$$;

-- Anonymous visitors reach nothing else.
do $$
begin
  set local role anon;
  begin
    perform 1 from public.products limit 1;
    raise exception 'FAILED: anon reached the products table';
  exception
    when insufficient_privilege then
      raise notice 'ok: anon cannot reach tenant tables';
  end;
end;
$$;

reset role;
rollback;
