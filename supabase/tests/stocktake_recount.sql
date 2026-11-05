-- Recount rule (0018): blind book, three recounts, then frozen.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/stocktake_recount.sql
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
  ('c2222222-2222-2222-2222-222222222222', 'counter@gamma.ge');

set local role authenticated;
set local request.jwt.claim.sub = 'c1111111-1111-1111-1111-111111111111';
select public.create_company_for_current_user('Gamma');
select public.seed_demo_data();

do $$
declare
  co uuid; st uuid; loc uuid; p1 uuid; p2 uuid; p3 uuid; n int; s public.stocktake_check_status;
  me constant uuid := 'c2222222-2222-2222-2222-222222222222';
begin
  reset role;
  select company_id into co from public.user_profiles where id = 'c1111111-1111-1111-1111-111111111111';
  insert into public.user_profiles (id, company_id, email, role) values (me, co, 'counter@gamma.ge', 'member');
  select id into loc from public.locations where company_id = co order by code limit 1;
  select id into p1 from public.products where company_id = co order by sku limit 1;
  select id into p2 from public.products where company_id = co order by sku limit 1 offset 1;
  select id into p3 from public.products where company_id = co order by sku limit 1 offset 2;

  set local role authenticated;
  set local request.jwt.claim.sub = 'c1111111-1111-1111-1111-111111111111';
  insert into public.stocktakes (company_id, name) values (co, 'R') returning id into st;
  insert into public.stocktake_book (company_id, stocktake_id, product_id, location_id, book_qty) values
    (co, st, p1, loc, 10), (co, st, p2, loc, 5), (co, st, p3, loc, 2);
  insert into public.stocktake_counters (stocktake_id, user_id, company_id) values (st, me, co);

  perform set_config('request.jwt.claim.sub', me::text, true);
  perform pg_temp.expect((select count(*) from public.stocktake_book) = 0, 'a counter cannot read the book');
  insert into public.stocktake_zones (company_id, stocktake_id, location_id, counter_id) values (co, st, loc, me);
  -- p1 right, p2 wrong, p3 not counted at all.
  insert into public.stocktake_entries (company_id, stocktake_id, location_id, product_id, quantity, counter_id) values
    (co, st, loc, p1, 10, me), (co, st, loc, p2, 4, me);

  select count(*) into n from public.close_stocktake_zone(st, loc);
  perform pg_temp.expect(n = 2, 'first close: the wrong item and the missed item come back for recount');
  perform pg_temp.expect((select status from public.stocktake_zones where stocktake_id = st) = 'counting', 'zone stays open while recounts are due');
  perform pg_temp.expect((select status from public.stocktake_checks where product_id = p1) = 'ok', 'the matching item is ok');

  -- p3 found on recount; p2 still wrong three more times.
  insert into public.stocktake_entries (company_id, stocktake_id, location_id, product_id, quantity, counter_id) values (co, st, loc, p3, 2, me);
  perform public.close_stocktake_zone(st, loc);
  perform pg_temp.expect((select status from public.stocktake_checks where product_id = p3) = 'ok', 'a recount that matches turns ok');
  perform pg_temp.expect((select attempts from public.stocktake_checks where product_id = p2) = 1, 'a failed recount is counted');
  perform public.close_stocktake_zone(st, loc);
  perform pg_temp.expect((select status from public.stocktake_checks where product_id = p2) = 'recount', 'still recount after two failed recounts');
  perform public.close_stocktake_zone(st, loc);
  perform pg_temp.expect((select status from public.stocktake_checks where product_id = p2) = 'frozen', 'frozen after the third failed recount');
  perform pg_temp.expect((select status from public.stocktake_zones where stocktake_id = st) = 'done', 'zone done when only frozen items are left');

  begin
    update public.stocktake_entries set quantity = 5 where product_id = p2;
    raise exception 'FAILED: a counter changed a frozen item';
  exception when raise_exception then
    perform pg_temp.expect(true, 'a counter cannot change a frozen item');
  end;

  set local request.jwt.claim.sub = 'c1111111-1111-1111-1111-111111111111';
  update public.stocktake_entries set quantity = 5 where product_id = p2;
  perform pg_temp.expect((select quantity from public.stocktake_entries where product_id = p2) = 5, 'the manager can still correct a frozen item');
  -- 0019: one open zone per counter; Close freezes what is left.
  set local request.jwt.claim.sub = 'c1111111-1111-1111-1111-111111111111';
  insert into public.stocktakes (company_id, name) values (co, 'R2') returning id into st;
  insert into public.stocktake_book (company_id, stocktake_id, product_id, location_id, book_qty) values (co, st, p1, loc, 10);
  insert into public.stocktake_counters (stocktake_id, user_id, company_id) values (st, me, co);
  perform set_config('request.jwt.claim.sub', me::text, true);
  insert into public.stocktake_zones (company_id, stocktake_id, location_id, counter_id) values (co, st, loc, me);
  begin
    insert into public.stocktake_zones (company_id, stocktake_id, location_id, counter_id)
      values (co, st, (select id from public.locations where company_id = co order by code desc limit 1), me);
    raise exception 'FAILED: a counter opened a second zone';
  exception when unique_violation then
    perform pg_temp.expect(true, 'one open zone per counter');
  end;
  insert into public.stocktake_entries (company_id, stocktake_id, location_id, product_id, quantity, counter_id) values (co, st, loc, p1, 9, me);
  perform public.close_stocktake_zone(st, loc);
  perform public.finish_stocktake_zone(st, loc);
  perform pg_temp.expect((select status from public.stocktake_checks where stocktake_id = st and product_id = p1) = 'frozen', 'Close freezes an unresolved item');
  perform pg_temp.expect((select status from public.stocktake_zones where stocktake_id = st) = 'done', 'Close marks the zone done');
  update public.stocktake_zones set note = 'ზედა თარო დაზიანებულია' where stocktake_id = st;
  perform pg_temp.expect((select note from public.stocktake_zones where stocktake_id = st) is not null, 'the counter writes a shelf note');
end;
$$;

rollback;
