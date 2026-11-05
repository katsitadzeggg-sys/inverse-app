-- Archive instead of delete: an archived stocktake disappears from every list
-- but keeps all its data (shelves, counts, photos, act) and can be restored.
alter table public.stocktakes add column archived_at timestamptz;
create index stocktakes_active_idx on public.stocktakes (company_id) where archived_at is null;
