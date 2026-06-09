# Gig Collective — UX inventory

This document is maintained by Claude. After any session where a screen is added, changed, or removed — update the relevant section. Keep it accurate to what's actually in `gig-collective.html`, not what's planned.

---

## Nav

Sticky, 54px. Always visible.

- **Left:** brand mark (amber rounded square, music icon) + "Gig Collective" wordmark
- **Right:** avatar initials chip (opens/closes profile screen on tap) + hamburger button
- **Hamburger dropdown:** Home · My pipeline · Discover · [divider] · + Add venue (amber)
- Dropdown closes on outside click
- Avatar gets an amber border ring when profile screen is active

---

## Home

Personalized greeting + date-aware subhead ("Good afternoon, Nick").

**Attention strip** — amber background, full width. Shows the single highest-urgency pipeline item (overdue follow-up). Tapping navigates to My pipeline.

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

## My pipeline

Personal CRM. Sorted by urgency: Follow up → Waiting → Outreach → Won → Dead end.

Each row:
- Building icon in a square chip
- Venue name (+ orange alert icon if follow-up overdue)
- Contact · City, State
- Status badge (right-aligned)
- Days since last activity (right-aligned, below badge)

Tapping a row opens Pipeline detail.

---

## Pipeline detail

Full CRM view for one venue. Accessed from My pipeline.

**Back button** — "← My pipeline"

**Header** — amber icon chip + venue name + venue type · city, state · pay range + status badge.

**Stage tracker** — 4 steps: Outreach → Waiting → Follow up → Won. Completed steps filled amber, current step has amber dot, future steps hollow. Hidden when status is Won or Dead end.

**Won banner** — shown instead of stage tracker when status = Won. Green background, trophy icon, confirmed date + pay.

**Contact card** — contact initials avatar, name, title. Email and phone shown below. Email + call icon buttons (right side).

**Outreach templates** — 4 tabs: Cold outreach · Follow-up · Full pitch · Check-in. Each template is dynamically populated from the artist's profile fields (see Profile). Suggested tab is pre-selected based on current status.
- Copy button → copies to clipboard + shows toast
- Open in email → opens mailto: with subject and body pre-filled
- Follow-up reminder chips: 3 days · 7 days · 14 days · 1 month (tap to select)

**Activity log** — timestamped entries, colored dot per action type. Note input at bottom — press Enter to save and prepend to log.

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
