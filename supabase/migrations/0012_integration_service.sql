-- A sixth service line: choosing and implementing warehouse and accounting
-- systems (WMS, barcodes, the link to the accounting software). The contact
-- form stores it like the other five.

alter type public.service_line add value if not exists 'integration';
