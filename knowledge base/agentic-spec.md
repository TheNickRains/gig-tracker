# Gig Collective — Agentic spec

## /goal
An **intelligent gig-booking personal assistant**. Reduce the artist's thought and
friction: the app drafts the right outreach with the right context at the right time,
manages the pipeline by conversation state, and schedules around real availability.

## Committed architecture: outreach-through-app
Chosen because every feature below assumes the app both **sends** and **sees replies**.
- **Send** outreach via Resend (verified domain), with a per-entry reply address
  `r+<pipeline_entry_id>@reply.nicholasrains.com`.
- **Receive** via **Cloudflare Email Routing** (the domain already lives on Cloudflare)
  → a webhook → match the reply to its pipeline entry by the reply address → log the
  activity, advance the stage, and forward a copy to the artist's normal inbox.
- **No Gmail scopes, no per-user Apps Script, no Google restricted-scope verification**
  (that wall is why we're not reading inboxes directly).
- Tradeoff: tracks threads that **started in the app** — which is the intended flow
  (enter venue → send from app → tracked). The earlier `apps-script/` agent is shelved.

## The three features, mapped onto that substrate

### 1. Agentic outreach  (agentic > dynamic > static)
Claude composes each message from everything on record — profile, venue ticket-type +
details, contact, stage, notes, and the thread so far — instead of filling a fixed
template. **Tone-learning loop:** store the *proposed* draft and the *sent* version; the
diff is the per-user tone signal, fed back as few-shot examples so it sounds more like
the artist over time. Bad/missing profile data degrades gracefully instead of leaking
`[draw claim]` into the email.
- *Needs:* Anthropic API key (phase 2). The substrate (compose-in-app + capture the
  diff) ships now using the current dynamic templates as the "proposed" draft.

### 2. Intelligent pipeline  (stateful, conversation-driven)
- Activity log ingests **emails** (via reply routing) and **manual call logs**.
- Stage advances on **events**: sent → outreach; reply → waiting; quiet N days → follow-up;
  artist confirms → won/dead. The pipeline is a small state machine driven by the
  conversation, not manual dragging.
- **Scheduled follow-ups:** edit + **lock** the follow-up text, save, and **schedule the
  send**. *Intelligent disconnect:* if a reply arrives before the scheduled time, the
  queued send auto-cancels (no redundant nudge).
- *Needs:* a scheduler/worker + a `scheduled_messages` table.

### 3. Calendar  (new)
- Availability view; **won** gigs auto-populate; artist marks available/blackout dates.
- The assistant checks conflicts and **proposes dates** when a booker asks.
- *v1:* native in-app calendar. Google Calendar two-way sync is a later add (Calendar is
  a "sensitive" OAuth scope — lighter than Gmail's restricted tier, but still deferred).
  Date-proposal intelligence is phase 2 (Claude).

## Build sequence
| Slice | What | Needs API key? |
|---|---|---|
| **A — Send + Receive substrate** (keystone) | Compose/send via Resend + Cloudflare reply routing → pipeline becomes conversation-driven; captures sent-vs-proposed | No |
| **B — Scheduled follow-ups** | `scheduled_messages` + worker; intelligent disconnect on reply | No |
| **C — Agentic generation + tone learning** | Swap template generation to Claude; few-shot from the sent/proposed diffs | **Yes** |
| **D — Calendar** | Availability model + UI (now); conflict-check + date proposals (phase 2) | UI no / proposals yes |

A is the foundation B and C build on; D can run in parallel.

## Open decisions
1. **Sending identity (roster):** send as `<Artist Name> <booking@send.nicholasrains.com>`
   with the reply address routing back to the app, then forwarded to the artist's inbox.
   Bookers see the artist's name; the from-domain is the collective's. Confirm acceptable
   (the alternative — each artist verifying their own sending domain — is heavy).
2. **Worker infra:** Railway cron service (same platform) vs Supabase `pg_cron` +
   scheduled Edge Function. Recommend Railway worker for parity.
3. **Calendar:** native-only for v1 (recommended) vs Google Calendar sync now.
4. **Anthropic API account:** required for the intelligent layers (C, and D's proposals).
   Separate from the Claude.ai subscription, pay-per-use, pennies. Slices A and B need none.
