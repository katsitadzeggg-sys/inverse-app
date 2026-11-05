-- Fixed-asset groups (ავეჯი, კომპიუტერული ტექნიკა, …): from the register or
-- chosen by the counter; the result and the act are grouped by them.
alter table public.asset_register add column group_name text;
alter table public.asset_checks   add column group_name text;
