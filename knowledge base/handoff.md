# Gig Collective — Claude Handoff

## The problem being solved

Working musicians don't share booking intelligence. Contacts get texted privately, pay rates stay siloed, and no one knows what another artist already tried. The existing Google Sheet (8 tabs, 25 columns flat) had zero adoption because it didn't feel like anyone's own tool.

**Root cause:** the sheet was a shared obligation, not a personal asset.

**Solution principle:** every action a user takes for themselves feeds and improves the collective. Individual pipelines are the input. Shared venue intelligence is the output.

---

## Core architecture — three data layers

### 1. Institution (permanent)
The venue itself. Changes slowly.
- Name, city, state
- Ticket type: **soft** (bar, restaurant, hotel, winery) or **hard** (listening room, theater, ticketed club)
- Venue type (cascades from ticket type — see wizard)
- Pay range (verified by collective over time)
- Typical clientele / audience
- Notes from the collective

### 2. Contact (semi-permanent, child of Institution)
The human. Changes more often than the venue, less often than a booking.
- Name, title, email, phone
- Verified by: which artist last confirmed this contact is current
- Multiple contacts can exist per institution

### 3. Pipeline entry (ephemeral, child of Contact + Artist)
One artist's active pursuit of one venue.
- Status: Outreach → Waiting → Follow up → Won → Dead end
- Activity log (timestamped notes)
- Follow-up reminder date
- Template used for outreach

**No conflict model.** Multiple artists can work the same venue simultaneously. This is a feature — parallel canvassing generates more verified data, faster.

---

## Screens

See `ux.md` — maintained dynamically as the prototype evolves.

---

## Roster
Nick Rains plus a small invite-only roster of working musicians (beta testers — names omitted).

---

## Planned real stack (not yet built)

| Layer | Choice | Reason |
|---|---|---|
| Frontend | React | Component reuse, state management |
| Auth | Google OAuth | One-tap login, artists already have Google accounts |
| Data | Google Sheets API | Existing sheet, no new infra, artists can also edit directly |
| Hosting | Vercel | Free tier, instant deploys |

The Google Sheet is the source of truth for now. The app reads and writes to it via the Sheets API. When the collective adds a venue, it appends to the master sheet. When they update a contact or pay rate, it updates the relevant row.

---

## Key principles — do not violate

- **Every action benefits the whole.** Personal pipeline updates append to collective intelligence. Never treat individual and collective as separate concerns.
- **Artists are not tech-forward.** If it requires explanation, it's too complex. Default to the simplest interaction that achieves the goal.
- **No burning bridges.** Templates are crafted to be respectful of bookers' time. No spam mechanics.
- **Conflict is not a bug.** Multiple artists can canvass the same venue. More canvassing = more verified data.
- **The institution is permanent; the contact is not.** Build data models and UI around this reality.
