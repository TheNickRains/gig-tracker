# Gig Collective — UX inventory

This document is maintained by Claude. After any session where a screen is added, changed, or removed — update the relevant section. Keep it accurate to what's actually in `gig-collective.html`, not what's planned.

---

## Nav & routing

**Top bar** — sticky, 54px: brand (tap = Home) left; avatar right (photo if set — opens Profile, amber ring when active). **No hamburger, no dropdown.**

**Floating island nav (bottom)** — THE island is the navigation (YouVersion/Venmo-style): fixed pill, blurred translucent bg, safe-area-aware, centered, max 432px. Items: Pipeline · Discover · **HOME (center throne — raised 52px amber circle)** · Calendar · Settings. Active item gets an amber pill; detail maps to Pipeline's tab, venue detail to Discover's. Add-venue lives on Home (war room quick action). `.app` carries bottom padding so content clears the island.

**Layout** — mobile/PWA is FULL-BLEED (the gutter-island was an artifact, reverted; the bottom nav is the only island). Desktop ≥600px: centered bordered column on `--bg-page`. Desktop ≥1100px **with Home active**: the app widens to 1060px and Home becomes a 2-col war-room dashboard (`:has()` — Needs-you left, stats/actions/sends right). Viewport pins `maximum-scale=1` + `touch-action: manipulation` (no iOS input-zoom / double-tap zoom).

**Routing** — every screen is a URL hash: `#home #pipeline #discover #add #profile #settings`, pipeline detail = `#entry/<uuid>`, venue detail = `#venue/<uuid>`. Refresh restores the screen (deep routes wait for data via a pending-route retry), browser back/forward work, and detail links are shareable within the app.

---

## Home — the war room

Greeting + subhead, then the command center:

**Needs you** (top of page) — the attention list, computed from DATA not localStorage: (1) **send awaiting review** (scheduled message hit its time with auto-send off), (2) **"{Contact} replied — your move"** (their last word is newer than yours; clears automatically when the worker logs your outbound), (3) **follow-up due** (Pitched ≥7d quiet). Rows: colored icon chip + venue + what happened (title clamps to 2 lines) + AI summary preview; tap → detail. Count pill in the label. Every notification type dismisses via a marker activity (kind:system): bounce/reply rows have a **Dismiss** button (a newer event re-surfaces them); follow-up rows have exactly ONE button, **Snooze** (`✓ Follow-up snoozed` — restarts the 7-day quiet clock; designer pass: two text buttons left ~13 chars of title on 375px). Permanent follow-up dismiss (`✓ Follow-up dismissed` — off until a NEW outbound re-arms) is done via select mode. Snooze/dismiss suppress the Pipeline "Xd overdue" chip and lower priorityScore via `followupDue()`. `.war-x` buttons share .vchip metrics (border-mid, radius 7, 11.5px, 7×11 padding) + an invisible ::after hit-area extender, hover = amber-400 border. **Select mode**: Select button (vc-btn, right of label) → list uncaps to ALL items, rows toggle checkboxes (right slot, `--text-primary` when checked — NOT amber-800, which is invisible in dark mode; selected rows get bg-secondary), sticky action bar (`.war-selbar`) with Select all / Clear all + "Dismiss N selected" (one batch insert of per-type markers). Non-dismissable rows (send awaiting review) dim to 55% with a tiny uppercase "review" label (no tooltip — iOS). Empty state: "All clear — nothing waiting on you." NO badges on nav icons anywhere (rejected: stress-inducing).

**Stats row** — 3 cards: Active leads · Booked · Collective wins (placeholder).

**Quick actions** — Add venue (primary) · Discover.

**Scheduled sends** — queue of pending sends ("Sends Fri, Jun 12, 9:00 AM · cancels if they reply"); tap → detail.

**Collective activity feed** — card with flush padding. Each entry: member avatar (colored initials), action description, timestamp + market. Most recent first. Each row has a quiet ×  (`.feed-x`, icon-only, brightens on hover) — dismissal is **per-device localStorage** (`gc_feed_dismissed`, keyed `c:/v:/w:` + created_at or id, self-trims to 80): the feed is shared roster data, so dismiss = "stop showing me", never deletes the row. Sources query 10 each so dismissing reveals older items. Members have consistent avatar colors across the app:
- NR (Nick): amber
- SJ (Sage Jordan): green
- AC (Avery Cole): gray
- DL (Dana Lake): blue
- CV (Casey Vance): pink
- LN (Lee Nolan): teal
- LR (Liam Ross): purple

