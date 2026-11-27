-- A warehouse's floor plan for the 3D map: where each rack section stands,
-- the outline of the building, rooms and pillars. Kept on the site itself, so
-- the existing row-level security of sites (own company only; owner/admin
-- edit) covers it — no new table, no new policy.
--   { "sections": [{ "c": "A-1", "x": 2.0, "z": -1.5, "w": 1.0, "a": 0 }, …],
--     "outline": [[x, z], …], "rooms": [{ "n", "x0", "x1", "z0", "z1" }],
--     "pillars": [[x, z], …] }
alter table public.sites
  add column if not exists layout jsonb
  check (layout is null or (jsonb_typeof(layout) = 'object' and pg_column_size(layout) < 2000000));
