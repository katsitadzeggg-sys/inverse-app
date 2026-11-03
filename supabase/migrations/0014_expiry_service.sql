-- Expiry control becomes a service line of its own (2026-10-07). The older
-- values stay in the enum so earlier requests keep their meaning.

alter type public.service_line add value if not exists 'expiry';