---

## Discover

Master venue list. Shared across all artists. Written to by the collective's adds and updates.

**Search + filters** — ONE row, same grammar as Pipeline (search flexes · lens selects · place chip anchors the end, all `.pipe-sort`/`.loc-chip` compact styling — the old separate `.filter-row` of bordered form-selects is gone):
1. Ticket type (All / Hard / Soft)
2. Pipeline status (`#disc-pipe-filter`): All / In pipeline / Not in pipeline
3. Location — the SAME `.loc-chip` drill-down control as Pipeline (shared `renderLocScope('disc-loc', venues, discLoc)` + `locMatch`; see Pipeline section for full behavior). Replaced the old state→city cascading selects. Persisted via `gc_disc_loc`.

**Venue grid** — 2 columns. Each card:
- Venue name (bold)
- City, State
- Venue type badge (hard = blue, soft = gray)
- Pay range (dollar icon)
- Primary contact name (user icon)

Map view: deferred to v2.

---

## Pipeline (renamed from "My pipeline")

Personal CRM. Stages (the spine): **Lead → Pitched → In talks → Hold → Booked → Played**, with exits **Passed** (recyclable no — fair to circle back) and **Dead end** (terminal — never resurface). Hold appears only for hard-ticket venues. Follow-up is not a stage; it's a scheduled action (slice B).

The worker auto-advances stages from Gmail: outbound pitch to the contact ⇒ Lead → Pitched; their reply ⇒ → In talks (also resurrects Passed); never auto-moves Hold/Booked/Played/Dead.

**Priority list** (grouping was tried and rejected) — one flat list sorted by `priorityScore`: replies awaiting response (In talks, ≥1d) → follow-up overdue (Pitched ≥7d) → Pitched aging → fresh replies → Lead/Hold going stale → Booked → Played → Passed/Dead at bottom.

**Search** — input row at top; matches venue/contact/city **plus stage names and the deal's notes + conversation text**. **Filter** — two selects beside the search: stage (All · {stage} · counts; chips were tried and REJECTED as noisy) and **location** — a map-pin chip (`.loc-chip`: native select stretched invisibly over a chip face). The select DRILLS DOWN, never shows the whole tree: level 0 = Anywhere + "Your markets" optgroup (pipeline cities matching profile markets/home_market, city-name normalized) + one row per state with counts; picking a state re-scopes to level 1 = "← Anywhere" (back AND clear) + "All {State} · N" + that state's cities; single-state pipelines get a flat city list. No list exceeds ~a dozen rows at any scale. Chip face shows OUR short label ("Memphis" / "Tennessee"), amber-50/amber-800 when active, plus a small chevron-down caret when the selection is a state with cities beneath it (hints the picker goes deeper) — an active location filter is glanceable without opening anything. Chip hides entirely when ≤1 location exists. Values `st:TN` / `ci:Memphis|TN` (pipeLocMatch); city/state normalized on build AND match (normCity strips trailing commas — dirty "Austin," data made duplicate rows), persisted via `gc_pipe_loc`, stale values self-clear. Stage-select counts respect the location scope (base = pipeline.filter(pipeLocMatch); location renders first so stale-loc self-clear lands before counts; a stage emptied by the scope self-clears to All). Search blob includes full state names (STATE_NAMES) as the long-tail escape hatch. **Defaults every visit: filter All + sort Recent** (search cleared; view type + location persist). **Sort** — select: Recent (default) / Priority / Name (hidden while grouped). **Views** — list / 2-col grid toggle (persisted) + the Group-by toggle.

**Group by (Notion-style)** — rows-icon toggle, OFF by default, persisted (`gc_pipe_group`): collapsible tinted stage sections (In talks → Pitched → Hold → Lead → Booked → Played → Passed → Dead end), per-stage collapse persisted, search auto-expands, grid disabled while grouped, empty groups never render.

