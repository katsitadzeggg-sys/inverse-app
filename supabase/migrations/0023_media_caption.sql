-- Shelf media are captured live only. Each row keeps what is burned into the
-- picture as a caption strip: when, who, where (GPS). A video also gets a
-- poster frame (a JPEG with the same caption) stored next to it.
alter table public.stocktake_media
  add column caption     text,
  add column taken_at    timestamptz,
  add column lat         double precision check (lat between -90 and 90),
  add column lng         double precision check (lng between -180 and 180),
  add column accuracy_m  real,
  add column poster_path text;
