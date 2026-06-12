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

## 2026-06-12 — Context fix (real bodies), date/time pickers, gutter polish, human event edits
**THE context fix:** outbound activities stored only "Sent: subject" → conversation bubbles looked
empty/subject-only AND the AI repeated itself (it never saw its own sent words). Now: push/poll
outbound stores the cleaned snippet of YOUR sent mail; scheduled sends log the FULL draft body;
aiEnrich proposal lines dedupe (same proposal max once/7d/entry). **Gig-date edits propagate:**
migration 019 `gig_date_dirty` — app sets it on ✓-save; worker mirrors that one human edit (PATCH) or
clears (DELETE event) then resets the flag; agent still never touches events unprompted. **Date/time
UX:** datetime-local replaced by date-picker + 30-min time select (9AM default) for BOTH custom
schedule and gig date (desktop typing pain gone). **Mobile gutter survives scroll** via .nav::before
painting --bg-page in the corner notches (z -1 inside nav's stacking context). Desktop Home columns
reordered per Nick: Needs-you | war room | at-a-glance, grid-auto-flow dense, independent flows.
Other: placeholder copy reworded ("drafts a message in your voice — try it out!"); profile inputs got
modeled placeholders; leaving Profile mid-edit CANCELS (cancelAllProfileEdits in go()); Spotify
"Missing" hint now hides when set + link values ellipsize (fv-ell) instead of wrapping; weekly-block
confirm label adapts (Confirm unblock / changes / blocks); human "Send now" shows a green "Sending
now…" card (not "Scheduled"); schedule chips centered (.sched-chips); "In pipeline ✓" chip hidden on
mobile cards. NOTE: collective feed/roster + Home-market setting remain the deliberate "coming soon"
placeholders (slice: collective features, post-roster-onboarding).

## 2026-06-11 — Big feedback round: threads, bubbles, blank canvas, toggles, rates, desktop fix
**Critical fix:** desktop nav was dead — `#screen-home{display:grid}` wasn't scoped to `.active` so
Home rendered over every screen; now `#screen-home.active`, and desktop is FULL-WIDTH (≥1100: app
max-width none, 3-zone Home = bookings rail | needs-you | stats rail, detail 2-col capped 1240).
**Mobile gutter = TOP ONLY** (sides full-bleed, "seamless immersion"). **Draft editor:** blank canvas
default + micro-tutorial placeholder; "Select a template…" dropdown (no auto-load); actions order
Send now · Copy · Draft with AI; schedule = nothing preselected, chips toggle off, Custom is a
full-row dashed "Choose a date & time…" button; AI intent falls back by stage. **Sends:** human=true
("Send now") bypasses auto-send gate AND reply-cancel (migration 018); worker now replies IN THREAD
(findThread → threadId + In-Reply-To + "Re:" subject; new thread only when none exists). **Calendar
events are CREATE-ONLY** (Nick's rule: agent creates, never edits; date changes post-sync are manual).
**Conversation = 2-way bubbles** (.convo: them left/blue rail, you right/amber rail, chronological,
AI summary bold + raw dim, system lines centered) — this is the AI's context surface. **Passed/Dead
are toggles** (lit button → tap again reopens via prev_status). **Discover ↔ pipeline:** "Add to
pipeline" button on venue detail (greys to "Added ✓"), "In pipeline ✓" chip on cards (needed venue_id
in the pipeline select). **Profile/Artist-RAG:** rate_soft + rate_hard fields (AI prompt quotes them
EXACTLY, forbidden to invent/underbid; rates-unset ⇒ defer on numbers); "Set formats" → "Lineup
options". **Weekly blocks stage + "Confirm weekly blocks"** before persisting. Calendar day with a
gig dot opens the gig (no accidental availability cycling). Long URLs wrap (overflow-wrap). NOTE:
the "busy 28th" confusion = Google-import marks busy, but Upcoming only lists entries with gig_date —
set the gig date on the booked venue.

## 2026-06-11 — Push notifications, draft persistence, gutter island returns, calendar v2
**Push (worker grew its first npm dep, web-push):** VAPID keypair self-manages in `app_secrets`
(service-role only, migration 017); `GET /push/pubkey`; `notify()` on new inbound reply / send fired /
send ready, pruning 404/410 subs; `app/sw.js` (push + notificationclick, served via server.js
`/sw.js` route — PWA finally has a service worker, push-only, no offline cache); Settings toggle
registers SW → permission → subscribe → `push_subscriptions` (RLS own). **Draft persistence bug
(Nick lost an AI draft):** any re-render rebuilt the textarea from the template — now `draftText[uuid]`
is the source of truth (oninput), survives re-renders, cleared on schedule; template TABS replaced by a
dropdown; actions = Draft with AI · Copy · **Send now** (replaces Open-in-email; mailto dead).
**rerenderOpenDetail guards active inputs** — realtime rebuilds were dismissing open date pickers
("kept exiting"). Gig date = explicit ✓ save + instant pokeWorker (`/poke` = processScheduled +
syncCalendar for that artist; replaces /scheduled/run). **Gutter island RESTORED on mobile** (Nick
missed it) + desktop now truly wide ≥1100 (app 1100px, detail 2-col via .detail-cols wrappers, 3-col
grid, capped forms). **Back is a stack** (`navStack` + goBack(); detail/venue back buttons say "Back"
and return wherever you came from — war room included; "war room cleared 🎸" toast on emptying).
**Calendar v2:** weekly blocks (availability_rules, dow chips — explicit day paint overrides), gig
dots on days, "Upcoming" agenda list (multi-gig days stack), availability in the realtime publication
(busy imports appear live). **Agent date policy:** the agent/worker NEVER writes gig_date (only mirrors
artist-set dates to Google + google_event_id/status); creation/edit of dates is the artist's alone.

## 2026-06-11 — Calendar⇄Google sync live + AI deal-context + send-now/custom + polish
**Slice D worker (`syncCalendar`, per poll):** imports busy days from the artist's PRIMARY calendar
(60d lookahead; only days the artist hasn't painted manually — manual wins); EXPORTS hold/booked
entries with `gig_date` (migration 016 + datetime input on detail for hold/booked/played) as primary-
calendar events — hold=tentative "HOLD: venue", booked=confirmed "Gig: venue", PATCHes the same
`google_event_id` on change; booked + date >6h past ⇒ auto **played** (+ "how did it go?" activity).
calendar.events scope already granted — no reconnect needed. **AI context fix (Nick: "intelligence
isn't just tone, it's context"):** /ai/draft now takes the active template tab as `intent`; prompt
leads with a stage/intent OBJECTIVE; mid-deal (talks/hold) = answer THEIR LAST MESSAGE, lock specifics,
NO credentials/self-promo (the upsell bug); full profile only on first touch. **Send controls:** chips
now Send now / Tomorrow 9am (DEFAULT — Nick: "it actually works for venue responses") / 3d / 7d /
Custom datetime; Send now inserts send_at=now and POKES `POST /scheduled/run` (authed) so it fires in
seconds. **Reverted** the mobile gutter-island (artifact of misread; island = bottom nav only, app is
full-bleed again). Desktop ≥1100px: Home becomes a 2-col war-room dashboard via `:has()`. Respond
button = scroll + amber glow, NO focus (keyboard was killing the experience). Viewport: maximum-scale=1
+ touch-action:manipulation (kills iOS input-zoom + double-tap zoom). War room scales: tier-sorted
(ready > replies > follow-ups, oldest first), capped at 8 + "+N more → Pipeline by priority" row.

## 2026-06-11 — Island NAV + war-room Home + calendar screen; badges/chips/dots killed
Nick's correction: "the island is the navigation, not the whole app" (YouVersion/Venmo/Slack refs).
Hamburger + dropdown REMOVED → **floating bottom island nav** (fixed blurred pill, safe-area aware):
Pipeline · Discover · **HOME center throne** (raised amber circle) · Calendar · Settings; top bar = brand
(tap=home) + avatar (profile). `.app` gets bottom padding. **Attention redesign — Nick hated the red
badge ("instantly stressed me out") and the blue dots ("useless")**: both removed; attention now lives
(1) at the TOP of Home — the war room: "Needs you" list (send-awaiting-review / "{contact} replied —
your move" / follow-up due) with AI-summary previews + count pill + quick actions + Scheduled-sends
queue; (2) as an unmissable bordered card at the TOP of pipeline detail with Respond/Review buttons
(jumpToDraft). needsReply is DATA-driven (lastInbound > lastOutbound — clears when the worker logs your
sent reply); localStorage seen-state machinery deleted. **Pipeline:** stage chips REMOVED (noisy) →
filter select beside search; defaults each visit = All + Recent (sort options Recent/Priority/Name);
priorityScore now tops ready-sends then needsReply. Notes: edit (inline input) + delete via migration
014 policies. **Calendar v1 (slice D start):** own nav item, month grid, tap-to-cycle availability
(available/busy/clear) persisted to `availability` (migration 015); Google sync = next.

## 2026-06-11 — Tone-learning + group-by + attention badges + island-everywhere + Gemini truncation fix
**Tone-learning (C complete):** worker `refreshToneProfile` daily per artist — pulls ~8 real SENT
emails from Gmail (extractPlainText walks MIME parts; cleanSnippet strips quoted tails), Gemini
distills a ≤160-word TONE CARD → `artists.tone_profile` (migration 013); /ai/draft injects it
("write indistinguishably in THIS voice"). Since the corpus is what Nick ACTUALLY sent — including
his edits to AI drafts — proposed-vs-sent learning is implicit. **Gemini truncation bug:** 2.5
models spend "thinking" tokens AGAINST maxOutputTokens → drafts cut mid-sentence at 1024; fix =
maxOutputTokens 4096 + `thinkingConfig:{thinkingBudget:0}` (gated on /2\.5/ model names).
**Island everywhere (Nick: "the island was supposed to be for the mobile PWA"):** body always
--bg-page; <600px the app floats in an 8px safe-area gutter (22px radius, border, shadow, nav
offsets + rounds); ≥600px keeps the centered column. **Pipeline org (2nd ux-agent consult):**
Group-by toggle OFF by default (Notion-style collapsible tinted stage sections, collapse persisted
per stage, search auto-expands, grid disabled while grouped) — chips/sort/flat priority list remain
the default. **Attention:** needsAttention = unseen inbound (localStorage gc_seen_<uuid> vs latest
email_in ts) OR followupDue OR sched 'ready'; red 9+-capped badge on the hamburger; blue unread
dots on rows; openDetail marks seen. Notes input restyled as inset pill (Nick's bounding note).

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