**Attention in the list** — no dots/badges; "Reply waiting" / "Follow up · Nd overdue" right-meta labels (data-driven: needsReply = their last word newer than yours), and Priority sort floats ready-sends + reply-waiting + overdue to the top. The war room (Home) is the primary attention surface.

Each row:
- Building icon in a square chip
- Venue name + small inline stage badge
- Contact · City, State
- Right meta: "Follow up / Nd overdue" (amber) when due, "Reply waiting / Nd ago" (blue) for unanswered replies, else relative time

Tapping a row opens Pipeline detail.

---

## Calendar (Slice D)

Own island-nav item. Month grid (Sun-start), prev/Today/next. **Tap a day to cycle: clear → Available (green) → Busy (red) → clear** (`availability`, migration 015). **Google sync (worker, each poll):** busy days import from the artist's primary calendar (manual paint wins); Hold/Booked entries with a **gig date** (datetime input on the detail view, migration 016) export as events — hold = tentative "HOLD: {venue}", booked = confirmed "Gig: {venue}"; booked past its date auto-flips to Played. Roadmap acknowledged: agenda/“schedule at a glance” view, multi-gig days, recurring blocks (e.g. every Sunday).

---

## Pipeline detail

Full CRM view for one venue. Accessed from My pipeline.

**Back button** — "← Pipeline"

**Header** — amber icon chip + venue name + venue type · city, state · pay range + status badge.

**Stage tracker (tappable — it IS the stage control)** — the happy path: Lead → Pitched → In talks → (Hold, hard-ticket only) → Booked → Played. Completed steps filled amber, current step has amber dot, future steps hollow; tapping any step moves the entry there. Hidden when status is Passed or Dead end (badge carries the state).

**Close-out buttons** — two half-width outlined buttons under the tracker: "Mark passed" (archive icon, warm hover) and "Dead end" (circle-x icon, red hover) — deliberate actions, visually distinct from the progress tracker. When the entry IS in a terminal state, a full Move-stage chip row appears instead so it can be moved back.

**Booked/Played banner** — green banner when status = Booked (trophy) or Played (music icon).

**Contact card** — contact initials avatar, name, title. Email and phone shown below. Email + call icon buttons (right side).

**Section order:** header/tracker/close-out → **Attention card** → Contact → **Notes** → **Draft** → **Conversation**.

**Attention card (top of hierarchy)** — when a response is owed, it's unmissable: bordered card right under the stage controls — "{Contact} replied — your move" (+ AI summary preview) with a **Respond** button that scrolls/focuses the draft, or "Send awaiting your review" with **Review**. Driven by needsReply/sched-ready; disappears once you've replied (worker sees your outbound).

**Notes (edit/delete)** — each note has pencil/trash icons; pencil swaps to an inline input (Enter saves, Esc cancels), trash deletes (migration 014 policies).

**Draft outreach (editable)** — template dropdown (Cold outreach · Follow-up · Full pitch · Check-in) rendering into an editable `textarea`. When the contact has an email, a **Subject** input sits between the dropdown and the body, pre-filled with the default ("{artist} — booking inquiry") and fully editable; it's stored per-entry in `draftSubject[uuid]` (survives re-renders, cleared on schedule), and a blank field falls back to the default on send (`draftSubjectFor`). The custom subject rides along on Send now / Schedule send and the mailto path. Note: replies inside an existing Gmail thread keep "Re: {original}" at send time — the custom subject only applies to new threads. Actions: Send now · Text it · Open form (each shown only when that channel exists) · **Link** · Copy · **Draft/Enhance with AI** (calls the worker's `/ai/draft`, Gemini writes from profile + venue + conversation; fills the textarea for the artist to edit).

