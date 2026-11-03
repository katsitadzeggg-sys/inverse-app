-- 'partners' replaces 'accounting' on the site (2026-10-03): inventory for
-- audit and accounting firms at their clients. Old rows keep 'accounting'.

alter type public.service_line add value if not exists 'partners';
