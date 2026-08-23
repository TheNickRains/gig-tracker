# Spec — Auto-Follow-Up Engine (free: nudges only · Pro: the pipeline follows up by itself)

Product-track only. Ships in the commercial fork; Nick's production instance is untouched.
Hard gate, not a meter — there is no free quota of automation.

## The rule

**Pro:** when a deal trips the follow-up threshold (Pitched, ≥7 quiet days — the exact
`followupDue()` predicate the war room already uses, including snooze/dismiss markers),
the worker drafts a follow-up in the artist's voice (same Gemini path as `/ai/draft`
with the "they haven't replied" objective + tone profile) and queues it as a
`scheduled_messages` row for the next 9am. Auto-send ON ⇒ it fires unattended;
OFF ⇒ it flips to `ready` and lands as "Send awaiting your review" — the existing
review flow, no new UI. The whole pipeline follows up by itself.

**Free:** keeps the entire follow-up *ledger* — "Follow-up due · Nd quiet" war-room
rows, Snooze, permanent dismiss, the Pipeline "Nd overdue" chip. Nothing changes.
What free never gets is the verb: no draft is written, no send is queued, ever.
Free = you see the debt; Pro = the debt pays itself.

Why a hard gate: the meter version ("2 auto-follow-ups/mo") teaches users to ration
the assistant. The point of an engine is that it's *always on* — a sometimes-engine
is worse than a nudge list. Cap verbs, yes, but this verb is binary.

## Enforcement — the worker just doesn't run it

Server-side by construction: the engine lives in the worker's `tick()` loop (a new
`autoFollowups(artistId)` step after `pollArtist`), and the per-artist iteration
starts by reading the plan:

```js
const a = (await sGet(`artists?id=eq.${c.artist_id}&select=plan,allow_auto_send,auto_followups`))[0];
if (a.plan !== 'pro' || a.auto_followups === false) return; // free: engine never spins
```

No trigger needed — there is no client write to guard. A free client can't forge an
engine send because engine rows are worker-authored (`origin='engine'`, service key);
the existing sends-cap trigger still counts them, which is fine (see below).

Selection query (mirrors `followupDue()` server-side): entries with
`status='pitched'`, `last_activity_at <= now()-7d`, contact has email, no
`scheduled_messages` row in `scheduled/ready`, and no `✓ Follow-up snoozed` /
`✓ Follow-up dismissed` marker activity newer than the quiet window (snooze restarts
the 7-day clock for the engine exactly as it does for the nag — one clock, two
consumers). New columns: `scheduled_messages.origin text not null default 'user'`
(`user | engine`), `artists.auto_followups bool not null default true` (Pro settings
toggle, next to auto-send).

