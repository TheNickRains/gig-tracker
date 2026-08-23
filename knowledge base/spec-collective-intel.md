# Spec — Collective Intel Access (free: browse + give-to-get · Pro: every room)

Product-track only. Ships in the commercial fork; Nick's production instance is untouched.

## The rule

The collective's **ledger is free forever**; its **derived intelligence** is the product.

**Free, always** (never gated, never metered):
- Browse Discover: names, city/state, venue type, ticket type, contact presence.
- Add venues (the wizard), edit venues, delete — contribution is sacred.
- Post and read **comments** in full, react, reply. The social loop stays open.
- See **that** wins exist: "3 members have gigged here" with anonymous avatars.
- Everything the user wrote themselves: their venues, their comments, their wins,
  fields they filled. **Never block reading your own data.**

**Intel layer** (per-venue, locked for free until unlocked):
- **Exact pay** — the `pay_range` value on the venue (and, future, aggregates from
  members' reported `gig_pay` across real deals).
- **AI pulse** — the `/ai/venue-pulse` summary ("The collective says").
- **Wins-wall detail** — WHO booked/played the room and when: names, avatars,
  `status`, dates. This is the warm-intro map, the single most Pro-worthy pixel.
- (Future) response-rate / booking-rate stats per venue.

**Pro** = full intel on every venue, no work.
**Free** = full intel on any venue they've **earned** (see next section).

Why hybrid instead of a hard paywall: the venue graph is the moat, and the graph
only compounds if free users keep writing to it. A gate that taxes reading but
*rewards writing* turns the paywall itself into a contribution engine. Worst case
for revenue is best case for the network — a free user "cheats" the gate by…
adding real intel. We take that trade every time. **CRITICAL: contribution
(writing) is never paywalled, in any future iteration of this gate.**

## The unlock — give-to-get, per venue

A free artist unlocks ONE venue's full intel by contributing real intel **on that
venue**. Any one of:

1. **A qualifying comment** — body ≥ **120 characters** (roughly two sentences)
   AND not byte-identical to any prior comment by the same artist (any venue).
   Root or reply both count; substance is substance.
2. **A win** — a `venue_wins` row (auto-posted when their pipeline deal on that
   venue hits Booked/Played, per the existing upsert). Inherently structured, and
   reputationally staked: it renders on the wall under their name.
3. **Filling empty fields** — an edit that takes ≥1 of the high-value fields
   (`pay_range`, booking contact, `booking_form_url`) or ≥2 of any other venue
   fields from empty → filled.
4. **Being the venue's creator** — `venues.created_by` auto-unlocks it. They gave
   first; the wizard's steps 3–4 *are* the intel.

**Defending the 120-char bar** (what stops "nice room 👍" spam-to-unlock): it is a
v1 heuristic, chosen because it's **enforceable in a trigger with zero moving
parts** — no AI moderation, no review queue, no async state. What makes it good
enough: the spam is *public and attributed* — a junk comment sits on the wall
under your name and avatar, downvotable by the room's actual players (reactions
already exist). The cost of gaming one venue is 120 characters of visible
self-embarrassment, per venue, forever. The dedupe check kills copy-paste farming.
If gaming shows up at scale, the tuning knobs are threshold and reaction-weighted
review — not a redesign. Do NOT build AI moderation for v1.

**Unlocks are permanent.** Deleting the qualifying comment, the win, or even the
whole deal does not revoke the unlock. No clawbacks, ever — gates block the next
convenience, never take hostages.

## Enforcement — the intel never reaches an unentitled client

Blur is theater if the data is in the DOM. The gated payloads must not leave the
server for locked viewers.

**Table:**

