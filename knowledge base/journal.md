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
