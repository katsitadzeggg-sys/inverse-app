# Inverse — app

The signed-in, multi-tenant inventory tool behind Inverse (app.inverse.ge):
counts, locations, discrepancies against the books, and AI photo verification.
The public site lives in a separate repository (`inverse-`, inverse.ge).

**Keep the verification method private.** It is documented here and in the
app, never on the public site.

**Shared database.** The app and the site use the same Supabase project. From
4 Nov 2026 new migrations are added here only; the site repository's
`supabase/migrations` is frozen at 0016.

The build plan is in [ROADMAP.md](ROADMAP.md).

## Stack

| Layer           | Choice                                           |
| --------------- | ------------------------------------------------ |
| Framework       | Next.js 16 (App Router, Server Actions)          |
| Database & auth | Supabase (Postgres, RLS, Storage)                |
| Vision          | Claude (`claude-opus-5`) via `@anthropic-ai/sdk` |
| Styling         | Tailwind CSS v4                                  |

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in Supabase URL/anon key and your Anthropic API key
npm run dev
```

Apply the database schema to a Supabase project, in order:

```bash
supabase link --project-ref <your-project-ref>
supabase db push            # runs supabase/migrations/*.sql
```

Then sign up in the app, name your workspace, and use **Settings → Load demo catalogue**
to get a shelf worth verifying without importing anything real.

### Scripts

| Command             | What it does                                     |
| ------------------- | ------------------------------------------------ |
| `npm run dev`       | Development server                               |
| `npm run build`     | Production build                                 |
| `npm run typecheck` | `tsc --noEmit`                                   |
| `npm run lint`      | ESLint                                           |
| `npm test` | Unit tests (pricing rules, verification grading) |
| `npm run test:rls`  | Tenant-isolation test against `$DATABASE_URL`    |

## Architecture

### Tenant isolation

Every tenant table carries `company_id` and is protected by Row Level Security, so
isolation is enforced by Postgres rather than by application code. Three things work
together:

1. **Policies** scope every read and write to `public.auth_company_id()` — a
   `SECURITY DEFINER` helper that resolves the caller's company from `user_profiles`
   without recursing into its own policy.
2. **Composite foreign keys** (`0002_tenant_integrity.sql`) mean a row cannot reference a
   parent belonging to another tenant, even if a writer tries.
3. **`FORCE ROW LEVEL SECURITY`** applies the policies to the table owner too.

`supabase/tests/rls_isolation.sql` proves this holds: two tenants, cross-tenant reads and
writes, a read-only viewer, and the "one company per user" rule. Run it against any
database with the migrations applied.

New tenants are created only through `create_company_for_current_user()` — `companies` has
no `INSERT` policy at all.

### The verification flow

```
capture a still  →  upload to private storage  →  Claude counts what it sees
                                                        ↓
       inventory_check_items  ←  grade()  ←  structured JSON observations
```

Two decisions are worth knowing about:

**Claude reads static images, not video.** The flow is deliberately capture-then-analyze:
the operator freezes one frame and that exact frame is analysed. The camera panel works
with a phone's rear camera or a head-worn camera; there is no continuous stream to keep in
sync.

**The model perceives; the code judges.** Claude returns only what it saw — a count, a
confidence, and whether the item was separable from its look-alikes — via a Zod-typed
structured output. `src/lib/verification/grade.ts` turns that into the green/amber/red
verdict. Keeping the rule in code means it is testable, explainable to a customer, and
changeable without re-prompting.

Because of that split, look-alike variants never get a confident wrong answer. Two
hairbrushes from the same line that differ only in size come back flagged for a barcode
scan, with the candidate SKUs named. Each product carries a `visual_notes` field that is
fed to the model precisely so it knows which items are easy to confuse.

Counts are never written back automatically — **Apply counts to stock** on a check is an
explicit human action, and it skips anything flagged for a barcode.




### Layout

```
src/
  app/
    [locale]/         public site: home, services, about, technology, pricing,
                      team, careers, news, contact (ka + en)
                      (/platform redirects to /technology)
    (app)/            signed-in shell: dashboard, products, locations, verify, checks, settings
    api/verify/       upload → analyze → persist, the one server route
    login/ onboarding/
  lib/
    i18n/             locales, the two dictionaries, shared page metadata
    pricing.ts        inventory service rates and the calculator's rule
    services.ts       the five service-line ids (contact form, anchors)
    supabase/         browser, server and proxy clients
    verification/     prompt, schema, analysis call, grading
  components/
    marketing/        header, footer, language switcher, mobile nav,
                      section (the three grounds), page shell, band-video,
                      contact form, grain, Rise/Reveal motion
  images/             photography (webp)
  app/fonts/          self-hosted body and display faces
