# Gig Collective — UX inventory

This document is maintained by Claude. After any session where a screen is added, changed, or removed — update the relevant section. Keep it accurate to what's actually in `gig-collective.html`, not what's planned.

---

## Nav & routing

Sticky, 54px. Always visible.

- **Left:** brand mark + "Gig Collective" wordmark — **tappable, goes Home**
- **Right:** hamburger button, then avatar chip outermost (photo if set, else initials — opens Profile)
- **Hamburger dropdown:** Discover · Pipeline · Settings · [divider] · **Add venue as a filled amber button** (no Home/Profile items — brand and avatar cover those)
- Dropdown closes on outside click
- Avatar gets an amber border ring when profile screen is active

**Desktop island** (UX-agent spec'd) — at ≥600px in a browser (NOT PWA standalone), `body` switches to `--bg-page` (darker outside surface, light `#dddbd5` / dark `#0c0b0a`) and the 480px `.app` column gets hairline side borders, bottom-only 20px radius, and a soft shadow. Phone + standalone are pixel-identical to before; scroll stays on the page; `min-height:100vh` keeps short screens from bleeding.

**Routing** — every screen is a URL hash: `#home #pipeline #discover #add #profile #settings`, pipeline detail = `#entry/<uuid>`, venue detail = `#venue/<uuid>`. Refresh restores the screen (deep routes wait for data via a pending-route retry), browser back/forward work, and detail links are shareable within the app.

---

## Home

Personalized greeting + date-aware subhead ("Good afternoon, Nick").

**Attention strip** — amber background, full width. Shows the single highest-urgency pipeline item (Pitched ≥ 7 days with no reply = follow-up due). Tapping navigates to My pipeline.

**Stats row** — 3 cards: Active leads (personal) · Booked this year (personal) · Collective wins (shared, this month).

**Collective activity feed** — card with flush padding. Each entry: member avatar (colored initials), action description, timestamp + market. Most recent first. Members have consistent avatar colors across the app:
- NR (Nick): amber
- SJ (Sammy J): green
- AC (Aaron Cook): gray
- DL (Derick L): blue
- CV (Cody Voyer): pink
- LN (Logan N): teal
- LR (Luc Roach): purple

---

## Discover

Master venue list. Shared across all artists. Written to by the collective's adds and updates.

**Filters** — inline row, 3 dropdowns:
1. State (selecting a state populates cities)
2. City (hierarchical — only shows cities for selected state)
3. Ticket type (All / Hard / Soft)

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

**Search** — always-visible input above the list; matches venue/contact/city **plus stage names and the deal's notes + conversation text**. **Stage filter chips** — horizontally scrollable pill row (All + each stage present, with counts), **tinted with each stage's colors** for instant differentiation; single-select, composes with search. **Filter + search reset to All/empty on every visit** (deliberate). **Sort** — header select: Priority (default) / Recent / Name. **View toggle** — list or 2-col grid cards (compact: venue, contact, badge, time); choice persists in localStorage.

Each row:
- Building icon in a square chip
- Venue name + small inline stage badge
- Contact · City, State
- Right meta: "Follow up / Nd overdue" (amber) when due, "Reply waiting / Nd ago" (blue) for unanswered replies, else relative time

Tapping a row opens Pipeline detail.

---

## Pipeline detail

Full CRM view for one venue. Accessed from My pipeline.

**Back button** — "← Pipeline"

**Header** — amber icon chip + venue name + venue type · city, state · pay range + status badge.

**Stage tracker (tappable — it IS the stage control)** — the happy path: Lead → Pitched → In talks → (Hold, hard-ticket only) → Booked → Played. Completed steps filled amber, current step has amber dot, future steps hollow; tapping any step moves the entry there. Hidden when status is Passed or Dead end (badge carries the state).

**Close-out buttons** — two half-width outlined buttons under the tracker: "Mark passed" (archive icon, warm hover) and "Dead end" (circle-x icon, red hover) — deliberate actions, visually distinct from the progress tracker. When the entry IS in a terminal state, a full Move-stage chip row appears instead so it can be moved back.

**Booked/Played banner** — green banner when status = Booked (trophy) or Played (music icon).

**Contact card** — contact initials avatar, name, title. Email and phone shown below. Email + call icon buttons (right side).

**Section order:** header/tracker/close-out → Contact → **Notes** → **Draft** → **Conversation**.

**Draft outreach (editable)** — 4 tabs: Cold outreach · Follow-up · Full pitch · Check-in, rendering into an editable `textarea`. Suggested tab pre-selected from stage. Actions: Copy · Open in email · **Draft with AI** (calls the worker's `/ai/draft`, Gemini writes from profile + venue + conversation; fills the textarea for the artist to edit).

**Locked scheduled draft** — once a send is scheduled the editor is replaced by a read-only "Scheduled draft" card: lock header ("Locked — sends exactly as written" / "Awaiting your review"), the exact body that will go out, and an **Edit draft** button (textarea + Save/Discard, saves back to the scheduled message). Template tabs hide while a send is pending.

**Schedule this draft (slice B)** — chips: Tomorrow 9am · In 3 days · In 7 days → "Schedule send" inserts a `scheduled_messages` row. States rendered in place:
- *scheduled*: card "Scheduled for {when}" + Cancel; notes it cancels itself if the contact replies first, and that auto-send-off means it waits for review
- *ready* (due while auto-send off): amber card "Ready to send" + Open in email / Mark sent / Cancel
- Worker behavior at send time: reply since scheduling ⇒ canceled (+ system activity); auto-send ON ⇒ sent from the artist's Gmail (logged, lead→pitched); OFF ⇒ flips to ready. Live-updates via Realtime.

**Conversation** — the email thread with the venue, both directions prominent as cards: inbound "{Contact} → you" (blue rail) and outbound "You → {Contact}" (amber rail). When the worker's Gemini enrichment ran, the card headline is the **AI one-line summary** with the raw words dimmer beneath; AI intent proposals ("reads like a pass…", "they're talking dates…") appear as grey system lines — proposals only, never auto-moves. Empty state explains emails appear automatically. Live via Realtime.

**Notes** — separate comments-style section below Conversation: your private notes with timestamps + the "Add a note" input (Enter to save).

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
