# Plan for the evening session (4 Nov 2026)

Agreed with Giorgi. Nothing below is built yet.

## Structure: three separate projects on one platform

One login, one company and team, one shelf list and one scanner, but three
separate modules, each with its own menu, its own stocktake list, and its
own act/export:

1. **მარაგები (stock count)**, which is what exists now at /count and /manage.
2. **ვადიანი პროდუქცია (expiry-date count)**, a new module.
3. **ძირითადი საშუალებები (fixed assets)**, a new module.

Database: `stocktakes.kind` = 'stock' | 'expiry' | 'assets'. Each module
filters by kind, and expiry and asset details live in their own tables. One
code base, so fixes reach all three.

## A. Common work (do first)

1. **Invite a counter** (/manage → "➕ აღმწერის დამატება"):
   - Enter an email and a role (counter = member, manager = admin).
   - Table `company_invites` (email, role, company, token, expires).
   - Sign-up with that email joins the company instead of creating a new one
     (onboarding checks the invite first).
   - The team list shows who is in and lets you remove someone.
2. **Camera only for shelf media**:
   - Remove picking from the gallery and keep live capture (photo and video).
   - The time, the author and the GPS position are burned into the picture
     as a caption strip (canvas), and also stored on the row.
   - For video, the same caption goes on the first frame (a poster) and the
     same metadata is stored on the row. Burning a caption into every frame
     of a video is too heavy for a phone.
3. **Scan screen polish**:
   - Show the product line under the barcode on the camera picture itself
     (overlay): "ახალი პროდუქტი" + barcode, or name + barcode + unit, in
     smaller type.
   - Remove the ✓ code line and the extra divider under the camera.

## B. Expiry-date module (ვადიანი)

- **Book import** gets an expiry column (several lines per product, one per
  batch/expiry date).
- **Counting flow per item**: scan the barcode, then read the expiry date,
  then enter the quantity.
  - The date is read from a photo of the label with OCR. Formats to handle:
    DD.MM.YYYY, DD/MM/YY, MM/YYYY, "EXP", "BB", "ვარგ.".
  - Confirm the date; if it can't be read, type it.
  - A GS1 DataMatrix or GS1-128 code that carries the date (AI 17) is read
    straight from the scan.
- **Comparison** is by product + expiry date (batch): quantity per batch
  against the book, plus a status:
  - expired;
  - due within 15 / 40 days;
  - unknown date.
- **Act**: a table grouped by expiry, with expired lines highlighted, and a
  summary by status.

## C. Fixed assets module (ძირითადი საშუალებები)

- **Register import**: inventory number, name, location/room, responsible
  person, value, and optionally a serial number.
- **Counting flow**: scan the asset label (QR/barcode); fall back to the
  inventory number or name.
  - Record found / not found, condition (good / damaged / for write-off),
    the actual room and the responsible person.
  - **Several photos per asset**, captured live only:
    - overall view;
    - label / serial plate;
    - defects.
    Each photo gets the caption (date, author, GPS, inventory number) and
    shows as a gallery on the asset card.
  - **Video per asset**, so condition is clear: the phone's own camera at
    full quality (no in-app compression), with a 10–60 s hint. Uploaded in
    parts so a weak signal does not break it. The caption is on the poster
    frame and the metadata on the row.
- **Tagging**: print a QR label for an asset without one and attach it, so
  the next count is a scan.
- **Result**:
  - found;
  - missing (in the register, not found);
  - surplus (found, not in the register);
  - moved (found in another room);
  - condition summary.
- **Act**: the standard asset inventory form, with signatures of the
  commission. The ZIP of photos/videos has one folder per asset (inventory
  number).

## Order for the evening

A1 invites, then A3 scan polish, then A2 camera-only media, then the B
module, then C as time allows.
