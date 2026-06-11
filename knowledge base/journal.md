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

## 2026-06-11 — Slice C v1 (Gemini) + locked drafts + desktop island + nav/pipeline polish
**Slice C:** worker gained `gemini()` (env GEMINI_API_KEY + GEMINI_MODEL, default gemini-2.5-flash —
override via env if Google renames; logs "Gemini: OFF" when keyless and all AI paths no-op gracefully).
(a) `aiEnrich` on each NEW inbound reply: one-line summary + intent → `activities.summary`/`ai_intent`
(migration 012); decline/date_offer add grey "AI: …" proposal lines — NEVER auto-move stages.
(b) `POST /ai/draft` on the worker: CORS-allowlisted to the app origins, auths the caller's supabase
access token via /auth/v1/user, loads entry+profile+venue+last-8 conversation server-side, Gemini writes
the email; app's "Draft with AI" button fills the textarea (key never touches the browser).
**Locked drafts (Nick's call):** once scheduled, the editor is REPLACED by a read-only "Scheduled
draft" card (lock header + exact outgoing body) with an explicit Edit-draft → Save flow writing back to
scheduled_messages.body. Conversation ≠ automation: detail order is now Contact → Notes → Draft →
Conversation. **Desktop island** per the ux-agent spec (persona from .claude/agents/ux.md, GitKB parts
N/A here): ≥600px non-standalone gets --bg-page outside a bordered/shadowed 480px island; phone/PWA
zero-diff. **Nav:** brand tap = Home; menu = Discover/Pipeline/Settings + filled "Add venue" button
(Home/Profile items removed — brand/avatar cover them). **Pipeline:** search now matches stage names +
notes + conversation text; sort select (Priority/Recent/Name); list⇄grid toggle persisted in
localStorage (gc_pipe_view); filter+search intentionally RESET to All/empty on every visit; stage chips
tinted with stage colors.

## 2026-06-11 — Slice B shipped (draft + schedule + intelligent disconnect) + UX round
**Slice B:** template box is now an editable textarea (the draft); "Schedule this draft" chips
(Tomorrow/3d/7d, 9am local) insert into `scheduled_messages` (migration 011, RLS own-rows, in the
realtime publication). Worker `processScheduled()` each tick: reply since scheduling ⇒ **canceled**
("They replied first" + system activity = the intelligent disconnect); `artists.allow_auto_send`
false ⇒ **ready** (detail view shows amber "Ready to send" card with Open-in-email / Mark sent);
true ⇒ **sent from the artist's Gmail** (`gmailSend` raw RFC822 + RFC2047 subject, email_message_id
saved so push-dedup doesn't double-log; lead→pitched). Send granularity = POLL_MINUTES (10 min).
**UX round from Nick's feedback:** pipeline GROUPING REJECTED → flat priority list per designer
sub-agent consult (priorityScore tiers: reply-waiting > follow-up overdue > pitched aging > fresh
reply > lead/hold > booked > played > exits; recommendation doc'd the no-kanban-on-mobile call);
always-visible search + scrollable stage-filter chips with counts; detail Activity split into
**Conversation** (both email directions as prominent cards, system lines grey) and **Notes**
(comments-style section with the input); close-out = two real outlined buttons (Mark passed /
Dead end), not whisper links; nav order now hamburger→avatar (avatar outermost).

## 2026-06-11 — Polish batch: hash routing, tappable tracker, grouped pipeline, activity direction
(1) **Hash routing**: every screen is a `#hash` (`#entry/<uuid>`, `#venue/<uuid>`, `#pipeline`…) —
refresh/back/deep-links work; deep routes retry after data load (pendingRoute). (2) **Tracker IS the
stage control** — tap a dot to move stage; the Move-chips card is gone, replaced by a quiet exit row
("Mark passed" / "Dead end"); chips return only in terminal states to move back. (3) **Pipeline screen**
(renamed from "My pipeline"): grouped by stage with colored headers + counts, no per-row badge, relative
time. (4) **Activity direction is explicit**: "{Contact} → you" cards / "You → {Contact}: subj" grey
lines; worker `cleanSnippet()` strips quoted thread tails from Gmail snippets; removed the stale
"email auto-tracking: coming soon" chip (it's live). (5) **Bug**: supabase-js queries are LAZY —
`update(...).eq(...)` with no `.then()` never fires. That's why avatars didn't persist (and
disconnect's flag write silently no-oped). Always chain `.then()`.

## 2026-06-11 — Comprehensive staging: Lead → Pitched → In talks → Hold → Booked → Played (+ Passed/Dead)
Replaced outreach/waiting/followup/won with a real booking lifecycle (migration 010 maps old→new and
swaps the check constraint; new default 'lead'). ONE spine for both ticket types — **Hold renders only on
hard-ticket entries** (entry knows its type via venues.ticket_type). Exits are distinct on purpose:
**Passed = recyclable no** (agent may circle back; an inbound reply auto-resurrects it to In talks) vs
**Dead end = terminal** (never auto-moved, never resurfaced). Principles: stages track THE DEAL, not the
work — follow-up is a slice-B scheduled action (followupDue() = pitched ≥7d is the interim heuristic);
promo will be a checklist on Booked, not a stage. Worker auto-transitions: outbound pitch ⇒ lead→pitched
(send from Gmail, card moves itself); reply ⇒ →talks; hold/booked/played/dead never auto-move. Slice D
hooks: Hold = tentative calendar event, Booked = confirmed, date passes ⇒ played. App keeps legacy
status keys until migration 010 runs, so deploy order doesn't matter.

## 2026-06-11 — Real-time Gmail PUSH live (Pub/Sub) + the partial-index gotcha
Replaced polling-as-primary with Gmail push: `users.watch` (worker re-arms when <2 days
to the ~7-day expiry) → Pub/Sub topic `projects/gig-collective/topics/gmail-push` → push
subscription → worker `POST /gmail/push?token=…` (the worker now also runs an HTTP server
on PORT; Railway gave it the domain `gig-worker-production.up.railway.app`) → history API →
process only new messages. Poll stays as a 10-min fallback. App uses Supabase **Realtime**
(websockets, migration 007) so the pipeline updates live on screen. Migrations 008 (watch
state) + 009 (see below). **GOTCHA that cost an hour:** the `activities` dedup index on
`email_message_id` was created PARTIAL (`where email_message_id is not null`), and **PostgREST
cannot use a partial index as an `on_conflict` target** → every worker insert failed with
`42P10 "no unique or exclusion constraint matching the ON CONFLICT specification"`, silently,
so replies never logged. Fix = migration 009: recreate the index NON-partial. If on_conflict
ever 42P10s again, that's the cause. Worker now logs insert failures + the push match result.

## 2026-06-11 — Slice A live: Google connect + worker reading Gmail end-to-end
Settings → "Gmail & Calendar → Connect" runs incremental Google OAuth (offline) and stores the
refresh token via the `store_google_token()` SECURITY DEFINER RPC (migrations 003/004; 005 = disconnect;
006 = send pref + avatar bucket). A SEPARATE Railway service **`gig-worker`** (service root = `worker/`,
deployed with `railway up worker --path-as-root --service gig-worker --ci`) polls every 10 min:
refreshes each artist's Google access token (needs GOOGLE_CLIENT_ID/SECRET), reads Gmail for pipeline
contacts' replies, logs activities + advances outreach→waiting, dedups via activities.email_message_id;
on token-refresh failure it drops the connection so the app re-prompts. Worker env (Railway dashboard,
not git): SUPABASE_URL, SUPABASE_SERVICE_KEY (service_role), GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
POLL_MINUTES. **Gotcha that ate ~an hour:** a trailing **comma** on the pasted service key → Supabase 401
"Invalid API key" (payload still decoded fine; `.trim()` doesn't strip commas). Worker logs key
role/ref/len for diagnosis. Only the read path is built; send (Slice B) is next.

## 2026-06-11 — Public landing + legal pages; app moved to /app
Added a public marketing landing at `/`, moved the app to `/app`, and added `/terms` + `/privacy`
(privacy carries the Google API **Limited Use** disclosure + the Gmail/Calendar/Gemini data flows).
`server.js` ROUTES map handles these; app asset refs made absolute (`/config.js`, `/logo.png`); auth
`redirectTo` and PWA `start_url`/`scope` now `/app`. Built for Google OAuth **brand** verification
(homepage is no longer the login screen). IMPORTANT: restricted Gmail scopes still need the **CASA**
security assessment for production — staying in **Testing** (≤100 test users) for now; do not assume the
pages alone unblock Gmail. Supabase redirect allowlist must include `https://gig.nicholasrains.com/**`
so `/app` login keeps working.

## 2026-06-10 — Slice 2 started: read-only inbox agent (apps-script/email-agent.gs)
Gmail watcher runs inside booking@'s Apps Script on a 10-min trigger. READ-ONLY on
the inbox; writes only to Supabase via the service_role key (Script Properties, never
client/git). Calls Claude via raw HTTP to the Messages API (UrlFetchApp) — Apps Script
has no Anthropic SDK, so raw HTTP is correct per the claude-api skill. Default model
claude-opus-4-8 (don't silently downgrade); Haiku 4.5 is the one-line cost swap.
Transition policy: auto outreach→waiting on a booker reply; Won/Dead are PROPOSED in
the activity note, not auto-applied (no review UI yet). Outbound emails logged as
email_out — the raw material for the future tone-learning / agentic-outreach slice.
Dedup via activities.email_message_id unique index + PostgREST ignore-duplicates.
Setup in apps-script/SETUP.md. v1 = Nick's inbox only.

## 2026-06-10 — Venue cards open a detail view, not edit
Tapping a Discover venue opens a read-only detail (openVenueDetail) with an embedded
Google Maps iframe (keyless ?output=embed) when an address exists, else a dashed
"map: coming soon" placeholder. Edit is behind a button (openVenueEdit); Save/Cancel
return to the detail view. Batch-2 also added editable venues + optional venue.address
(migration-002). Deferred: notable-venues-as-chips, profile picture.

## 2026-06-09 — Live: Railway + gig.nicholasrains.com, Google auth, Resend SMTP
Deployed `app/` to Railway (service `gig-tracker`) via CLI; custom domain
gig.nicholasrains.com (Cloudflare CNAME). Private repo TheNickRains/gig-tracker.
`server.js` generates `/config.js` from Railway env so keys stay out of git.
Enabled Google OAuth + email magic-link. **Switched supabase-js to `flowType:'implicit'`
— do not revert to PKCE**; PKCE lost its verifier on this static custom-domain SPA
("OAuth state not found or expired"). Custom SMTP via Resend (domain verified) replaced
Supabase's throttled built-in email — this is what unblocks roster onboarding. Added the
Nick Rains logo (nav/login/favicon; CSS-inverts in dark mode). Replaced the mock collective
feed + roster with labeled dashed placeholders — no fake names — matching the "build by using
it" approach; incomplete features get a dashed border + "coming soon" badge.

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