**Links in drafts** — drafts speak exactly one markdown-ism: `[text](url)`. The **Link** button captures the textarea selection, reveals an inline bar (URL input + Insert; Enter inserts; bare domains get `https://` prefixed; empty selection labels the link with the URL's hostname), and splices the markdown in at the selection. On send the worker's HTML part renders it as a real `<a>` (bare URLs get linkified too); the plain-text part and every plain-text exit in the app (Copy, Text it, both mailto paths) degrade it to `text (url)`. The AI drafter is prompted to use the syntax for the listen/EPK link (email channel only — SMS drafts stay bare-URL).

**Locked scheduled draft** — once a send is scheduled the editor is replaced by a read-only "Scheduled draft" card: lock header ("Locked — sends exactly as written" / "Awaiting your review"), a dimmed "Subject: …" line, the exact body that will go out with `[text](url)` links rendered as clickable anchors (`mdRich`), and an **Edit draft** button (subject input + textarea + Save/Link/Discard, saves both back to the scheduled message; blank subject falls back to the default). Template dropdown hides while a send is pending.

**Schedule this draft (slice B)** — chips: **Send now** · **Tomorrow 9am (pre-selected default)** · In 3 days · In 7 days · **Custom…** (reveals a datetime-local input). Send now = send_at:now + an authed poke to the worker's `/scheduled/run` (fires in seconds); button morphs to primary "Send now". States rendered in place:
- *scheduled*: card "Scheduled for {when}" + Cancel; notes it cancels itself if the contact replies first, and that auto-send-off means it waits for review
- *ready* (due while auto-send off): amber card "Ready to send" + Open in email / Mark sent / Cancel
- Worker behavior at send time: reply since scheduling ⇒ canceled (+ system activity); auto-send ON ⇒ sent from the artist's Gmail (logged, lead→pitched); OFF ⇒ flips to ready. Live-updates via Realtime.

**Conversation** — the email thread with the venue, both directions prominent as cards: inbound "{Contact} → you" (blue rail) and outbound "You → {Contact}" (amber rail). When the worker's Gemini enrichment ran, the card headline is the **AI one-line summary** with the raw words dimmer beneath; AI intent proposals ("reads like a pass…", "they're talking dates…") appear as grey system lines — proposals only, never auto-moves. Empty state explains emails appear automatically. Live via Realtime.

**Notes** — comments-style section (above Draft, below Contact): private notes with timestamps + the "Add a note" input — an inset rounded pill (bg-secondary, amber on focus) padded inside the card.

---

## Add venue (wizard)

4 steps + success screen. State does not persist between wizard opens.

**Step 1 — Ticket type**
Two large buttons: Soft ticket (glass icon) · Hard ticket (armchair icon). Selection persists to step 2 and determines venue type options.

**Step 2 — Venue details**
- Venue name
- City + State (2-column grid)
- Venue type (select, options cascade from step 1 selection)
  - Soft: Bar / Pub, Coffee shop, Restaurant, Hotel bar, Winery / Brewery, Casino floor, Festival stage, Other
  - Hard: Listening room, Theater, Concert hall, Performing arts center, Music club (ticketed), Other
- "Other" selection spawns a free-text input below the select

**Step 3 — Pay & booking contact**
- Pay low ($) + Pay high ($) (2-column grid)
- Contact name
- Email or phone

**Step 4 — Notes for the collective**
- Typical clientele (single line)
- Notes textarea (multi-line, load-in details, who to name-drop, etc.)

**Step 5 — Success screen**
Centered. Green check icon. "Added to the collective." Two actions: Browse venues (→ Discover) · Add another (→ resets wizard to step 1).

Progress dots shown at top of each step (filled = completed, elongated = current).
Back button on steps 2–4.

---

## Profile

Opened by tapping the avatar in nav. Tapping again closes it (returns to previous screen).

**Hero** — large avatar (amber, amber ring border), display name, email, subhead.

**Completeness bar** — amber fill, 0–100%. Percentage label right-aligned. Counts filled merge tag fields across all editable sections.

**Editable sections** — each has a pencil Edit button. Tapping Edit shows inline form fields; Save/Cancel buttons below. Saving updates the view and re-renders the live template preview.

| Section | Fields |
|---|---|
| Artist identity | Display name, Genre / style, One-liner, Phone |
| Links | Website, EPK URL, Spotify |
| Active markets | Chip list (removable in edit mode, + Add chip) |
| Draw & experience | Draw claim, Typical crowd, Set formats, Notable venues |

Missing fields show an amber warning: "Missing — [consequence]".

**Live template preview** — renders a cold outreach email in real time using current profile field values. Merge tag legend below shows each variable and its current value.

**The collective** — roster of all 7 members. Each row: avatar, name, markets, gig count this year.

**Settings** — Notifications · Home market · Google account · Sign out.
