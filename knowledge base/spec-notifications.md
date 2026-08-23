# Spec — Reply Notifications (free: daily digest · Pro: instant push)

Product-track only. Ships in the commercial fork; Nick's production instance is untouched.

## The rule

A **free** artist gets **one push per day**: a morning digest summarizing everything
that happened — replies received, sends that fired, bounces, follow-ups now due.
A **Pro** artist gets what the worker does today: **instant push per event** —
reply landed (`"You've got mail — {contact} replied"`), send fired (`"Sent ✓ {to}"`),
bounce (`"Email bounced ⚠️"`), new lead. The four existing `notify()` call sites in
`worker/index.js` ARE the Pro product, unchanged; the work is building the free tier
*down* from it.

Why this is honest: speed-to-respond genuinely wins gigs — the artist who answers in
an hour books the room the one who answers tomorrow doesn't. "Know the moment they
reply" is real Pro value that monetizes the app's best retention feature **without
removing it**: free users still learn about every reply, every fired send — just
batched. Free = the complete ledger, delivered daily. Pro = the assistant tapping
your shoulder. Push-only, no digest email: push infra exists (sw.js + web-push +
`push_subscriptions`), and we never email uninvited — the war room is the fallback.

**Timezone**: `artists` has no tz column today. Add `artists.tz text` and capture
`Intl.DateTimeFormat().resolvedOptions().timeZone` in the app — patched alongside the
`push_subscriptions` upsert at subscribe time, refreshed on every app boot (browser is
the source of truth; it follows the artist on tour). Digest fires at **8:00 AM local**.
`tz` null (subscribed before this shipped) → fall back to 14:00 UTC (morning across
the US) until their next app open backfills it.

## Enforcement — the worker is the wall

The worker is the **only** process holding VAPID keys and the only push sender —
enforcement is inherently server-side with no DB trigger needed (nothing a client
could insert bypasses it; unsubscribing/resubscribing changes endpoints, not plan).
One choke point gates all four event types at once:

```js
async function notify(artistId, title, body, url) {
  if (!VAPID_PUB) return;
  const plan = await planFor(artistId);          // per-tick cache of artists.plan
  if (plan !== "pro") return;                    // event is already persisted in
                                                 // activities / scheduled_messages —
                                                 // tomorrow's digest reads it there
  /* existing fanout to push_subscriptions unchanged */
}
```

**No digest_queue table.** The digest **queries existing tables at send time**:
replies = `activities` `kind=email_in` in the window (embed `pipeline_entries` for
artist + venue/contact); sends fired = `scheduled_messages` `status=sent`,
`sent_at` in window (failures via their system-activity rows, same as bounces);
follow-ups due = the war room's own rule (Pitched ≥7d quiet, minus snooze/dismiss
markers). Why: every event already lives in a timestamped table; a queue duplicates
state and drifts (canceled sends, dismissed follow-ups, deleted entries), while
querying at send time makes the digest reflect current truth by construction. The
only new state is scheduling bookkeeping on `artists`: `tz` + `digest_sent_at
timestamptz`.

**Scheduler**: `processDigests()` joins `tick()` (runs every `POLL_MINUTES`, before
`processScheduled`). For each free artist with ≥1 push subscription: fire when local
hour ≥ 8 (Node `Intl` with their tz — DST comes free) AND `digest_sent_at` is null or
>20h old; window = since `digest_sent_at` (capped at 24h back); stamp `digest_sent_at`
on send. Missed ticks self-heal — the next tick past 8 AM fires it.

**Downgrade rule:** Pro→free keeps every `push_subscriptions` row — subscriptions
are the artist's, not the plan's. `notify()` checks plan at send time, so the same
subs silently start receiving the digest instead. Nothing is canceled or deleted.

## UX surfaces

