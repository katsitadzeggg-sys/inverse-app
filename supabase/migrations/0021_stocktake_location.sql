-- Where the warehouse is and where each shelf was counted (Giorgi, 4 Nov 2026).
--
-- The stocktake keeps the warehouse address and a map point. When a counter
-- opens a shelf, the phone's position (with its accuracy) is stored on the
-- zone, so the summary and the export show where the count took place.

alter table public.stocktakes
  add column address text check (address is null or length(address) <= 300),
  add column lat double precision check (lat is null or lat between -90 and 90),
  add column lng double precision check (lng is null or lng between -180 and 180);

alter table public.stocktake_zones
  add column lat double precision check (lat is null or lat between -90 and 90),
  add column lng double precision check (lng is null or lng between -180 and 180),
  add column accuracy_m real check (accuracy_m is null or accuracy_m >= 0),
  add column located_at timestamptz;
