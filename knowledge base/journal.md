# Gig Collective — decision journal

## 2026-05-19 — Prototype established in single HTML file
Built the full prototype in gig-collective.html across multiple sessions in Cowork.
All screens functional: Home, Discover, Pipeline (CRM + outreach templates),
Add Venue wizard (4-step, ticket type cascade), Profile (editable merge tag fields,
live template preview). Single file is intentional — do not suggest splitting it
until Nick asks.

## 2026-05-19 — Hamburger menu chosen over tab nav
Earlier iteration had a congested three-column header. Nick rejected it explicitly.
Hamburger dropdown is the nav pattern. Do not reintroduce tabs or a persistent nav bar.

## 2026-05-19 — Templates pull from profile fields
Outreach templates are dynamic — they render from the artist's profile (name, genre,
phone, website, EPK, markets, draw claim). If profile fields are incomplete,
templates degrade. The profile screen shows a completeness bar and field-level
warnings for this reason.

## 2026-06-09 — Slice 1 shipped: real backend on Supabase (app/index.html)
Nick asked for the MVP live, with login via his booking email and (later) email-driven
pipeline updates. Built the live app as `app/index.html` (a copy of the prototype) so
`prototype/gig-collective.html` stays the pristine design reference. Wired it to Supabase
via the supabase-js CDN — still one file, no build system. Schema in `supabase/schema.sql`
mirrors the three-layer model (artists, venues, contacts, pipeline_entries, activities)
with RLS: private pipelines, shared venue/contact intelligence. The Add Venue wizard now
actually persists (venue → contact → pipeline entry + "Added to pipeline" activity);
notes, profile edits, markets, and a new Move-stage control all write to the DB. Mock seed
arrays were emptied so Nick sees his own (initially empty) data. Login = email magic-link
(works with zero Google Cloud setup); a "Continue with Google" button is wired but needs the
Google OAuth provider configured in Supabase first. Config (project URL + anon key) lives in
`app/config.js` (git-ignored) — the browser can't read .env. Decisions to preserve: don't
re-introduce mock seed data; keep config.js out of git; the service_role key must never enter
the client (it's reserved for the slice-2 inbox watcher).

## 2026-06-09 — Home feed, roster, and "Collective wins" stat are still mock
These are collective features (slice 3, pending roster onboarding). Left as static HTML in
app/index.html on purpose. Active-leads and Booked stats ARE wired to the real pipeline.
Don't mistake the static feed/roster for a bug.

## 2026-05-19 — No conflict model
Multiple artists can canvass the same venue simultaneously. This is a feature.
Do not build any conflict detection or locking around shared venues.