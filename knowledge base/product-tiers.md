# Gig Collective — Product Tiers & Gate Map

The strategy doc. Feature-level detail lives in the per-gate specs (linked below);
this is the why, the matrix, and the sequencing. Product-track only — Nick's
production instance stays free and untouched.

## The three jobs the product must do

1. **Hook — zero-entry CRM.** Connect Gmail → your booking life assembles itself:
   existing conversations become deals, stages auto-advance, replies surface.
   Nobody backfills a CRM; this one backfills itself. The Gmail verification wall
   (CASA) that makes this expensive to build is also the moat against hobby clones.
   *Never gated — crippling the aha kills the demo.*
2. **Retention — the follow-up engine.** Booking is a follow-up discipline and
   musicians are bad at it. The war room answering "who needs me today" is the
   daily-open driver; reply notifications are the re-open driver; weekly momentum
   stats are the habit loop.
3. **Moat — the venue graph.** Real pay data, who books the room, wins, scene
   intel. Glassdoor-for-venues; compounds metro by metro. Contribution is never
   paywalled — the network matters more than any gate's revenue.

## Gating philosophy (CapCut, distilled)

- **Cap verbs, not nouns.** Gate actions that make the user money (draft, send,
  schedule, notify) at their moment of maximum motivation. Never hold data
  hostage — noun caps cause export-and-churn; verb caps cause upgrades.
- **Free is complete; Pro is the assistant.** Free = the full ledger: unlimited
  deals, manual logging, Gmail auto-tracking, the collective. Pro = the app works
  *for* you: unlimited AI in your voice, unlimited scheduled sends, the
  auto-follow-up engine, instant push, full intel.
- **The tray sells.** Locked features render in place with the user's own data
  (ghost rows, meter chips, blurred intel, "Pro would have pinged you at 9:14").
  The pricing page comes to the user, holding the thing they already want.
- **Meters recycle.** Slots and monthly quotas re-present the gate indefinitely;
  every reset is a fresh sales conversation.

## The matrix

| | **Free** | **Pro — $12/mo (test $9.99–14.99)** |
|---|---|---|
| Deals, manual logging, search, stages | Unlimited | Unlimited |
| Gmail auto-tracking + stage advance | ✓ (the hook) | ✓ |
| Templates (non-AI) | Unlimited | Unlimited |
| AI drafts | 3/month, generic voice | Unlimited, **your voice** |
| Scheduled sends | 1 active slot | Unlimited |
| Auto-follow-up engine | Ghost rows only | ✓ |
| Reply notifications | Daily digest | Instant push |
| Collective: browse, add, comment | ✓ always | ✓ |
| Collective deep intel (pay data, pulse, wins detail) | Earn per-venue (give-to-get) | Everywhere |
| Calendar sync (Google) | — | ✓ |
| Trial | every signup: 14 days Pro (column defaults, no cron) | |

Team tier ('team', reserved in schema): bands/duos and **agents running multiple
artists — the whale seat**. Not designed yet; deliberately later.

## Gate inventory → specs

| Gate | Code(s) | Mechanic | Spec | Est. |
|---|---|---|---|---|
| Entitlements platform | — | plan + effective_plan() + showGate + gate_events + app_config | [spec-entitlements-platform.md](spec-entitlements-platform.md) | 2.5d |
| Scheduled sends | `SEND_CAP` | 1 recycling slot, swap escape hatch | [spec-scheduled-sends-cap.md](spec-scheduled-sends-cap.md) | 2.5d |
| AI drafts + voice | `DRAFT_CAP`, voice gate | 3/mo meter + "Rewrite in your voice — Pro" | [spec-ai-drafts.md](spec-ai-drafts.md) | 3d |
| Auto-follow-ups | ghost-only | Pro-only engine, war-room ghost rows (max 2) | [spec-auto-followups.md](spec-auto-followups.md) | ~2d |
| Notifications | `PUSH_GATE` | daily digest vs instant push, tease-in-digest | [spec-notifications.md](spec-notifications.md) | 3d |
| Collective intel | `INTEL_LOCKED` | hybrid: earn per-venue or Pro everywhere | [spec-collective-intel.md](spec-collective-intel.md) | ~3d |

All gates ship only: a `limit_*` fn + `app_config` row, one server-side
enforcement (trigger / RLS / worker per platform §2), `GATE_COPY` rows, and
their ambient surfaces. Analytics use the six canonical `gate_events` names —
no per-feature event vocabularies.

## Build sequencing

1. **Fork stands up** (separate Supabase + worker + Stripe-less billing seam) —
   prerequisite for everything; Nick's instance keeps running unchanged.
2. **Platform + sends cap together** (~5d) — the proving ground pair.
3. **AI drafts + voice gate** (~3d) — the highest-envy gate; needs the meter UX
   from (2).
4. **Notifications digest/instant** (~3d) — monetizes retention; independent.
5. **Auto-follow-ups** (~2d) — depends on (2)'s slot semantics for engine sends.
6. **Collective intel** (~3d) — ship LAST: it needs enough seeded intel that the
   blur hides something real (launch-metro dependency).

### Gmail scope strategy (CASA deferred until revenue — decided 2026-08-22)

Google's compliance wall is on *reading* Gmail, not sending: `gmail.send` is a
"sensitive" scope (free verification, no CASA); `gmail.readonly`/`modify` are
"restricted" (CASA assessment, ~$500–1k at budget labs, annual).

- **Stage 1 (launch, $0 compliance):** send-only. AI drafts, scheduled sends,
  and the auto-follow-up engine all work from the artist's real address. Inbound
  degrades to: per-artist ingest address (`slug@in.<domain>` via Cloudflare Email
  Routing → worker) — forward a venue reply and it files itself, advances the
  stage, fires the pipeline; auto-BCC threads outbound; manual logging is the
  floor. The hook becomes the assistant loop, not the Gmail backfill.
- **Stage 2 (first revenue):** CASA Tier 2 (~50 Pro-months of MRR) unlocks
  restricted scopes; "connect your inbox, watch your pipeline assemble itself"
  ships as the upgrade event to an audience that already pays.
- Planning facts: apps in Google "testing" status get 7-day refresh-token expiry
  (weekly reconnects — do the sensitive-scope verification early to escape it);
  the 100-user cap applies until verification either way.

Other parallel tracks: Capacitor/App Store wrap after the fork exists; TestFlight
beta with the trusted circle fits inside the 100-user cap.

## What we measure

- **North star per gate:** `gate_hit → upgrade_click → subscribed` (canonical
  funnel query in platform spec §4).
- **Retention guardrails:** churn-after-gate_hit (a gate that churns is mistuned,
  not evil); collective contribution rate must stay flat or rising through any
  intel-gate change — the moat outranks the gate.
- **Habit:** DAU/WAU on war-room opens; digest→open rate for free tier.
- Every cap number (slots, draft quota) is an `app_config` value — tuning is a
  SQL update, not a deploy. 1-vs-2 slots and 3-vs-5 drafts are experiments, not
  debates.

## Open product decisions (owner: Nick)

1. **Launch metro #1** — the collective's value at launch is whatever its data
   says about one scene. (Nashville? Memphis? Houston? — wherever the founding
   circle's density is highest.)
2. **Price point** — $12 anchor; test against $9.99/$14.99 once the funnel has
   volume. Annual plan (2 months free) at launch or later.
3. **Collective permissions rework** (creator-owns-delete, versioned edits) —
   prerequisite for opening the doors to strangers; not yet specced.
4. **Name/brand for the commercial product** vs. "Gig Collective".