```sql
create table venue_unlocks (
  artist_id uuid not null references artists(id) on delete cascade,
  venue_id  uuid not null references venues(id) on delete cascade,
  reason    text not null check (reason in
              ('creator','comment','win','fields','granted')),
  created_at timestamptz not null default now(),
  primary key (artist_id, venue_id)
);
-- RLS: select where artist_id = auth.uid(). NO insert/update/delete policies —
-- rows are written only by security-definer triggers. The client cannot self-grant.
alter table venue_unlocks enable row level security;
```

**Grant triggers** (security definer, `on conflict do nothing`):
- after insert on `venue_comments` → if `char_length(trim(body)) >= 120` and no
  identical prior body by that artist → grant `('comment')`.
- after insert on `venue_wins` → grant `('win')`.
- after insert on `venues` → grant `('creator')` for `created_by`. Backfill
  existing creators in the migration.
- after update on `venues` → count fields going null/''→filled; grant `('fields')`
  per rule 3, attributed to `auth.uid()`.

**Read enforcement**, per surface:
- **Pulse** — already a worker endpoint (`POST /ai/venue-pulse`, JWT). Worker
  checks `artists.plan = 'pro'` or a `venue_unlocks` row before generating;
  otherwise `403 {error:'INTEL_LOCKED'}`. Cheapest gate in the whole system.
- **Wins detail** — `venue_wins` select RLS becomes:
  `artist_id = auth.uid() or has_intel(auth.uid(), venue_id)` where `has_intel`
  is one SQL function (pro-or-unlocked — single source of truth, mirrors
  `plan_scheduled_send_limit`'s role). Free counts come from a security-definer
  view `venue_wins_counts(venue_id, wins int)` — free users see the number, never
  the names. (Home-feed queries that select `venue_wins` for the activity feed
  switch to the counts view for locked venues.)
- **Exact pay** — column privilege, not RLS:
  `revoke select (pay_range) on venues from authenticated`, add
  `has_pay boolean generated always as (pay_range is not null) stored` (grantable,
  drives lock-vs-empty UI). Entitled reads go through one RPC:

```sql
-- security definer; returns full intel when entitled, else the shape of the gate
create function get_venue_intel(p_venue uuid) returns jsonb ...
-- entitled: { unlocked: true,  pay_range, wins: [{author_name, avatar_url, status, created_at}] }
-- locked:   { unlocked: false, has_pay, wins_count, comment_count }
```

  `loadVenues()`/`loadVenueComments()` stop selecting `pay_range`/`venue_wins`
  raw and call the RPC on venue-detail open. One round trip, one arbiter.

App maps `INTEL_LOCKED` / locked RPC shapes to the shared gate rendering (never a
raw error). Client checks are UX only.

## UX surfaces (the gate renders in place, with the venue's own gravity)

1. **Venue detail — locked state** (`openVenueDetail`): the Collective intel
   section keeps its exact layout; the gated pieces render redacted *in place*:
   - **Pay row**: label intact, value `$ ···–···` blurred with a small lock glyph
     (only when `has_pay` — see edge cases).
   - **Wins wall**: "Gigged here:" + `wins_count` generic blurred avatar circles.
     The count is real; the faces are the product.
   - **Pulse card**: `pc-label` reads "The collective says · {comment_count}
     comments distilled", body is fixed blurred skeleton lines (no real text ever
     ships to the client).
   - One CTA card under the section header, both paths, contribution first:
     > **Share what you know about this room to unlock it — or go Pro for every room.**
     > [ Add your intel ]  [ Go Pro — every room, no homework ]
     "Add your intel" focuses the existing composer and sets its placeholder to
     "Two sentences of real intel unlocks this room…".
2. **Comments are never blurred.** Free users read the whole thread — the thread
   is what makes them *want* the distilled layer above it.
3. **Unlock moment**: on a qualifying contribution, the client re-calls
   `get_venue_intel`; the blur resolves in place — pay, faces, pulse — with a
   toast: "Unlocked — {venue} owes you one." The reveal happening *live over the
   gate they were just staring at* is the whole show; never route away.