public/
  video/              six warehouse cuts + the hero object, each with a poster
supabase/
  migrations/         schema, integrity, RLS, storage, RPCs, views, grants,
                      contact requests
  tests/              tenant isolation
```

## Deployment

The site is a stock Next.js app; Vercel builds it from the repository with no
special configuration. The repository is `katsitadzeggg-sys/Inverse-` and the
production branch is `main` — every push to it deploys.

Environment variables it expects, all optional for the public site and required
for the signed-in half:

| Variable                        | Used by                              |
| ------------------------------- | ------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | browser, server and proxy clients    |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the same                             |
| `SUPABASE_SERVICE_ROLE_KEY`     | the verify route, for Storage writes |
| `ANTHROPIC_API_KEY`             | the verification call                |

Without them the public site still renders: `isSupabaseConfigured()` gates the
proxy, `requireSession()` and the auth actions, so a deployment with no Supabase
project serves the marketing pages and sends the app routes to `/login` instead
of throwing.

**Current state.** Live at `https://inverse-site.vercel.app`, from the Vercel
project `inverse-site` in `katsitadzeggg-1422's projects`. No Supabase project
is attached yet, so the contact form falls back to the email address and the
app routes send to `/login`. The older `inverse-xi.vercel.app` deployment and
the `easyvibesuxui-sketch/inventarization` repository are superseded.

## Status against the project handoff

Done:

- The public site: nine pages in Georgian and English, with a contact form
- A clients section on the home page, nine named clients in both locales
- Five service lines: inventory as the core (stock and fixed assets, each with
  its process), then audit, accounting, valuation, consulting; a "how we work"
  block led by deadline control
- A service price calculator (`/pricing`): stock or fixed assets, quantity,
  sites, warehouse condition (1–10), frequency, tagging, off-hours, urgency —
  giving one rounded price, a yearly total and a duration, carried into the
  contact form. No AI comparison and no wage inputs, at Giorgi's request; his
  earlier savings model is in git history
- The contact form asks which service line; stored in `contact_requests.service`
  (`0011_contact_service.sql`)
- Multi-tenant schema and RLS policies, with an isolation test
- Verification app on real backend storage — private Supabase Storage bucket plus
  `inventory_checks` / `inventory_check_items`, no `localStorage`
- Dashboard: stock table, low-stock alerts, location filter, verification status

Deliberately unfinished:

- **Inventory rates are a proposal**, not signed off. Every figure lives in
  `src/lib/pricing.ts`; changing it there updates the calculator, the rates
  table and the home page together. Audit, accounting, valuation and
  consulting are quoted individually.
- **Platform (SaaS) plans were removed** from the site along with the method
  description. `companies` still reserves the Stripe columns for when the tool
  opens to clients.
- **Barcode reading** — the schema, the model contract and the UI all carry the
  `needs_barcode` flag, and products have a `barcode` column, but no scanner is wired up.
  Deciding the capture approach is still an open item.
- **Stripe** — `companies` reserves `stripe_customer_id` and `stripe_subscription_id`;
  no checkout, webhooks or plan enforcement yet.
- **Team invitations** — an owner or admin can see the team, but there is no invite flow.
- **The signed-in app has not had a design pass** on the current palette; its
  colour tokens were migrated mechanically so it stays coherent, and its
  corners now point at the same radius token as the site. The sign-in page is
  the exception — it is the bridge from the public site, so it borrows the
  site's vocabulary. The entrance to it sits in the site footer rather than the
  header: the platform is an internal tool in pilot, not a public product.
- **The English client names are transliterations** and want a check before
  launch — `Skutskuti` in particular, which may well be styled some other way in
  Latin. The three descriptive names are translated rather than transliterated.
- **No portrait cut of the hero object** exists; it is pinned to the landscape
  cut at both sizes, which the composition suits. The three warehouse clips do
  have both.
