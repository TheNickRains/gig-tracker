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

## 2026-06-12 — Build phase closes; DOGFOOD phase begins
Nick: "the app is fantastic as it is now, lets put it through the ringer with my stack of cards and
contacts." **Tour planner (F) SHELVED by choice until he plans the New England tour** — the gig_pay/
gig_costs foundations stay in place for it. From here: real venue intake from the physical card stack,
real outreach, real replies. Treat incoming feedback as field reports, not feature requests — fix
friction fast, resist new surface area. Watch-fors during dogfooding: Google Testing-mode refresh
tokens expire ~7 days idle (Settings flips to "Connect" — just reconnect); Gemini FREE tier has daily
caps (upgrade the key's project to billed before the roster leans on AI drafting); push notifications
are per-device opt-in.

## 2026-06-12 — Morning-outreach incident: two intent bugs fixed, sends fired
Nick scheduled outreach past midnight expecting "tomorrow 9am" = the coming morning; code computed
+1 day = Saturday, AND the auto-send gate parked fired sends in 'ready'. FIXES: (1) the 9am chip now
schedules the NEXT 9am (before 9 → today; after → tomorrow) with a dynamic label "9am today/tomorrow";
(2) review gate REMOVED from processScheduled — every scheduled message is human intention and fires,
period; `allow_auto_send` is reserved for future AGENT-initiated mail (auto-replies). Intelligent
disconnect unchanged. Recovery: SQL resurrect (ready→scheduled, send_at=now) + worker restart boot-tick
→ five pitches fired (Luckenbach, Mañana, Wahoo's, Rock & Brews, MHG). Also: frosted mobile header made
genuinely translucent; mobile gutter gap 16px so the card floats clear of the OS bar; weekly-block day
chips one-row with clamp scaling.

## 2026-06-12 — Off-grid channels + SLICE G concept: the Booking Line
Phone-only contacts (Julie/Victory Lap) are first-class via HAND-FED logs into the same engine:
"You said…/They said…" quick-logs write email_out/in activities (bubbles, stage rules mirrored
app-side, needs-you, AI context all work); phone-only deals get "Text it" (sms: with the draft body,
schedule hidden — email-only); call icon taps AUTO-log a 'call' activity + arm the outcome log.
HARD LIMIT (answered for Nick): iOS exposes no SMS/call content to any app — true auto-capture
requires owning the number. **SLICE G — BOOKING LINE (roadmap):** Twilio number as the public booking
number (forwards to cell): SMS in/out + calls auto-log via webhook, scheduled texts, text-from-app,
SMS disconnect — full email parity. Adopt when card-stack outreach makes phone volume real.

## 2026-06-12 — THE PROMOTION SHIPPED: People × Rooms × Deals (migration 026)
Trigger fired early — Nick holds THREE talent buyers + a stack of rooms, and said the words: "I have
slept on this outreach for over a year… we need the full promotion for contacts." Built: `people`
(first-class: name/title/ORG/email/phone/socials; unique on lower(email) — same email anywhere = same
HUMAN) + `venue_people` join (person↔room, per-room role) + `pipeline_entries.person_id`. Backfill
dedupes contacts by email into people, builds room links, points deals at people; legacy contacts
table kept read-only for fallback. **Find-or-create everywhere:** wizard + deal Add-contact check email
first → "Recognized {name} — same person, new room ✓" (the magic moment); editing a person updates them
EVERYWHERE they book. **Person page** (#person/<id>): identity + org, social/email icons, "Books these
rooms" chips, "Your deals with them." Worker: matching via person+room links (legacy contacts still
answer); /ai/draft knows the person's ORG and OTHER ROOMS ("also books Empire Theatre") = buyer-aware
drafting. Venue cards read people first. Intake gained Org. RLS: people/venue_people = shared collective
graph (read/write all authed), same doctrine as venues/contacts.

## 2026-06-12 — ARCHITECTURE NORTH STAR: People × Rooms × Deals (migrate on trigger, not taste)
Nick spotted the model truth: the business is PEOPLE (buyers/GMs, who span rooms) × ROOMS (venue facts)
× DEALS (person+room+terms; soft/hard lives HERE as of migration 025). Session evolved the schema ~85%
of the way empirically (contact roles/socials/multi-per-venue/switchable; deal-level ticket type;
reply→live-deal matching). DECISION: intake stays venue-first (the 90% card-from-a-room case; even
person-first intake ends at a room — no deal without one). The contacts→people promotion (first-class
person, venue_contacts join) fires on a CONCRETE TRIGGER: the first actively-worked multi-room buyer —
not before. "Premature schema elegance is how 90%-working systems die at 90%." Built today from the
insight: Discover gained text search across rooms AND people (name/contact/city/added-by).

## 2026-06-12 — Talent buyers: today's playbook + the future person-model
In-house buyer = just a contact ROLE ("Talent buyer"). External multi-room buyer (promoter booking
several venues): TODAY add them as a contact on each room they book (deals correctly live per venue);
worker hardened so a colliding email matches the MOST RECENTLY ACTIVE deal (was arbitrary). Known limit:
one Gmail thread per buyer email — court one room at a time per buyer. DESIGNED, NOT BUILT (build when a
real multi-room buyer enters the pipeline): first-class `people` table (email/name/socials) +
`venue_contacts` join (person↔venue, role) + deals referencing person — one human, N rooms, replies
disambiguated by thread/recency. Don't bolt this on speculatively.

## 2026-06-12 — DESIGN IDENTITY LOCKED: "Ink on paper"
Nick: "That's it — ink on paper." The settled language after brown → violet → sage: warm paper
neutrals, ink (#2E2A24) as the only chrome authority, stage pastels as the sole color voices
(doctrine in design-system.md: chrome is ink, color is meaning). Header shares the page sheet
(bg-tertiary, no divider) — the mobile card reads as one continuous piece of paper. Avatar ring =
status light (grey rest / amber needs-you / ink on-profile). Do NOT re-introduce saturated chrome
accents; argue with the doctrine, not taste.

## 2026-06-12 — RETHEME II: PAPER & SAGE (the keeper). Violet rejected in 9 minutes
Nick on the violet: "no fucking violet is gross. it needs to feel like PAPER" + IDE screenshots (Solar
Light theme: cream paper surfaces, sage-green accent, ink text). Applied directly from the reference:
neutrals = warm paper (#fffdf7/#f5f2e9/#efebdf on a #ddd8c7 desk), ink text (#2a2722), accent =
sage/moss (--amber-* names now hold #EAF1E2/#7FA86F/#3D5F35/#2C4626), stage pastels re-tuned to
paper-muted family (manila pitched, faded-ink-blue talks, sage booked, eucalyptus played, brick dead,
heather hold), dark mode = warm charcoal "paper at night" (#232220 spine — zero violet), glass pill
dark text pale sage #BCD6A8, dots/toasts/banners harmonized. Violet purged (grep 0). LESSON for future
sessions: Nick's design north star is his IDE's Solar-Light paper aesthetic — cream, ink, sage; when
theming, match THAT reference, not abstract palette theory.

## 2026-06-12 — RETHEME: dusty violet pastels (designer-spec'd); brown dethroned
Nick: "colors seem horrendous… everything based around this brown… gross. I love pastels." Designer
consult delivered the direction: **"dusty violet pastels with a cool-lavender neutral spine"** — neutrals
lean the same cool direction as the accent so pastels read as a family, jewel-violet #4A2D7A is the new
primary. Applied as TOKEN VALUES ONLY — the --amber-* names stay (compat) but now hold violets; stage
pastels re-tuned (blush/periwinkle/mint family), legacy pairs mapped, dark mode re-grounded (#1c1a25
spine, glass pill text #C4A8FF), dotByKind + toast + won-banner hardcodes swapped (old ambers fully
purged — grep 0). Pattern KEPT per designer: pastel light fills + #2b2a26 ink in both themes (12:1+).
All AA floors audited. Also: Pipeline-health funnel moved to a full-width strip directly under the
greeting (mobile order: welcome → health → needs-you; desktop: cockpit banner above the panes); view
buttons got intentional focus rings (no default blue); group-by button icon fixed (ti-rows didn't
exist → blank mystery button).

## 2026-06-12 — Beta tester field reports: onboarding flow + real contact management
The first external tester immediately hit: (1) Profile unreachable without knowing the avatar is a
button → avatar now falls back to a person ICON when no name/photo (never invisible), and Settings
gained an explicit "Artist profile" row. (1.1) **First-run onboarding** (migration 022 artists.onboarded,
existing members backfilled true): full-screen welcome with 3 live-state steps — profile → first venue →
"enter the war room" — each tappable to the right surface, skippable, finishes by flagging onboarded.
(2) **Contact management from the deal** (the bunk icons): mail/phone icons are now real mailto:/tel:
links (hidden when empty); pencil opens an inline edit form (name/role/email/phone → contacts row,
shared intelligence); "Add contact" inserts a new contact at the venue AND makes it this deal's primary;
other venue contacts render as chips — tap to switch the deal's contact (pipeline_entries.contact_id).
fetchVenueContacts lazy-loads per detail open.

## 2026-06-12 — E polish: live social, wins backfill, glance toggle; calendar mystery closed
**#7 FINAL:** Nick's own screenshot shows the event ON booking@'s Google Calendar — the gap was Spark
(client) not showing/syncing that calendar. The mystery "booking page (30 mins)" was NOT us (we only
POST timed events titled Gig:/HOLD:) — it's Google Calendar's own appointment-schedule feature.
**Live collective:** app realtime now subscribes venue_comments + venue_wins → feed cache busts +
re-renders, open venue reloads its thread (Sam's comment appears live now). **Wins backfill:** on boot,
own booked/played entries upsert into venue_wins (idempotent) so historical bookings populate the wall.
**Home glance module:** Month ⇄ Upcoming toggle (gc_glance) instead of stacking both. Provenance note:
"Added by" is dynamic (created_by_name stamped at intake) — old venues predate the column and show
nothing; everything Nick added correctly shows him.

## 2026-06-12 — SLICE E WRAPPED: social comments, wins wall, financials, true cockpit panes
**#7 closed:** the "missing" calendar event was DELETED by design — a date-clear fired
"calendar: event removed (date cleared)"; setting the date again recreates it (htmlLink now logged).
**E social layer (migration 021):** comments get avatars (author_avatar denormalized), 👍/👎 reactions
(venue_comment_reactions, one per artist, tap-again clears), one-level replies (parent_id, inline
reply input, Esc cancels); "Added by {name}" provenance (venues.created_by_name, stamped at intake);
**wins wall** — venue_wins (RLS read-all/write-own) upserted from setStatus on booked/played, rendered
as an avatar strip "Gigged here:" on venue detail + 🏆 rows in the Home feed. **Financials (#8):**
pipeline_entries.gig_pay/gig_costs — Pay & Costs fields on the event view, mirrored into the Google
event description ("Pay: … / Costs: …") — tour-planner tracking foundations. **Home cockpit:** columns
are now TRUE PANES (.home-cols grid → .home-col max-height calc(100vh-190px) overflow-y:auto) —
independently scrollable, content can't push the other column (mobile = natural stack, needs-you
first). **Bubbles:** footers removed (meat only; sender/time live in the title tooltip). Discover
cards: long names pad past the corner icons, badges wrap (overlap fixed). Settings copy bug fixed
(literal \u2019). **Markets vs Home market:** NOT redundant — profile markets = WHERE YOU PLAY
(plural, feeds templates/tour routing); home_market = WHERE YOU'RE BASED (single anchor for routing
+ AI's sense of place).

## 2026-06-12 — SLICE E BEGINS (Collective) + event view + 2-col cockpit + island fade
**Slice E v1 (migration 020):** venue_comments (RLS: read=all authed, write own; author_name
denormalized — artists rows are private) + venues.created_by (default auth.uid()) + artists.home_market.
**Built:** "Collective intel" on every Discover venue detail — comment thread (post on Enter, delete own)
with a Gemini **pulse card** pinned on top ("The collective says…", worker POST /ai/venue-pulse, ≥2
comments, cached client-side); LIVE collective feed on Home (latest comments + new venues, replaces the
dashed placeholder); **blue "new from the collective" dots** on Discover cards (created_by ≠ me,
created_at > gc_disc_seen, marked seen 4s into a visit); **Home market** setting (Settings inline input
→ artists.home_market, injected into the AI draft prompt). **Event view (#8):** dedicated
`#event/<uuid>` screen — date/start-time fields, Hold(tentative)/Booked(confirmed) chips, contact,
"open the deal →", Save (gig_date+dirty+stage) + Remove date; Upcoming rows + gig-day taps open IT now
(not pipeline detail); two-way with Google via dirty-flag poke. **Desktop Home = 2 columns** per Nick
(left: Pipeline health, Scheduled sends, Collective activity · right: Needs you, actions, month at a
glance, Upcoming; stat cards hidden on desktop — funnel covers them). **bnav-fade:** fixed gradient
gaussian blur under the island nav (backdrop-filter + mask-image). #7 debug: worker now logs event
start + htmlLink on create/update to pinpoint which calendar the event landed on.

## 2026-06-12 — Cockpit v1, bubble ink fix, You've Got Mail, vision: Collective + Tour (Slice E/F)
**Bubble bug:** pastel bubble bgs have no dark-mode variants, so dark-mode's near-white text was
invisible — bubbles now use fixed dark ink (#2b2a26). Conversation order back to NEWEST-FIRST (it's an
activity column). **Gutter:** reverted the .nav::before corner paint (broke light-mode top); micro-notch
on scroll accepted for now. **Cockpit v1 (Home):** "Pipeline health" module — proportional stage-funnel
bar + clickable legend (jumps to filtered Pipeline) + weekly momentum (sent/replies 7d, booked); desktop
3-col cockpit. **Time UX:** custom 34-option selects replaced by native type=time step 900 (mobile wheel
+ desktop segmented). **Events confirmed working** (logs: created + artist-edit PATCH); app now guards
"already on your calendar for X"; worker stops re-importing its own "(Gig Collective)" events as busy.
Copy: "You've got mail — {name} replied" everywhere (cards, war room, push). Discover cards: corner
check icon instead of chip. Mobile keyboard: island nav hides while typing (visualViewport).
**VISION captured from Nick:** roster = invited killer working artists (trust network) → Collective
slice = venue comments w/ AI summary, new-from-collective dots, shared feed, warm intros into new
markets. THE END GAME: **Tour planner** — route gigs across markets, distance & fuel cost estimates
(artist's mpg), routing map, fill-the-gaps date proposals. That's Slice F after Collective (E).

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
## 2026-06-12 — Unrecognized-mail triage + agent framework charter
Form-gated outreach (Sam's Burger Joint) exposed the gap: replies from unknown senders never reached the tracker. Migration 030 `unmatched_mail`; worker parks unmatched inbound on push + backfills 2 days of inbox on poll; Home "Unrecognized mail" section offers Add-to-deal (ingests as email_in, find-or-creates the person, links venue_people, stage→talks — future mail from that sender auto-matches) or Dismiss. Same day: `agent-framework.md` became the canonical AI context spec after a draft proposed "late May" in mid-June — every prompt now leads with TODAY + an explicit channel contract. Also: rooms-in-play chips are the single room control (★ promote replaced the separate move-room search), and embeds needed `venues!pipeline_entries_venue_id_fkey` disambiguation after deal_venues created a second relationship path (the "data gone since m29" scare — data was fine, PostgREST refused to guess).
## 2026-07-07 — Follow-up nags are snoozable, not dismissable
The "Needs you" list had piled up 42 follow-up-due rows with no way to act on them short of sending mail. Added a Snooze button using the existing marker-activity pattern (`✓ Follow-up snoozed`, kind:system): `followupDue()` now measures quiet from max(last activity, snooze), so the nag returns after another 7 quiet days rather than disappearing forever — permanent silence stays the job of Dead/Passed. Deliberately NOT a dismiss: follow-up pressure is the product's core value; a snooze respects "not now" without letting a live pitch rot invisibly. Pipeline's overdue chip and priorityScore honor the snooze automatically since both call followupDue().
## 2026-07-07 — Permanent dismiss + bulk select on Needs You
Nick wanted snooze AND a true permanent dismiss, plus a way to clear many at once. Follow-up rows now carry both buttons: Snooze (7d clock restart) and Dismiss (`✓ Follow-up dismissed` marker — off for good, UNLESS a new outbound goes out, which re-arms the nags; mirrors how re-sending clears a bounce). Select mode (button in the section label) uncaps the list from 8 to all items, turns rows into checkbox toggles, and bulk-dismisses via one batch activities insert using each row's per-type marker. All dismissal state stays in marker activities — no schema change, no localStorage.
## 2026-07-07 — Gmail drafts ingested as phantom sent mail
Nick's conversation view showed the same pitch 4× in progressively longer variants — Gmail draft AUTOSAVES. Search and history both return drafts, and every autosave is its own message id, so email_message_id dedup can't catch them. Fix: isRealMail() guard (skips DRAFT/SPAM/TRASH labels) at all three ingest points (applyMessage, ingestContactHistory, recordUnmatched), plus a purge pass in ingestContactHistory — Gmail deletes an autosave's id when the draft changes/sends, so a 404 on the logged message id proves the row was phantom; re-running "pull full thread" on an affected deal cleans it. Purge only touches source=email_sync email_in/email_out rows — manual notes and system markers are never deleted.
## 2026-07-07 — Feed dismissal + designer pass on the dismissal UI
Collective activity rows got a quiet × — localStorage-only (gc_feed_dismissed), because the feed is SHARED roster data: dismiss means "stop showing me", never a delete. A designer-agent crit of the snooze/dismiss UI then drove real changes: (1) follow-up rows dropped the second per-row button — two text buttons left ~13 chars of title on a 375px screen; permanent dismiss now lives ONLY in select mode (same '✓ Follow-up dismissed' marker via bulkDismissWar, dismissFollowup() deleted as dead code). (2) Selected checkboxes were var(--amber-800) — ~1.05:1 contrast on dark cards, functionally invisible; now --text-primary + row bg highlight. Amber-800 as a lone icon color on dark bg is a repeating trap. (3) .war-x converged on .vchip metrics + ::after hit-area extender (was a 23px tap target on a destructive action). (4) Select-mode action bar is sticky — the uncapped list is long and the commit button must survive the scroll. (5) Non-dismissable rows: opacity .55 + visible "review" micro-label, not a title tooltip (iOS never shows those).
## 2026-07-07 — Duplicate-id bugs, dark-mode amber trap paid off, dynamic filters
Two "empty square" reports were three bugs. (1) Duplicate id="pipe-filter" (Discover's in/not-in select vs Pipeline's stage select): getElementById hit Discover's first, so Pipeline's filter rendered EMPTY and Discover's options got clobbered with stage options — Discover's renamed to disc-pipe-filter. Same scan found id="ev-pay" duplicated between the deal gig-money editor and the venue-edit form — cross-contamination risk on save; venue form renamed to ev-payrange. Screens persist as hidden divs, so ids must be globally unique. (2) The amber-800 trap the designer flagged bit for real: Home's active glance toggle icon was invisible in dark mode. Glance toggles now use .view-btn.on (amber-50 bg survives dark); all other lone-foreground amber-800 inline uses swapped to --text-primary (visually identical in light: #2E2A24 vs #2a2722). NEVER use --amber-800 as a lone icon/text color on transparent/dark bg. (3) Discover's state dropdown was hardcoded TX/TN/CA/CO while cities were data-derived — states now build from live venues (renderStateFilter + STATE_NAMES map). Bonus: Pipeline gained a location filter (#pipe-loc, "City, ST · count" from live deals, persisted gc_pipe_loc).
## 2026-07-07 — Pipeline location filter went hierarchical
Nick liked the location dropdown but wanted state-first. Kept it ONE select (the filter row is tight): optgroup per state, "All Tennessee · N" first, then cities with counts. Values are prefixed (st:TN / ci:Memphis|TN) so whole-state and single-city filtering coexist; legacy "City, ST" persisted values self-clear. Native optgroups work on iOS pickers — no custom dropdown needed.
## 2026-07-07 — Location filter redesigned after UX + designer consult ("doesn't scale")
Nick rejected the flat optgroup tree (correctly: 40+ picker rows worst case, and iOS flattens optgroups to faint gray headers). Two parallel crits converged on: ONE control whose list is always small. Shipped the synthesis — a .loc-chip (native select stretched invisible over a chip face, so the closed label is ours: "📍 Memphis" in amber when active, icon-only when not) whose options DRILL DOWN: level 0 = Your markets (from profile markets/home_market, the frequent "what's cooking at home" case) + states with counts; picking a state re-scopes to its cities; "← Anywhere" is back+clear; single-state pipelines skip the hierarchy. Cost is O(states) or O(cities-in-state), never O(everything). Persistence KEPT (code comment at go('pipeline') is authoritative: "the FILTER persists across views and visits" — ux.md had drifted); the sticky-hidden-filter danger is answered by the amber chip being unmissable. Search blob gained full state names ("tennessee" now matches) as the long-tail escape hatch. Rejected: second cascading select (no row space, frequent case becomes 2 taps), chips row (rejected pattern), bottom sheet (overkill, hides active state). When the Slice F tour planner lands, "route me through Texas" moves there.
## 2026-07-07 — Faceted counts + dirty-city normalization
Nick caught the stage dropdown showing "All · 62" while scoped to Tennessee: stage counts now compute from pipeline.filter(pipeLocMatch) — location is the SCOPE, stage is the lens within it (asymmetric on purpose: location options stay stable from the full pipeline so navigation doesn't shift under you). renderPipeLocSelect runs before renderPipeFilterSelect so a stale location self-clears before counts; a stage with zero deals in scope self-clears to All. Also: "Austin" and "Austin," were two filter rows — venue city data arrives dirty; normCity()/normSt() strip trailing commas/whitespace and the SAME normalizer builds options and matches deals, so dirty data merges instead of forking.
## 2026-07-07 — Discover adopted the Pipeline location chip
One location UX everywhere: the drill-down loc-chip was extracted into renderLocScope(id, rows, cur) / locMatch(loc, city, state), and Discover's state→city cascading selects (renderStateFilter/filterCities + the cities{} global) were deleted in favor of it — 4 filter controls became 3. Same values (st:/ci:), same markets-first level 0, same caret/self-clear behavior; Discover persists as gc_disc_loc. If a third screen ever needs location scoping, use renderLocScope — don't grow a new pattern.
## 2026-07-07 — One filter grammar for Pipeline and Discover
The two screens had the same controls in two arrangements (Pipeline: inline with search, compact selects, chip last; Discover: separate bordered filter-row, chip first). Converged on one grammar everywhere: title row = screen tools · search row = [search flex:1][lens selects][place chip anchored last], all .pipe-sort/.loc-chip styling. Discover's .filter-row CSS deleted. The trailing pin position is deliberate — the place chip is the visual anchor of the row on both screens, so the eye learns ONE layout.
## 2026-07-29 — Links in drafts + the realtime socket learned to survive sleep
Two fixes. (1) Drafts speak ONE markdown-ism: [text](url). Link button in both draft editors opens an inline URL bar (no window.prompt — dialogs are hostile on mobile) and wraps the captured selection; the worker's gmailSend now ALWAYS builds multipart/alternative, rendering the markdown as real <a> tags in the HTML part (bare URLs linkified too, trailing punctuation excluded) and degrading to "text (url)" in the plain part — as do all plain-text exits in the app (Copy/Text it/mailto). The AI email prompt allows the syntax for the listen/EPK link; SMS drafts stay bare-URL. Do NOT add more markdown — one construct, on purpose. (2) Nick had to hard-refresh (or kill the PWA) to see inbound mail: the realtime channel was subscribed ONCE with a rtSubscribed latch, no status callback, and setAuth ran once at login — phones kill the socket on lock, Supabase drops it when the hour-old JWT expires, and missed events are NEVER replayed. Now: subscribe() status callback retries with backoff, visibilitychange/online handlers reauth (getSession → realtime.setAuth) + resubscribe if the channel isn't 'joined' + refetch (pipeline/unmatched/avail/feed) after any gap >5s, and onAuthStateChange re-arms realtime auth on every token refresh. Recovery is always resubscribe AND refetch — reconnecting alone loses whatever happened while asleep. Worker changes need a manual Railway redeploy.
## 2026-07-29 — Editable email subjects
Subjects were hardcoded to defaultSubject() ("{artist} — booking inquiry"). Now the draft composer shows a Subject input (email contacts only) pre-filled with the default; it lives in draftSubject[uuid] with the same lifecycle as draftText (survives re-renders, cleared once scheduled), and draftSubjectFor() falls back to the default when blank — so an emptied field never sends an empty subject. The locked scheduled card shows the subject; Edit draft can change it (saveSchedEdit updates subject + body). No worker change: gmailSend already prefers the thread's "Re: …" subject on replies, so custom subjects apply to NEW threads only — that's deliberate, don't "fix" it or replies will break Gmail threading.
## 2026-08-19 — Desktop jitter: the realtime retry loop was feeding itself
Nick saw persistent ~2–4s jitter on desktop, "like the page kept reloading" — DevTools showed endless pipeline_entries refetches. Two stacked causes. (1) venue_wins (migration-021) was never added to the supabase_realtime publication; a channel with one unpublished binding fails ENTIRELY, so pipeline-rt could never subscribe → retry loop → refetchAll forever. Fixed in migration-031 (already run manually). (2) The deeper one, still looping after the SQL fix: each retry's subscribeRealtime() called sb.removeChannel(rtChannel) BEFORE reassigning rtChannel, and teardown fires the old channel's CLOSED callback synchronously — while ch === rtChannel — so the guard passed, CLOSED looked like a real failure, and scheduleRtRetry re-armed. SUBSCRIBED resets backoff to 2s, so one transient socket drop (sleep/bfcache) started a self-sustaining 2s teardown→retry→teardown loop of healthy channels. Fix: subscribeRealtime nulls rtChannel before removeChannel (old CLOSED now fails the guard), and scheduleRtRetry no-ops if rtChannel.state === 'joined' (don't tear down a recovered channel). Diagnosis trick that cracked it: monkey-patch loadPipeline to log new Error().stack — every call traced to refetchAll, while per-table probe channels all showed SUBSCRIBED. Don't reorder the rtChannel-null-before-remove sequence; it IS the fix.
## 2026-08-21 — Venue detail/edit field parity on Discover
Nick: "no way to edit notes on discovery... whatever fields are available should be in parity with edit." Two gaps behind it: (1) the venue detail HID empty fields entirely — a venue without notes showed the word "Notes" nowhere, so the field looked nonexistent (the old "No details yet" hint only appeared when EVERY field was empty); (2) the edit form was missing Booking form URL — the wizard collects it and the detail displays it, but once set it could never be changed. Now: every venue field renders a row on the detail, empty ones as a tappable "Add ✎" that opens Edit; ev-form added to openVenueEdit/saveVenue; saveVenue also lost its if(addr) guard so blanking a field (address included) now clears it. Booking contact stays show-only-when-set — contacts are people/venue_people entities edited from deals (startContactEdit), and an "Add" row would dead-end in a form with no contact field. If contact editing from the venue screen is ever wanted, it's an entity operation, not a form field. Parity rule going forward: whatever the detail displays, Edit can change.
## 2026-08-21 — Venue phone + website became real columns (migration 032)
The wizard's Maps autofill had nowhere to put a venue's phone/website, so wizSubmit appended a "Phone: … · Site: …" line to notes — Nick flagged it ("those get pulled from google"). Now venues.phone/venues.website are columns: wizard step 2 grew visible Venue phone/Website inputs that pickVenueResult fills (autofill is now correctable instead of an invisible stash — wizData.mapsPhone/mapsWebsite are gone), the deal-side quick-create (cnrCreate) captures them from its Places match, the venue detail shows Phone as a tel: link and Website as a live link (empty → Add row), and the edit form covers both. Migration 032 adds the columns AND backfills from the old notes lines, then strips those lines from notes — venue notes are for human intel only, never a dumping ground for structured data.

## 2026-08-22 — Entitlements platform spec written (spec-entitlements-platform.md)
Promoted the ad-hoc primitives from spec-scheduled-sends-cap.md into the foundation spec all gates reuse: effective_plan() collapses plan + plan_expires_at (14-day trial = column defaults, no cron), limit_* functions read app_config (marked stable, not immutable — they read a table), and my_entitlements() is the single boot RPC the client caches as ENT. One shared showGate(code, context) modal driven by a GATE_COPY table, one handleGate() error mapper for both PostgREST and worker shapes, and six canonical gate_events names (gate_hit/upgrade_click/dismiss/swap/ghost_seen/unlock_earned) — the sends-cap spec's cap_* names are superseded. Stripe is a defined seam (stripe_customers + worker webhook flipping artists.plan), not built; beta ops are hand-flips via the cookbook in §7. Future gate specs should ship only: a limit fn + app_config row, one enforcement (trigger/RLS/worker per §2), GATE_COPY rows, and their surfaces.
## 2026-08-22 — Full tier strategy + per-gate spec suite
Scoped the commercial product's monetization end to end: product-tiers.md is the capstone (hook = zero-entry Gmail CRM, retention = follow-up engine, moat = venue graph; CapCut gating philosophy — cap verbs not nouns, free = complete ledger, Pro = the assistant, gates render in-place with the user's own data). Six specs: entitlements-platform (the substrate: effective_plan()/app_config/showGate/gate_events — every future gate ships only a limit fn, one enforcement, copy rows, surfaces), scheduled-sends-cap (1 recycling slot, the proving ground), ai-drafts (3/mo generic voice + "rewrite in your voice — Pro" envy gate), auto-followups (Pro-only engine, max-2 ghost rows), notifications (daily digest vs instant push, tease-in-digest with hours_late), collective-intel (hybrid earn-per-venue or Pro-everywhere; contribution never paywalled; ships LAST pending seeded intel). Build order: fork → platform+sends → drafts → notifications → follow-ups → intel, with Google CASA started in parallel. Cap numbers live in app_config — experiments, not debates. All product-fork only; Nick's instance stays free/untouched (his rule #1).
## 2026-08-22 — CASA deferred: send-only Gmail launch strategy
Nick can't fund CASA pre-revenue. Key unlock: gmail.send is a "sensitive" scope (free verification, no CASA) — only the READING scopes (readonly/modify, the auto-tracking hook) are "restricted" and need the ~$500–1k assessment. Product launches Stage 1 send-only: drafts/scheduled sends/auto-follow-ups all work from the artist's real address; inbound degrades to forward-to-assistant (per-artist ingest via Cloudflare Email Routing → worker), auto-BCC threading, and manual logging. CASA is the Stage 2 purchase once MRR exists (~50 Pro-months), and Gmail backfill becomes the upgrade event. Gotcha recorded: Google "testing" status = 7-day refresh-token expiry, so do sensitive-scope verification early or beta users reconnect weekly. This trades away the day-one demo magic (self-assembling pipeline) for a fundable launch — deliberate.
## 2026-08-22 — Stage-1 audit: three specs leaked Stage 2 assumptions; Founding Annual funds CASA
Audited the gate suite against the send-only launch: sends cap, collective intel, and the platform are unaffected; AI drafts' voice gate leaked (tone profile samples SENT mail = read scope — Stage 1 builds the tone card from product-sent mail + paste-in onboarding); auto-follow-ups can't verify no-reply, so Stage 1 defaults engine drafts to review-to-fire with a "forward their reply first" nudge; the notifications instant-push gate moved wholesale to Stage 2 (its sell IS reply detection — free digest survives as retention). Build order now ends ...follow-ups → intel, notifications post-CASA. Tier answer locked: TWO tiers (Free/Pro, team reserved undesigned) + the Founding Member annual as a billing offer, not a tier — ~$99/yr prepaid, life-locked price, founder badge; ten of them fund CASA (~$600–1k) outright. Specs need a Stage-1/Stage-2 pass when the fork build starts — the per-gate specs still describe Stage 2 behavior.
## 2026-08-22 — The collective is gated by standing, not money (two-axes model)
Nick pushed on gating collective access itself. Decision: two orthogonal axes — payment (Free/Pro) buys the ASSISTANT; the COLLECTIVE is gated by STANDING (invited by a member or earned by contribution), never purchasable, because a paid door lets venue owners buy into the room where artists compare pay notes. Three access layers: directory (open, acquisition/SEO), community (membership — this replaces most of the strangers/vandalism permissions rework: nobody writes until vouched), intelligence (money layer, unchanged per spec-collective-intel). "The {metro} collective is invite-only" becomes the launch pitch; founding members hold invites. Accepted cost: throttled top-of-funnel by design — the CRM stays open to anyone as the ungated on-ramp. Open decision #3 reframed to "membership mechanics" (invite flow/vouching/quotas — needs a spec before strangers arrive).
## 2026-08-22 — Referral flywheel guardrails (the "so MLM?" test)
The collective's invite system is a trust flywheel (moat and growth are one wheel: data is the mass, invites are the push; metro-by-metro ignition, K-factor per city, not Dropbox-viral). Nick stress-tested it: "so MLM?" Guardrails locked so it never drifts that way: rewards are single-level ONLY (no downline, no override), denominated in product currency (venue unlocks / Pro-time, never cash or revenue share), triggered by the invitee's CONTRIBUTION not their payment, capped (~a handful/year — seasoning, not income), and membership itself is never purchasable so there's no buy-in to recruit toward. Copy rule: invites are VOUCHING (spending reputation), never EARNING. Cross-metro invites are the natural growth vector (touring makes strangers complementary; in-metro competition is the loop's friction). Vouching chains double as the moderation system. All of this goes in the membership-mechanics spec when written.
## 2026-08-22 — Collective intelligence reframed: ambient contribution, membership benefit, never sold
Nick rejected the transactional framing ("I don't think it's about intel or credit... it's about people doing the work contributing, and not having to ask friends for leads"). The reframe: Waze, not Glassdoor. Contribution is AMBIENT — members doing their own booking in the tool feed the commons automatically (real pay from logged gig_pay, response rates/time-to-reply from activity timestamps, pitch→booked conversion, wins, liveness). Comments are garnish. The whole token economy from earlier today dissolved: no unlocks, no credits, no 120-char quality bars, no earn-per-venue — standing = live pipeline activity. Intelligence became a MEMBERSHIP benefit (never sold); monetization now lives entirely on the assistant axis. spec-collective-intel's monetization mechanic is superseded (its enforcement machinery — RLS, security-definer RPCs, never-reaches-DOM — survives for the membership boundary); folds into the future membership-mechanics spec. New hard problem: privacy by aggregation, enforced in schema — pay ranges only at n≥3 members, minimum samples for rates, nothing individually attributable (a member's negotiated rate must never be visible to the competitor for their Tuesday slot). Pitch line captured: "Stop asking around. Just know."
## 2026-08-22 — Correction: no commons. The collective is GROUPS people form themselves
I (Claude) misread Nick twice today — first as a token economy, then as an ambient-data commons. His actual model, stated plainly: the adoption fear is reputational ("someone will ruin their reputation" — one leaked candid comment about a venue can cost a musician a room), and no vouching/moderation system fixes that in a commons of strangers. The structural answer: THERE IS NO COMMONS. The social unit is a self-formed private group — your actual trusted circle. Solo users get a complete self-booking tracker; groups pool knowledge about ROOMS (shared venue book, intel, wins) while pipelines/deals/rates stay private unless a specific deal is explicitly shared. Multiple groups per artist. Dead machinery: metro commons, vouching chains, standing axis, invite flywheel, aggregation-threshold privacy layer (the group IS the privacy boundary), spec-collective-intel wholesale. Growth = "start a group with your crew." Groups are free; monetization stays entirely on the assistant. Fork schema must be group-scoped from day one (group_id on venue/intel tables). Nick's current instance is, in product terms, the first group. Lesson recorded: when Nick corrects a framing, restate HIS words before building on them.
## 2026-08-23 — Positioning locked: vertical booking CRM; collaboration structural; teams = managed workspaces
Three clarifications with Nick. (1) Category: it IS an outreach tracker + CRM — vertical CRM for gig booking with an outreach assistant; groups are the differentiator, not the category; pitch order "stop booking out of your inbox" then "your crew's shared venue book." (2) Collaboration inside groups is incentivized structurally, never scored: contribution as byproduct (own-pipeline work auto-feeds the group book), instant selfish payoff (add a venue → see crewmate's history with it — design for this in week one), visible-but-uncounted reciprocity (feed/wins/weekly digest; NO leaderboards or contribution scores). Group failure mode is dormancy, not free-riding. (3) Labels/teams: yes — the reserved 'team' tier's buyer is an agent/manager/label running a roster; managed workspace (per-artist pipelines, roles, send-on-behalf, roster reports) ≠ peer group; whale seat priced per artist; build only when a real one asks — schema stays ready (team ≈ group where one member holds keys to others' pipelines; roles+RLS, not rearchitecture).
## 2026-08-23 — Instagram as an assisted channel + venue detail quick-edit
Two ships. (1) IG DM outreach, assisted-only BY DESIGN: Meta's API cannot initiate DMs (reply-within-24h only), so automation is impossible/ban-bait — the flow is: "DM it" button (contact has IG handle) → empty draft box writes a <500-char casual DM via worker channel:'dm' prompt (no greeting/sign-off, bare URLs, explicitly anti-bot-smell) → filled box copies to clipboard + opens ig.me/m/{handle} + pre-arms quick-log on the new 📸 channel. Worker's textish regex now counts 📸, so DM-logged threads draft as casual not email. WORKER NEEDS MANUAL RAILWAY REDEPLOY for the channel prompt. (2) Venue detail (Discover): every field row is now a quick edit in place (VFIELDS/vrow/vEditField — tap row → inline input, ↵ saves, ⌘↵ for notes textarea, Esc cancels, blank clears) instead of bouncing through the full Edit form; identity fields (name/city/state/types) stay in Edit. notesBlock_ deleted (absorbed into vrow). Don't re-add a second editing path for detail fields — one field at a time, in place, is the pattern.
## 2026-08-23 — Plain-language ticket types (baby-proofing pass #1) + AI draft findings
Nick, prepping for launch: "most artists don't know the difference between hard and soft ticket." Swept the jargon: wizard step 1 now asks "How does this room usually pay?" with "They pay you a rate" vs "You sell tickets" (jargon taught in the descriptions, not assumed); Discover filter, venue badge, edit selects, cnr quick-create, and the deal-flip toast all read "Flat rate (soft)" / "Ticketed (hard)" — plain words first, jargon in parentheses as education. DB values stay 'soft'/'hard'. Also investigated his AI-draft complaints (code facts, not changes yet): the tone card is ONE blanket card per artist (max 180 words, refreshed daily from up to 8 sent emails — ANY sent mail from 90d, not booking-specific — plus up to 5 AI-vs-sent edit pairs, which only accrue via the scheduled-send path); there is NO per-venue-type segmentation, so "is it adapting per buyer type" = no, by construction. Follow-ups feel good because their objective derives from conversation evidence; cold drafts lean on profile boilerplate. Rework direction discussed with Nick (buyer-type playbooks replacing templates, booking-email-only tone samples, per-type calibration) — not yet built.
## 2026-08-23 — Education over obfuscation + the artist tone matrix
Three directives from Nick. (1) EDUCATION OVER OBFUSCATION is now a standing principle: keep industry terms, teach them in place — new reusable .info-tip component (little "i", hover/tap, CSS-only via data-tip attr) debuts on wizard step 1 explaining soft/hard ticket economics. Use it anywhere jargon appears; don't strip vocabulary. (2) ARTIST TONE MATRIX (migration 033, artists.tone_matrix jsonb, worker-written): refreshToneProfile now samples EVERYTHING the artist sends from the deal activity log (real booking mail — gmail in:sent is only a bootstrap fallback for new accounts; hand-logged emoji one-liners excluded), categorizes each outbound by intent (cold: first-ever outbound in deal / reply: previous message was theirs / followup: silence) × room class (bar/restaurant/winery/listening/festival via roomClass()), keeps the ONE base voice card (voice is constant), and distills per-cell CALIBRATION notes (≤50 words, deltas from base, one JSON gemini call) only for cells with ≥3 samples. /ai/draft injects the matching cell as CONTEXT CALIBRATION on top of the tone card. Edit pairs stay in the base-card loop (still scheduled-send-path only — extending pair capture to manual sends is future work). (3) Artist profile / static templates: NOT yet reworked — Nick finds some profile fields "profoundly useless," direction is an AI-referenced artist intake at onboarding + replacing static templates with buyer-type playbooks; needs his list of useless fields. Audit fact: markets is fetched by /ai/draft but never used in the prompt; only first-touch drafts use the full profile (draw/crowd/formats/notable), replies use name/genre/phone only.
## 2026-08-23 — Education refined, real-time tone, rates as grounding, templates flagged off
Four corrections/ships from Nick. (1) Education principle SHARPENED: renaming a concept IS obfuscation — titles use the real industry term ("Soft ticket"/"Hard ticket") with the .info-tip ⓘ immediately after the title and plain language in the description. The "Flat rate (soft)" label sweep from earlier today is REVERTED everywhere; don't reintroduce it. (2) Tone refresh is now material-aware, not daily: refreshToneProfile retrains whenever an email_out exists newer than tone_updated_at (checked every poll + Gmail push; instant-force on AI-diff sends already existed) — zero Gemini spend when nothing new. "We grow in every interaction and the assistant should too." (3) RATES ARE GROUNDING, NOT PITCH MATERIAL: Nick never names a rate in a pitch ("that's a bad way to get a sale") — the rateWhen rule in /ai/draft now permits naming a number ONLY when their last message asks about money or when confirming agreed terms at hold/booked; rates exist so the AI can't go rogue when asked. (4) Static templates are the no-AI fallback → hidden behind FLAGS.staticTemplates (localStorage gc_flag_templates, off by default; product fork maps to plan gating). Onboarding status answered honestly: only the 3-step welcome checklist exists (profile → first venue → war room); the real intake epic is unbuilt.
## 2026-08-23 — Guided tour, card-corner tips, promoter/private tone classes, org-entity gap flagged
Four more from Nick's launch-readiness pass. (1) The .info-tip on wizard ticket cards moved to the card's top-right corner (.ticket-tip, .ticket-btn is position:relative) — titles are clean terms, ⓘ in the corner, plain language in the description; soft desc now names festival + private events (both were ALREADY soft types in softTypes, incl. 'Promoter / agency' and 'Corporate / private' — the desc just never said so). (2) Tone matrix has no UI on purpose (DB + prompt infrastructure); to inspect: select tone_profile, tone_matrix from artists; to force a full retrain: update artists set tone_updated_at = null; (material-aware gate retrains within one poll). roomClass gained 'promoter' and 'private' classes so those buyers get their own calibration cells. (3) GUIDED TOUR shipped: 8 coach-mark steps (TOUR_STEPS) navigating the real app — war room → nav → Pipeline → Discover → Add wizard → Calendar → Gmail connect → ready — ring-highlight via box-shadow dim, "n of N" card with Back/Next/Skip, completion sets gc_tour_done, replay from Settings, and it's step 1 of the welcome checklist (now 4 objects: tour → profile → first venue → war room). Educate, never assume. (4) FLAGGED, not built: the model is venue-centric — agencies/promoters/private buyers book ACROSS rooms and are currently shoehorned in as a venue type. Product-tiers open decision #4: the fork schema makes ORG a first-class entity (deals attach to org OR venue) from day one.
## 2026-08-23 — Tone matrix confirmed live; day-job voice pollution found & fixed
Nick's SQL screenshot proved both things at once: his row has a real voice card and a populated tone_matrix (cold|bar cell, built same-day) — the matrix works. But two beta artists' tone cards were pure day-job corporate email ("align on project goals, scope, and timelines") — the old any-sent-Gmail sampling had learned their WORK voice. Fix: the Gmail bootstrap fallback now samples ONLY mail sent to known booking contacts (addresses from their deals' people/contacts, in:sent to:<addr>), and when fewer than 2 booking samples exist it writes NOTHING and doesn't stamp tone_updated_at — no card beats a wrong card; the material gate retries once they actually send. Cleanup run in SQL editor: update artists set tone_profile=null, tone_matrix=null, tone_updated_at=null; (Nick's rebuilds from pipeline history; work-email artists stay cardless → generic voice until they book through the app). Principle: the artist's voice is learned exclusively from booking correspondence.
## 2026-08-23 — Activation funnel data: everyone bounces at minute zero
Nick discovered he has 5 invited users; the funnel query says 4 of 5 never returned after signup day, started_profile=false, zero deals — they died BEFORE the first checklist step, not at the Gmail wall. Samantha's row (onboarded=true, no profile) shows the checklist was click-through-able without doing anything. Nick's own row (100 deals, 122 sends) proves the loaded-state ceiling. Decision for the onboarding epic, ordered by this data: (1) value before any ask — first session opens into the tour then "pick a room in your city" from the collective's REAL venues; (2) the artist intake (3-4 conversational questions, the useful subset of the profile) is the price of the FIRST AI DRAFT, not a form at signup — aha without Gmail; (3) Gmail connect is session two's "make this automatic" upsell (= Stage-1 send-only architecture). Personal re-invites go out only after the intake flow ships — none of the five ever saw today's tour/tips.
## 2026-08-23 — Onboarding flow locked; diff-training made visible; RLS worry settled
Nick's corrections. (1) RLS verified airtight — invitees CANNOT see his deals (pipeline_own artist_id=auth.uid(), activities via owner's entry, sm_own); what they see is the shared collective in Discover (his venues/intel/wins — by design). Their own war room/pipeline is the empty dead-end surface. (2) THE ONBOARDING FLOW, locked by Nick: profile creation happens VIA INTAKE (required, conversational) → real guided onboarding → first AI draft → DIFF EDUCATION: users must be shown that editing an AI draft and sending it trains the AI toward their voice. First slice shipped now: the composer shows "Edit freely — the AI compares what it wrote with what you send, and learns your voice from the difference" whenever an AI draft is in the box, and the schedule/send toast says "your edits just taught the AI your voice ✍️" when body ≠ ai_draft. (Samantha is Nick's wife — her click-through onboarded row isn't a churn signal.) The intake question set is proposed and awaiting Nick's verdict on which profile fields survive.
## 2026-08-23 — Intake redesigned: derive and confirm, never ask artists to self-describe
Nick: "artists hate asking / describing their genre. think about that." The conclusion: every intake question asking an artist to describe themselves (genre, oneliner) is the app assigning its own job as homework — self-reduction they hate, marketing copy they came here to avoid. Intake v2 design: (1) "Drop your links" (Spotify/IG/site/EPK — the only real ask); (2) worker fetches them (Spotify client-credentials API has genre tags/related artists/listeners; site/EPK carries their bio), Gemini distills, and the AI PRESENTS the profile — "here's how I'd pitch you… sound right?"; (3) artist corrects rather than composes — which demos the product's core loop (AI drafts → you edit → it learns) in the first 60 seconds, diff-education starting at the profile itself; (4) typed fields shrink to home market + rates (grounding, with ⓘ). The aha upgrades from "the AI wrote a pitch" to "the AI already knows who I am." Not built yet — needs a worker /intake endpoint + intake UI; paste-2-3-booking-emails voice seed rides along.
## 2026-08-23 — Artist intake shipped: derive & confirm
Built the intake designed earlier tonight. Worker: POST /intake (verifyUser → reads Spotify [full artist object w/ genre tags when SPOTIFY_CLIENT_ID/SECRET env vars are set on Railway, else public-page meta fallback] + website/EPK [fetch, strip tags, 6k chars] → one Gemini JSON call → {genre ≤4 booker words, oneliner one-sentence no-hype, notable best-concrete-brag-or-empty, never invent}); POST /intake/tone (pasted booking email ≥80 chars → 120-word starter tone card, written ONLY if tone_profile is null — a paste never clobbers learned voice). App: #intake overlay reusing welcome-overlay chrome — links step ("I'll type it myself" escapes to classic profile edit) → loading → confirm-and-correct step framed as the product's core loop ("your edits are the point"), typed fields only home market + rates (grounding info-tips), optional voice-seed paste. Welcome checklist step 2 now opens the intake. To get real Spotify genre tags: create a (free) Spotify developer app and set SPOTIFY_CLIENT_ID/SECRET on the Railway worker — works without but reads less. Onboarding epic now: tour ✓ intake ✓ diff-education ✓ checklist ✓; ready for the personal re-invites.
## 2026-08-24 — "One-liner" became "Hook"; profile subtitles caught up with the AI-first era
Nick asked for a term that speaks to the field's function. "Hook" won: musician-native vocabulary, names the function exactly (the one line that catches a booker — it opens every AI pitch), and coaches better content than "one-liner" (which invites bio trivia). Rejected: elevator pitch (corporate), tagline (marketing-speak), opener (collides with opening act). Renamed in profile view (with an info-tip teaching it: "make it sound like a reason to book you, not a bio"), profile edit, and intake. Same pass: every profile section subtitle still explained fields via TEMPLATES ("used in every template", "credibility signals in pitch templates") — stale since templates went behind the flag; rewritten AI-first (identity = how the AI introduces you, links = the listen, draw = credibility the AI draws on with the rates-are-grounding rule stated, notable = what the AI name-drops). The DB column stays `oneliner` — label-only rename.
## 2026-08-24 — The hook rule: it must survive first person
Nick: first-person renderings of the hook "always sound kinda lame — which is why I've always deleted it." The insight, encoded: a hook is written ABOUT the artist but deployed BY the artist, so it must survive first person — meaning no self-praise at all: word it as an observable effect on the room or a concrete fact ("plays originals that quiet a room"), never a self-assessment ("has an unforgettable voice"). Encoded in three places: (1) /intake generation spec (GOOD/BAD examples, ban self-adjectives); (2) /ai/draft first-touch HOOK RULE — never render profile praise as first-person self-praise; convert to outcomes ("my sets tend to quiet the room"), attributed praise ("bookers keep telling me…"), or drop it entirely if it can't be said naturally; (3) the profile Hook info-tip + edit placeholder teach the same wording rule to the human. This came straight from his deletion behavior — exactly the edit-pair signal the tone system exists to catch, now promoted to a hard prompt rule.
## 2026-08-24 — Template quality overhaul from Nick's "unusable" review
Nick tore apart the cold-outreach template ("no artist would send this"): [city] fallbacks, the draw claim floating as its own paragraph ("Random 50-60... wtf is that?"), website labeled "a quick listen" PLUS an EPK link, and a hand-typed name/phone sign-off despite gmailSend's real signature. Fixes, all shipped: (1) SMART FALLBACKS — template clauses omit themselves when data is missing; no bracketed placeholder ever renders. (2) ONE LINK per message via bestLinkLine(): EPK > website > Spotify, labeled as what it IS ("listen" is only honest for streaming) — two options and a human clicks neither. (3) DRAW redefined: verified max tickets sold to ONE show, hard-ticket rooms only, rendered as "Best single-show ticket count so far: N"; blank displays "Unverified"; profile field renamed "Max tickets (one show)" with teaching tip; the AI prompt got a DRAW rule (omit entirely for soft rooms; unverified = say nothing, never zero, never estimate) and a LINK rule (one link, hierarchy, honest labels). (4) SIGNATURE MANAGER on the profile: live preview of exactly what gmailSend appends, master on/off + show-website/show-phone toggles (migration 034: sig_enabled/sig_show_website/sig_show_phone, defaults true; worker respects them), logo upload to avatars/{id}/siglogo → sig_logo_url; templates/drafts no longer sign with phone tails — the signature is the single sign-off. Preview now renders the REAL templates.outreach generator so it can never drift from the composer.
## 2026-08-24 — Manual theme switch (Auto / Light / Dark)
The app was dark-only-if-your-OS-is: three @media (prefers-color-scheme: dark) blocks. Restructured for a manual switch: dark tokens (+ color-scheme: dark for native controls) moved onto html[data-theme="dark"] (with the logo-invert and bnav-active rules), a tiny pre-paint head script resolves the stored choice (gc_theme) or the OS preference into the attribute — no theme flash — listens for OS changes while on Auto, and keeps the theme-color meta (browser/PWA chrome) in step. Settings gained an Appearance row (Auto/Light/Dark select; Auto is default and removes the stored key). No token values changed — same palettes, now switchable.
## 2026-08-24 — Pitches argue the buyer's economics: playbooks per room class
Nick: "Hard ticket sales don't matter to soft ticket and vice versa — different templates for hard and soft, with an exception for festivals, agencies, etc." Shipped both layers. AI: pitchPlaybook(cls, ticket) injects a per-buyer argument frame into /ai/draft (skipped at hold/booked/played): SOFT = what your set does for THEIR business (clientele fit, keeps people seated & ordering, set-length stamina, reliability — draw is banned), HARD = why this date sells (verified draw, audience fit, promo push — bar-vibe arguments cut), FESTIVAL = programming fit + cross-market draw + EPK-first + respect the booking cycle, PROMOTER/AGENCY = roster fit + materials + what they're buying for, PRIVATE/CORPORATE = versatility + self-sufficiency, draw irrelevant. The DRAW rule now matches the playbooks: hard rooms, festivals, and promoters may hear draw; soft rooms never. Static templates: talentBuyer(vtype) regex; outreach's middle argument = drawLine for ticket buyers, formats/fit line for soft rooms; pitch template same gate. The tone matrix (voice) and playbooks (argument) now cover the two halves of the draft rework — the template dropdown's remaining job is the no-AI tier.
## 2026-08-24 — Layered-glass design language (Apple Maps study)
Nick pointed at Apple Maps: transparency, z-index visual hierarchy, corner radius. Codified in design-system.md as the three-layer model — content bed (opaque, r12) → floating chrome (glass: color-mix 72–86% + blur 12–18 saturate(1.3) + border-mid + deep shadow, r22/999, z60–99) → transient sheets (heavier glass, r20–22, z100+). Rule: anything that floats gets glass; bigger radius = higher elevation. Applied this pass: tour-card (was flat opaque r16 → glass r22), war-selbar sticky bar (frosted), toast (frosted dark glass + hairline + shadow; showToast's inline colors now color-mix translucent). The bnav island and mobile top bar already spoke the language. His two reference screenshots were drag-preview temp files that vanished before reading — if specific screens were being critiqued, he'll re-send.
## 2026-08-24 — Google Places sets the venue type (no more everything-is-a-bar)
Nick: "every listing gets saved as a bar" — the Maps autofill never touched the venue-type select, so the Bar/Pub default won every time. Fixed: /places/search field mask now requests places.types + places.primaryType, and venueTypeFromGoogle() maps Google's taxonomy to ours (winery/brewery/distillery → Winery/Brewery; casino; performing_arts_theater/auditorium → Theater; concert_hall/amphitheatre → Concert hall; cultural/community center → PAC; night_club/dance_hall → Music club (ticketed); banquet/wedding/event venue → Corporate/private; coffee; hotel/lodging → Hotel bar; bar/pub/wine_bar; restaurant incl. *_restaurant suffixes) with a ticket-class verdict; null when Google doesn't know (select keeps its default — no bad guesses). Wizard pickVenueResult sets the type select when the mapped type exists in the current ticket class, and when it belongs to the OTHER class it toasts "Maps calls this a theater — usually hard ticket, back up a step" (respects step-1's choice, never overrides silently). Deal-side quick-create sets both cnr selects. Refactor note: the places handler and everything after it moved from the createServer arrow into handleHttp(req,res,u) so venueTypeFromGoogle could live at top level — .listen moved to the createServer close.
## 2026-08-24 — The Angle field: per-message direction for the AI
Nick (looking at the Island View Casino deal, where the notes held the real play — "Debbie runs the VIP 500-cap side, book well out"): the draft box takes context in, but there was no way to TELL the AI what this specific message should do. Shipped: 🎯 Angle input in the draft composer (between subject and body, shown for all channels), per-deal state draftAngle[uuid] surviving re-renders, cleared on schedule alongside draftText/draftAI (an angle is for THIS message). /ai/draft receives angle (≤500 chars) and injects it as ARTIST'S DIRECTION weighted ABOVE the generic objective and buyer playbook — direction wins conflicts, and the prompt notes it may reference people/details from the notes/conversation (so "mention Debbie sent me" resolves). The weighting stack is now: artist's direction > objective/playbook > conversation evidence > venue info > tone card + matrix cell (voice). Also fixed in passing: draftAI wasn't cleared on schedule (stale AI-diff baseline could mislabel the next message's edit pair).
## 2026-08-24 — Venue type required in the wizard; Bar/Pub backfill endpoint
Two anti-"everything is a bar" moves. (1) The wizard's venue-type select now opens on "Select venue type…" (empty value) instead of silently defaulting to the list's first option, and wizNext blocks step 2 without a choice ("Pick a venue type — it decides how the AI pitches this room"). Same treatment on the deal-side quick-create (typeOpts placeholder + cnrCreate validation + the cnr-ticket onchange rebuild keeps the placeholder). Google autofill still sets the select when Maps knows. (2) Worker POST /admin/venue-type-backfill (verifyUser-gated): re-queries Places for every venue whose type is null or 'Bar / Pub' (never touches deliberate choices), requires a plausible name match, applies venueTypeFromGoogle (updates venue_type + ticket_type), reports {checked, changed[], skipped[]} with a reason per skip. Run from the app's browser console with the session token — one-off maintenance, kept in the worker where PLACES_API_KEY lives.
## 2026-08-24 — Referral-warmed cold outreach: calls are context, not correspondence
Big catch from Nick on the Island View deal: the AI opened its FIRST email to Blaine with "following up here" because the logged 📞 "Spoke with Debbie (VIP side), Blaine is PoC" counted as prior outbound → follow-up register. His framing, now encoded: a call with a human makes the next email "half a degree warmer than a true cold email" — NOT a follow-up. Worker changes: isRealMsg() excludes 📞🤝📝 logs from the lastInbound/hasOutbound objective derivation (💬📸 texts/DMs still count — those ARE messages to the contact; all logs still appear in the conversation context either way), and a new spokeBefore objective slots between follow-up and cold: FIRST WRITTEN MESSAGE warmed by real-world contact — read the log carefully (the call may have been with a COLLEAGUE, not the recipient), name the referral only as the log supports ("Debbie suggested I reach out" vs "great speaking earlier"), never open with "following up"/"circling back". firstTouch stays true for these, so the full profile + playbook + hook rule apply.
## 2026-08-24 — Sent-confirmation push removed
Nick: "Do we need a push notification for messages that send? seems annoying." Correct — push is reserved for things that NEED the artist: reply received, bounce, new lead. "Sent ✓" was self-congratulation at attention's expense; removed. The send still lands in the activity log, the scheduled-sends list updates via realtime, and (product-fork note) "sends that fired" belongs in the free daily digest per spec-notifications, not in instant push for anyone.
## 2026-08-24 — Orgs are first-class NOW (not just in the fork): migration 035 + the third wizard path
Nick, on the agency-wizard proposal: "why not do both but have it write a real fix instead of a venue row." Shipped the real fix in his instance. Migration 035: orgs table (name, org_type, city/state, website/phone, books soft|hard|both, notes, created_by; RLS mirrors venues), people.org_id, pipeline_entries.org_id + venue_id DROPPED NOT NULL + pe_counterparty check (venue OR org required). Wizard step 1 gained a full-width third card "Agency / Promoter / Buyer" → org-shaped steps (Who are they? → contact as the star, no pay fields → notes, no clientele) → wizSubmitOrg writes orgs + org-linked person + org-attached deal. Downstream strategy: org deals WEAR THE VENUE SHAPE — loadPipeline and /ai/draft map org name/type/place/books into the existing venue fields (p.orgId carries the truth), so every surface (pipeline list, war room, detail, drafts) works unchanged, while roomClass routes org types to the promoter/festival playbooks ('management' added to the promoter regex) and the prompt labels them BUYER not VENUE. Orgs are NOT in Discover v1 (venue grid queries venues). fetchVenueContacts already guards on venueId. The fork inherits this schema instead of retrofitting it — open decision #4 partially resolved in production.
## 2026-08-24 — Venue type list cleanup
Nick's review: removed 'Promoter / agency' from both lists (the org wizard path replaced it — no more fake-venue agencies), and simplified labels: 'Casino floor'→'Casino', 'Festival stage'→'Festival', 'Hotel bar'→'Hotel'. venueTypeFromGoogle updated to emit the new labels (Casino, Hotel). Icon matching (venueIcon substring) and roomClass regexes match old and new forms, so existing rows with old labels keep working; optional normalize SQL offered to Nick for the stored rows.
## 2026-08-24 — Conversation logging redesigned: words, not mystery emojis
Nick called the conversation tab "horrendous" with four screenshots: six unlabeled grayscale emoji channel buttons, a You/{name} toggle with no verb, edit/delete micro-icons colliding into a clipped "Sure?" over the bubble text. Redesign (guided, not modal — his "possibly a wizard" answered with a sentence-shaped composer): header "Log an exchange the app couldn't see", labeled question rows — "Who spoke?" [You did / {First} did] and "How?" [Text · Call · DM · Email · In person · Form as icon+word pill chips, amber when selected] — and an adaptive placeholder that asks the natural question for the combo (call+out: "How did the call go? (no answer, left a voicemail…)"; call+in: "What did Eric say on the call?"; email+out notes the app logs its own sends). Storage format unchanged (emoji prefix — worker's textish/isRealMsg depend on it), but bubbles now RENDER a labeled channel tag ("📞→ CALL FROM ERIC · LOGGED BY HAND" style, .m-chan) with the emoji stripped from display. Edit/delete tools got a frosted backdrop pill, bigger tap targets, .msg.manual reserves right padding, and armed delete is a proper "Delete?" danger pill (.note-ic.armed) instead of text jammed over the bubble edge.
## 2026-08-24 — Every conversation bubble names its sender
Nick (in light mode): "all the messages look the same now." Root cause: sender identity relied on pale pastel backgrounds (talks-bg vs pitched-bg — weak contrast in light mode) plus a hover-only title attr; the .m-meta CSS existed but was NEVER RENDERED. Now every bubble carries a visible meta row — "↙ MARC · 2d" on theirs (blue, left) / "YOU ↗ · Today" on yours (amber, right-aligned) — small caps, colored to match the rail. Hover title removed (redundant). chanTag simplified (sender no longer duplicated in it).
## 2026-08-24 — Email direction bug: SENT label is the authority, not From-match
The new sender labels immediately exposed a data bug: Marc's rejection email was labeled YOU — stored as email_out. Root cause: both ingest paths (ingestContactHistory line ~275 and applyMessage line ~311) classified direction by from.includes(contactEmail) — anyone replying from a different address than the one stored on the contact failed the match and got filed as the ARTIST'S outbound (also wrongly advancing Lead→Pitched instead of →Talks, and suppressing the You've-got-mail push). Fix: direction now comes from Gmail's own SENT labelId — in the artist's mailbox, SENT = you wrote it, anything else = it came to you. ingestContactHistory also SELF-HEALS: re-running "Pull the full Gmail history" (the refresh button on the conversation) corrects the kind of already-misclassified rows in place (matched by email_message_id) instead of skipping them. To repair a wrong thread: open the deal → tap the conversation refresh button. Lesson: the invisible-sender rendering had been HIDING this data bug — making state visible is what surfaced it.
## 2026-08-24 — Bubbles name the message's OWN sender, not the deal's current contact
Nick switched the deal's contact from Marc to "Generic Inbox" and Marc's rejection relabeled itself "↙ GENERIC" — history rewrote itself because bubble labels read the deal's current contact's first name. Fix: migration 036 adds activities.from_name; the worker's senderName(full) parses the From header's display name ("Marc Driskill" <marc@…> → Marc Driskill, falls back to the email local part) and stores it on every inbound at ingest; the conversation-refresh self-heal now also BACKFILLS from_name on existing rows (alongside direction correction); the bubble meta prefers a.fromName's first word and falls back to the deal contact only when unset (pre-fix rows, manual logs). Rule recorded: a message's sender is immutable message data, never derived from mutable deal state. MIGRATION 036 MUST RUN promptly after this deploy — logActivity inserts now include from_name and will 400 against the old schema.
## 2026-08-24 — Contacts are collective records (the Marc Driskill inflection)
Nick, after watching sender labels survive a contact switch: "there is only ever one Marc Driskill booking the Blind Tiger... wouldn't it make sense that the collective all maintain these contact records?" Fact: the model already half-believes it — people has read/write-all RLS (migration 026), the wizard dedupes people by email across artists, contact edits already say "everywhere they book." Now deliberate, with the boundary line: SHARED = identity facts (name, title, org, emails, phone, socials, which rooms — directory data, same class as the venue book); NEVER SHARED = relationship state (your conversations, notes, response history — same reputation-safety reasoning as the groups decision). Mechanics to build when this becomes a feature: provenance/freshness on shared records (updated_by, verified_at — "confirmed by Sage, March" beats your stale private copy; that's the pitch), and ingest-derived enrichment PROPOSES, never silently overwrites (Marc replying from a second address is how the collective learns his real addresses — derive & confirm, applied to contacts). Product-fork scoping: contact records are group-scoped like the venue book.
## 2026-08-24 — "+ to Pipeline" pre-loads the known booker
Nick: "if a second person goes to book Black Dog Pub, Marc's info would be pre-loaded?" Gap found: addVenueToPipeline only checked the LEGACY contacts table, never venue_people — the collective's booker was displayed on the deal but not attached. Now: exactly one known person → auto-attached with toast "Added — Marc Driskill pre-loaded from the collective"; several known → none attached (don't guess), toast says how many and to pick on the deal; none → legacy contacts fallback. This is the collective's compounding moment made tangible: member two starts from Marc, not from blank.
## 2026-08-24 — Collective-first venue search + the on-the-phone +1 (migration 037)
Nick's flow: on the phone with a venue → type the name → the collective pre-populates → confirm while the human's on the line → the record gets a +1. Built: (1) The wizard's venue search now answers from THE COLLECTIVE FIRST — matching member venues render above Maps results ("Already in the collective ✓ · knows Marc Driskill"; Maps results get a "From Maps — new to the collective" label) — which also kills duplicate venue creation. (2) Picking a collective match renders a confirm card (venue facts + known bookers with title/email/phone, "you're the freshest eyes on it") with THREE exits: "Looks right — start my deal (+1)" (addVenueToPipeline with booker pre-load + jump to the new deal, and verify_count/verified_at/verified_by stamped on the venue AND its people — migration 037), "Something's off — open & fix" (venue detail quick-edit), "← Back to search" (wizTicket remembers the step-2 ticket). (3) Venue detail shows the freshness line: "Verified 3× by members · last 2d" in booked-green. Freshness is the collective Rolodex's pitch made visible.
## 2026-08-24 — Wizard keeps your work; reminders; leads go cold
Three from Nick. (1) WIZARD STATE: back-navigation wiped everything — now wizData resets ONLY on fresh entry to the add screen (and "Add another"); every step renders prefilled from wizData (incl. custom Other venue type, org fields, raw pay values and first/last name — wizCapture now stores rateRaw/payLo/payHi/contactFirst/contactLast alongside the derived pay/contactName); all Back buttons go through wizBack(step, ticket) which CAPTURES before stepping back, so nothing typed is ever lost in either direction. (2) REMINDERS (migration 038: pipeline_entries.reminder_at/reminder_note): "call back tomorrow" is a promise, not follow-up automation — a one-line card on the deal (datetime + note + set; active reminder shows as a card with Done) and due reminders take the TOP of the war room (tier 0, ti-alarm, hold-purple, "Reminder — call Maddison back · You set this 2h ago", Done button) and priorityScore 122. Cleared reminders log system activities either way. (3) COLD LEADS: isCold() = active-stage deal ≥45 quiet days (COLD_DAYS; computed, not a stage — any activity thaws it since days resets). Cold deals: excluded from the Active count, STOP the follow-up nag (followupDue guard — cold leads were going to nag forever), sink to priorityScore 1 (above passed/dead only), wear "❄ Cold · Nd quiet" in the list, and get their own "❄ Cold · N" pseudo-filter in the stage select. It's a numbers game — the pipeline shows you where to spend today, not everywhere you've ever knocked.
## 2026-08-24 — Mobile overflow from the reminder card
The new reminder-setter card (icon + datetime-local + note input with fixed min-widths + button in a non-wrapping flex row) exceeded 375px and shoved the ENTIRE app into horizontal scroll on mobile. Fixed: the row wraps (picker + Set on row one, note takes a full row, min-width:0 everywhere), plus a global guard — html,body { overflow-x: clip } (clip, not hidden, so sticky elements keep working) so a stray wide row can never again drag the app sideways. Lesson: any new flex row with fixed min-widths must be tested at 375px.
## 2026-08-24 — Reminders visible as Home to-dos; the say-it-in-words rule
Nick: reminders should show on Home as to-dos, and the setter card was "just random icons" — "don't assume they are omni-intelligent agents." (1) New Home section "Reminders — your to-dos" (between the mini-cal/upcoming and Scheduled sends): every PENDING reminder as a row (note or "Come back to {venue}" · venue · when · Done button · tap → deal); due ones still jump up into Needs-you. The full lifecycle is now visible: set on the deal → sits on Home as a to-do → pops to the top when due. (2) The setter card leads with words: "⏰ Remind me — they said 'call back Tuesday'? Set it below and it shows up on your Home when it's time", the button says "Set reminder" not a bare icon, and the note placeholder shows a concrete example. RULE ELEVATED alongside education-over-obfuscation: every control says what it is IN WORDS — icons decorate, words explain. Assume zero context, always.
## 2026-08-24 — Reminders actually push (migration 039)
Nick: "I'll get notified at the time the reminder is due correct?" — honest answer was NO: due reminders only surfaced on Home render. Now the worker's tick pushes each due reminder once ("⏰ Reminder — call Maddison back" → deep-link to the deal), gated by reminder_pushed (migration 039, reset to false on every setReminder so re-setting re-arms). Precision = the poll cadence: within ~POLL_MINUTES (10 min default) of the due time, and it needs push enabled on the device (Settings toggle). Reminders pass the needs-you push bar by definition — it's the artist's own request.
## 2026-08-25 — War-room flash of phantom follow-ups fixed (render gate)
Nick screenshotted two frames 2s apart: first paint showed 4 follow-up-due rows + zeroed momentum, second showed the truth (1 reply row, 23 sent). Race: loadPipeline fires loadActivities + loadScheduled in parallel and whichever returned first rendered Home with half data — without activities, every pitched deal ≥7d quiet looks followup-due (snooze/dismiss markers and inbound timestamps not loaded) and momentum reads 0. Fix: actsReady/schedReady flags reset on each loadPipeline; renderHome only paints the real war room when BOTH are in (renderHomeIfReady); mid-load it holds a quiet "Checking your pipeline…" skeleton (only when war-needs is empty — realtime refreshes keep the previous render instead of blanking); empty pipelines set both flags immediately so new accounts don't stall on the skeleton. Rule: never render conclusions from half-loaded data — skeleton or stale-but-true beats fast-but-false.
## 2026-08-25 — Two-way navigation between deal and venue
Nick: "we need better navigation from pipeline to venue and vice versa." Both directions were broken: the deal's primary venue chip was cursor:default (no path from a deal to the room's collective page at all), and the venue's "In pipeline ✓" chip was a dead badge. Now: deal → venue via the rooms-in-play chip (labeled with ↗, tooltip "intel, wins, quick edits") AND the header venue name (clickable when venueId exists — org deals keep the static chip since orgs have no page yet); venue → deal via "In pipeline — open deal" (finds your deal for the room). goBack's navStack already handles the hop back either way.
## 2026-08-25 — Multi-location venues: the model holds; disambiguation fixed
Nick probed: "what if a mom and pop coffee shop has two locations?" Model verdict: already correct by construction — each location is its own venue row (intel/pay/wins are location-specific), the shared owner is ONE person linked to both via venue_people (email dedupe), and deal_venues can pitch the owner once across the set. The real gap: disambiguation — the collective-first wizard search and its confirm card showed name+city but not STREET, so with two same-name rooms in one town you could +1-verify the wrong location while on the phone. Fixed: street address now shows in the collective search result subtitle and as an Address row on the confirm card. Remaining nicety (not built): Discover venue cards show name+city only — same-name pairs look identical in the grid until tapped.
## 2026-08-25 — Dismissed rows resurfacing: stale-response race killed with load sequencing
The render gate fixed boot flashes but Nick still saw DISMISSED rows flash back. Second race found: dismiss inserts its marker then calls loadPipeline directly, AND the marker's own realtime echo triggers another loadPipeline — two overlapping cycles, four in-flight queries; an activities response fetched BEFORE the marker existed could land LAST and overwrite fresh state, resurrecting the dismissed row until the next cycle. Fix: loadSeq counter — every loadPipeline claims seq=++loadSeq, and every response callback (pipeline fetch, loadActivities, loadScheduled) bails when its seq !== loadSeq. Latest cycle owns the UI, period. Together with yesterday's actsReady/schedReady gate this closes the whole class: no rendering half data, no rendering old data.
## 2026-08-26 — Snooze and Dismiss everywhere they make sense
Nick: "dismiss should be available alongside snooze and vice versa (snooze on select)." Follow-up rows now carry BOTH inline buttons — Snooze (7-day clock restart) and Dismiss (permanent until a new outbound re-arms, via new dismissFollowup(); previously select-mode-only) — overriding the old designer pass that limited follow-ups to one button for 375px title room (Nick's call; titles clamp to 2 lines anyway). Select mode gained bulkSnoozeWar(): a "Snooze N" chip beside "Dismiss N", counting only snoozable (follow-up) rows since replies/bounces have no quiet-clock to restart; items carry a snoozable flag. Batch-pileup morning routine is now two taps: Select all → Snooze N.