4. **Discover cards**: locked venues with `has_pay` show `$ ···` + lock glyph in
   the pay tag slot (grid needs no RPC — `has_pay` is a plain column). Entitled
   venues show pay as today. A tiny "Unlocked" tick on earned venues makes the
   collection visible — earned unlocks should feel like property.
5. **Sub-bar (comment posted but < 120 chars)**: no error, no rejection — the
   comment posts normally (contribution is never blocked), and a quiet inline
   line under the composer notes "A little more detail unlocks this room's full
   intel — {n} more characters."

## Conversion analytics (shared `gate_events`, day one)

Events (artist_id, event, context jsonb — `{venue_id, reason?}`):
`intel_gate_seen` · `intel_add_intel_click` · `intel_unlocked_contrib` (reason in
context) · `intel_upgrade_click` · `intel_empty_state_seen` · `intel_subbar_shown`.

North star: `intel_gate_seen → intel_upgrade_click` rate, with
`intel_gate_seen → intel_unlocked_contrib` tracked as a *success metric, not a
leak*. **Guardrail (the moat metric, ranked above revenue): comments-per-venue
and fields-filled rates must be flat-or-up after the gate ships.** If contribution
drops, the gate is strangling the network — loosen it (first knob: make wins-wall
count-with-names free, keep pay + pulse gated) before touching price.

## Edge cases

- **Thin venues — never sell blurred nothing.** If a locked venue has no pay
  (`has_pay = false`), fewer than 2 comments (pulse's existing floor), and zero
  wins: render NO gate. The existing empty state carries it — "No intel yet —
  first to play it, first to post." Gate each piece independently: a venue with
  pay but no wins blurs only the pay row.
- **Creator auto-unlock** — trigger + migration backfill from `venues.created_by`.
- **Downgrade** (Pro → free): keeps every *earned* unlock (`venue_unlocks` rows
  are plan-independent). Venues they merely viewed as Pro re-lock — viewing was
  the rental; contributing was the purchase.
- **Edit-form leak**: anyone may edit any venue (existing RLS), and Edit prefills
  `pay_range`. The column revoke closes the read leak automatically (select
  fails), but Edit must then: hide the pay input when `has_pay` and locked (else
  saving blank would *clear* pay — ux.md's blank-clears rule); show it when empty
  (filling it is unlock path 3). A trigger rejects a non-entitled update that
  changes an existing `pay_range`.
- **Deleted contribution**: unlock survives (permanent). Accepted: post-120-chars,
  unlock, delete. It's public while it lives, and it's one venue.
- **`pulseCache` / realtime**: pulse cache is per-session and only ever filled
  post-entitlement, fine as is. The realtime handlers on `venue_comments` /
  `venue_wins` re-render via the same entitled paths — no bypass.
- **Own data everywhere**: own win visible via the `artist_id = auth.uid()` RLS
  arm; own comments were never gated; venues you created are unlocked by trigger.
- **Race** (two tabs, comment + gate): grants are idempotent
  (`on conflict do nothing`); RPC re-check is the arbiter.

## Effort (product fork)

| Piece | Size |
|---|---|
| `venue_unlocks` + grant triggers + creator backfill + `has_intel` fn | ~1 day |
| Pay column revoke, `has_pay`, `get_venue_intel` RPC, wins RLS + counts view, client query rework | ~1.5 days |
| In-place gate rendering (detail blurs, CTA card, Discover tags, unlock reveal) | ~1.5 days |
| Edit-form pay handling + sub-bar nudge | ~half day |
| Worker pulse entitlement check | ~quarter day |
| `gate_events` logging | ~quarter day |
| **Total** | **~5 days** |

Dependencies: `artists.plan` + `gate_events` + gate rendering from the scheduled-
sends spec (shared entitlement primitives). This is the spec where the freemium
line and the moat meet: every tuning decision resolves in the network's favor,
because the venue graph outlives any single conversion rate.