**Review gate:** `processScheduled()` today fires every scheduled row because "every
scheduled message is human intention" (`allow_auto_send is reserved for future
agent-initiated mail` — that future is now). Engine rows are the reserved case:
`origin='engine'` + auto-send OFF ⇒ flip to `ready` instead of sending.

**Sends-cap interaction:** engine rows only exist for Pro artists, whose slot limit
is `null` (unlimited) — no conflict, stated explicitly. On **downgrade** with engine
sends pending: grandfathered, they fire (same never-take-hostages rule as the cap
spec), but they DO occupy the free active-slot count until they clear, and the engine
generates nothing new from the very next tick.

**Consecutive-nudge stop:** the engine sends at most **2** consecutive auto-follow-ups
per deal with no inbound in between (each send resets `last_activity_at`, so #2 fires
~7d after #1). After that the deal returns to the ordinary human "Follow-up due" row —
an engine that nags a dead thread forever trains venues to ignore the artist.

## UX surfaces — "the engine runs dry"

1. **Ghost rows (free, the in-place sell):** the app already computes `followupDue()`
   per deal; for free users it ALSO renders what the engine would have done — locked
   rows at the **bottom of the Needs-you card**, below every real row, above the
   "+N more" overflow row: dimmed, amber ⚡ icon chip, lock glyph right where the
   chevron goes —
   > ⚡ Auto-follow-up would have fired for **The Lava Room** yesterday — **Pro**
   ("yesterday" = quiet-days − 7). **Cap: 2 ghost rows**, oldest-quiet first; a third+
   qualifying deal folds into row two: "…and 3 more waiting on the engine." Ghosts are
   NOT counted in the "Needs you" count pill (the pill is trusted work, never ads),
   are skipped by select mode, and tap ⇒ gate modal.
2. **Gate modal** (shared component): their own data, not a pricing table:
   > **Your pipeline is waiting on you. Pro's isn't.**
   > ⚡ The Lava Room — 8d quiet, draft would've gone out Tue 9am
   > [ Go Pro — the pipeline follows up itself ]  [ Write it myself ]
   "Write it myself" deep-links to the deal's draft composer — the free path stays
   dignified and one tap away.
3. **Ghost dismissal:** quiet × per row, **per-device localStorage** (feed-dismiss
   pattern, `gc_ghost_fu`) — a sell never needs a DB marker. A dismissed ghost stays
   gone for that deal's current quiet cycle; a fresh outbound that later goes quiet
   again re-arms it. Snoozing/dismissing the deal's REAL follow-up row also suppresses
   its ghost (the engine would honor the snooze too — the ghost may never claim the
   engine would do something it wouldn't).
4. **Pro receipt:** when an engine send fires, the activity log gets
   "⚡ Auto-follow-up sent — 7d quiet" and the scheduled-sends queue shows engine rows
   with a small ⚡ prefix. Pro users should *see* the engine working, or churn.

## Conversion analytics (shared `gate_events`)

`ghost_fu_seen` (per render-session, per deal) · `ghost_fu_click` · `ghost_fu_dismiss`
· `fu_upgrade_click` · `fu_write_myself` · and on Pro, `engine_fired` (context:
entry, consecutive-count). North star: `ghost_fu_click → fu_upgrade_click`. Guardrail:
`fu_write_myself` is a GOOD outcome (the ghost worked as a nudge); high
`ghost_fu_dismiss` with low clicks means the copy reads as spam — tune copy before
touching the 2-row cap.

## Edge cases

- **Terminal stages:** `followupDue()` requires `status='pitched'` — Passed/Dead/Played
  never nag AND never ghost, on both client and worker, by the same predicate. Never
  ghost-sell on a corpse.
- **Reply-arrived auto-cancel:** engine rows are `human:false`, so the existing
  cancel-if-they-replied gate in `processScheduled()` covers them verbatim. Cancel
  reason stays "They replied first"; the reply itself becomes a real war-room row.
- **Manual follow-up (free):** a fresh outbound resets `last_activity_at` ⇒
  `followupDue()` false ⇒ real row AND ghost both clear. No special handling.
- **Snooze/dismiss parity:** worker reads the same marker activities the client writes
  (`✓ Follow-up snoozed` / `✓ Follow-up dismissed`); a permanent dismiss kills the
  engine for that deal until a new outbound re-arms, identical to the nag.
- **Draft failure:** Gemini errors ⇒ log, skip, retry next tick (10-min interval);
  never insert an empty-body send. Gmail disconnected ⇒ engine skips the artist
  entirely (nothing to send from) — the ghost should not render either (`gmail_connected`
  is already client-visible).
- **Upgrade mid-cycle:** next tick picks up every currently-due deal — up to N drafts
  queued at once is the *demo*, not a bug; the review flow (auto-send starts OFF)
  makes it safe.

## Effort (product fork)

| Piece | Size |
|---|---|
| `origin` + `auto_followups` columns, plan read in tick | ~quarter day |
| `autoFollowups()` worker step (selection + Gemini + queue + 2-nudge stop) | ~1 day |
| Review-gate wiring for `origin='engine'` in `processScheduled` | ~quarter day |
| Ghost rows + gate modal reuse + localStorage dismissal | ~1 day |
| `gate_events` logging + ⚡ receipts | ~half day |
| **Total** | **~3 days** |

Dependencies: the entitlement primitives from the scheduled-sends-cap spec
(`artists.plan`, `gate_events`, shared gate modal). This is the flagship Pro feature —
the cap sells slots, but the engine is the reason "Pro = the assistant" is true.
