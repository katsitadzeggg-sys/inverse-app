# Roadmap

Source: the feature matrix "inverse vs apps" (Google Drive) — 39 features
compared across 24 apps, and the backlog sheet in the same file.

## Stage 1 — MVP (first real count)

Goal: run one real inventory end to end (Extra or the first client) in the app.

| # | Feature | Status |
|---|---------|--------|
| 1 | Roles: owner/admin, counter, client viewer | partly (enum exists) |
| 2 | Team counting: several counters on one count, per-counter entries, totals | not started |
| 3 | Excel/CSV import of the book register (items, locations, book quantity) | not started |
| 4 | Discrepancy vs book: counted − book, per item and location | partly (checks) |
| 5 | Discrepancy act (Georgian form) as PDF, plus Excel export | not started |
| 6 | Audit trail: who changed what and when | not started |
| 7 | Barcode/QR scan with the phone camera | demo only |
| 8 | Photo per item as evidence | done (verify) |
| 9 | Georgian interface | not started (English now) |
| 10 | Offline counting with later sync (PWA) | not started |
| 11 | Photo quantity count (layers × per layer, person confirms) | not started |
| 12 | Warehouse map from real locations (shelf codes, search) | demo only |

Order: 1 → 2 → 3 → 4 → 5 → pilot. Then 6, 9, 10, 11, 12.

## Stage 2

Labels printing, evidence bundle (time + counter + GPS + photo), signature on
the act, discrepancy approval flow, expiry/FIFO lots, pick routes, AI
auto-fill from photo, ERP/accounting integration (Balance, FINA, 1C via Excel
first), rs.ge act form, QR link to the client's report.

## Stage 3

RFID/NFC, purchase/sales orders, kits, unit conversion, AI assistant,
duplicate detection.