1. **Settings → Notifications** splits into two rows when free:
   `Daily digest · 8:00 AM ✓` (the existing toggle, relabeled) and a locked row
   `⚡ Instant — the moment they reply · Pro`. Tapping the locked row opens the
   shared gate modal with *their own data*, not a pricing table:
   > **Shannon replied yesterday at 9:14 AM.**
   > Your digest told you at 8:00 this morning — 22 hours later.
   > [ Go Pro — know the moment it lands ]  [ Keep the digest ]
2. **The digest push** — title: `☀️ While you were out — 2 replies, 1 send fired`.
   Body leads with the newest reply and **the conversion line rides inside it**:
   `Shannon (The Lava Room) replied yesterday 9:14 AM — Pro would have pinged you
   right then. · Follow-up due: Mercury Lounge`. Copy pattern:
   `{contact} ({venue}) replied {relative} — Pro would have pinged you at {time}.`
   Every digest containing a reply is a sales impression built from the user's own
   pipeline. Digests **without** a reply carry no Pro line — teasing over a fired
   send is noise, and noise kills the channel.
3. **Tap-through** — digest `url` is `/app#home?src=digest`: the war room already
   renders every item the digest summarized (sw.js `notificationclick` focuses/
   navigates as-is). When the digest contained a reply, the war room shows a one-time
   dismissible line under Needs-you: `Pro pings you the moment a reply lands →`
   (opens the same gate modal).
4. **Pro** — current behavior verbatim: four instant push types, existing titles,
   deep links to `/app#entry/{id}`. Zero new Pro surface to build.

## Conversion analytics

Rows in the shared `gate_events` (artist_id, event, context jsonb, created_at):
`digest_sent` (counts in context) · `digest_reply_tease` (entry_id, hours_late) ·
`digest_open` (app logs on `?src=digest`) · `push_gate_seen` · `push_upgrade_click`.
North star: `digest_reply_tease → push_upgrade_click`, segmented by `hours_late` —
the hypothesis is that bigger gaps convert harder, and the data proves or kills it.
Guardrail: `digest_sent → digest_open` rate is the channel's pulse; if opens decay,
the digest is noise and the 8 AM slot or copy needs tuning before anything else.

## Edge cases

- **Notifications disabled entirely** (no `push_subscriptions` rows): `notify()`
  already no-ops; `processDigests()` skips the artist (subscription check is first).
  No email fallback — the war room is the fallback surface. Don't email uninvited.
- **Multiple replies, same deal, same day**: collapse to one line —
  `Shannon (The Lava Room) replied ×3` — with the tease timed to the *first* reply
  (that's the true hours-late number).
- **Quiet day** (no replies, no sends, no follow-ups due): **no digest at all**.
  Silence beats noise; an empty "nothing happened" push trains the swipe-away reflex
  that kills surface #2. `digest_sent_at` still stamps so the window stays sane.
- **Dead endpoints**: `notify()` already prunes 404/410 subs; `processDigests()`
  reuses the same fanout, so a fully-pruned artist naturally drops out of digests.
- **Pro downgrade**: covered above — subs persist, routing flips at send time.
- **iOS PWA**: web push on iOS requires home-screen install (Add to Home Screen)
  before `Notification.requestPermission` can succeed. Noted, not solved here —
  the settings row's disabled state already handles unsupported contexts
  (`!('PushManager' in window)` → toggle disabled).
- **Timezone unknown**: 14:00 UTC fallback until next app open; worst case a few
  odd-hour digests, never a missed one.

## Effort (product fork)

| Piece | Size |
|---|---|
| `artists.tz` + `digest_sent_at` columns, app-side tz capture on subscribe/boot | ~half day |
| `notify()` plan gate + per-tick plan cache | ~half day |
| `processDigests()`: scheduler, window queries, collapse, copy assembly | ~1 day |
| Settings split row + gate modal reuse + war-room tease line + `gate_events` calls | ~1 day |
| **Total** | **~3 days** |

Dependencies: `artists.plan` + `gate_events` + the shared gate modal from the
scheduled-sends-cap spec (the entitlement proving ground) — nothing on Stripe.
This gate is the gentlest of the set: it never blocks an action, only delays a
ping — which is exactly why the tease inside the digest has to carry the sell.
