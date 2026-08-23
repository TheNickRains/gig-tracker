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

## The collective is GROUPS you form, not a commons (Nick, 2026-08-22 — supersedes everything below-dated)

The adoption blocker Nick hears from real musicians: **"can this burn me?"** —
booking runs on reputation in small scenes; one leaked candid comment about a
venue can cost a room you've played for years. No vouching system or moderation
policy fixes that fear in a shared commons of strangers.

The answer is structural: **there is no commons.** The product's social unit is
a **group you form yourself** — your actual trusted circle, the people you
already text about gigs. Two modes:

- **Solo (default):** a self-booking tracker. Complete on its own — CRM +
  assistant, nothing shared with anyone.
- **Groups (user-formed, private):** the group chat where somebody always knows
  who books in Austin, made organized and permanent. Members pool knowledge
  about ROOMS: the shared venue book, intel/comments, wins. You can be in
  multiple groups (hometown crew, touring circuit crew).

The sharing boundary (default, per-item overridable): **venues, intel, and wins
are group-shared; your pipeline, deals, and rates are private** unless you
explicitly share a specific deal. Working together = pooling room knowledge,
not opening your negotiations to friends who might pitch the same room next month.

Consequences:
- Reputation fear dissolves structurally — every room you're candid in is one
  you built. No strangers, ever.
- The earlier metro-commons machinery is dead: no vouching chains, no standing
  axis, no invite flywheel, no membership spec, no aggregation-threshold privacy
  layer (a group IS the privacy boundary). spec-collective-intel is superseded
  wholesale; growth is groups inviting their own people (a group is only useful
  full, so the product's viral unit is "start a group with your crew").
- Groups are free (they're the retention + moat); monetization stays entirely on
  the assistant axis (drafts, sends, follow-ups, notifications). A future paid
  'team' tier remains reserved for MANAGED multi-artist setups (agents), which
  are a different thing than peer groups.
- Nick's current instance is, in product terms, the first group.

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
| Collective (community + intelligence) | ✓ for members — standing-gated, never sold | same |
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
| Collective intel | — | **superseded 2026-08-22**: intelligence is a membership benefit (ambient contribution, aggregation thresholds) — enforcement machinery in the spec survives, the monetization mechanic does not; fold into membership-mechanics spec | [spec-collective-intel.md](spec-collective-intel.md) | — |

All gates ship only: a `limit_*` fn + `app_config` row, one server-side
enforcement (trigger / RLS / worker per platform §2), `GATE_COPY` rows, and
their ambient surfaces. Analytics use the six canonical `gate_events` names —
no per-feature event vocabularies.

## Build sequencing

1. **Fork stands up** (separate Supabase + worker + Stripe-less billing seam) —
   prerequisite for everything; Nick's instance keeps running unchanged.
2. **Platform + sends cap together** (~5d) — the proving ground pair.
3. **AI drafts + voice gate** (~3d) — the highest-envy gate; needs the meter UX
   from (2) and the Stage-1 tone-card source (product-sent + paste-in).
4. **Auto-follow-ups, review-to-fire mode** (~2d) — depends on (2)'s slot
   semantics for engine sends.
5. **Groups** (~4d, needs its own spec — see open decisions) — create/invite/
   leave, group-scoped venue book + intel + wins, private-by-default pipelines
   with per-deal sharing. Replaces the old collective-intel gate build and all
   commons/membership machinery. The fork's schema should be group-scoped from
   day one (a `group_id` on the venue/intel tables is cheap now, a migration
   nightmare later); solo mode = the groupless default.
6. **Notifications digest/instant** (~3d) — **Stage 2 (post-CASA)**: the instant
   gate requires reply detection; only the free digest ships earlier.

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
  the 100-user cap applies until verification either way. Restricted scopes have
  NO unverified-production click-through (hard block) — testing-mode allowlist is
  the only pre-CASA inbox-reading path; reserve it for a hand-picked inner circle
  who tolerate weekly reconnects (they preview the Stage 2 hook).

### Stage-1 gate viability (audited 2026-08-22)

Send-only breaks three Stage 2 assumptions in the specs:

| Gate | Send-only status |
|---|---|
| Sends cap, collective intel, platform | ✓ unaffected |
| AI drafts | ✓, but **voice gate**: tone profile can't sample sent mail (read scope). Stage 1: build tone card from product-sent mail + paste-in onboarding ("paste 2–3 booking emails you're proud of"); sent-mail sampling is a Stage 2 upgrade. |
| Auto-follow-ups | ⚠️ can't verify no-reply without inbox read. Stage 1: engine drafts default to review-to-fire (`ready`), "did they reply? forward it first" nudge; autonomous firing is Stage 2. |
| Notifications | ✗ "instant reply push" needs reply detection — **whole gate moves to Stage 2**. Free digest (sends fired, follow-ups due) survives as retention. |

**Stage 1 Pro sells on:** slot cap + AI drafts/voice + reviewed auto-follow-ups +
collective intel. Specs need a Stage-1/Stage-2 pass when the fork build starts.

### Funding CASA — the Founding Member annual

Two tiers only (Free / Pro; `team` reserved, undesigned). The CASA fund is a
**billing offer, not a tier**: Founding Member annual — Pro entitlements, ~$99/yr
prepaid, price locked for life, founder badge in the collective. Budget CASA
Tier 2 ≈ $600–1k → **ten founding annuals fund it outright** (vs ~4 months of
20 monthly subs). Pitch is honest: founders prepay the Stage 2 hook into
existence, and they're first through the door when inbox-reading ships.

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

1. **Price point** — $12 anchor; test against $9.99/$14.99 once the funnel has
   volume. Annual plan (2 months free) at launch or later.
2. **Groups spec** (create/invite/leave, the shared-vs-private boundary and its
   per-item overrides, multi-group membership, what happens to shared venues
   when someone leaves) — needs writing before the fork build reaches it;
   supersedes the old "membership mechanics" decision.
3. **Name/brand for the commercial product** vs. "Gig Collective" (the word
   "collective" now means a group, which may strengthen the name).
