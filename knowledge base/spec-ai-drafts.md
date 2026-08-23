# Spec — AI Drafting Meter + Voice Gate (free: 3/mo generic · Pro: unlimited, your voice)

Product-track only. Ships in the commercial fork; Nick's production instance is untouched.

## The rule

A **free** artist gets **3 AI drafts per UTC calendar month**, written in a **generic
professional voice** (the tone card is withheld from the prompt). **Pro** = unlimited
drafts written in the artist's own voice (the worker's `refreshToneProfile` tone card,
injected exactly as today).

**One Gemini generation = one credit.** That includes `mode: 'enhance'`
(Enhance-with-AI on a template) and every regeneration — no free re-rolls, no
half-credits, nothing to explain. The UX consequence is owned below: the meter chip
lives ON the draft button, so the artist always sees the count *before* spending it.
**Template drafts are not metered** — the dropdown (Cold outreach · Follow-up · Full
pitch · Check-in) renders locally with zero worker calls. Templates are the ledger;
Gemini is the assistant. Month boundary = **UTC calendar month** (`date_trunc('month',
now() at time zone 'utc')`) — timezone-fair enough, trivially auditable, and each
month 1st is a fresh sales conversation.

Two gates in one feature, deliberately: the **meter** creates scarcity, the **voice**
creates envy. A free user's 3 monthly drafts are good — that's what makes the fourth
one, and the in-your-voice version of all of them, worth paying for.

## Enforcement — worker is the wall, UI is the concierge

`/ai/draft` already verifies the Supabase session (`verifyUser`) and owns the Gemini
call — enforcement lives there, in `handleAiDraft`, before the prompt is built:

1. Fetch `plan` alongside the existing artist select (it already pulls
   `tone_profile`; add `plan`).
2. If `plan = 'free'`: count this month's usage. At ≥3, return **402** with the typed
   error the app maps to the gate modal (never a raw toast):
   ```json
   { "error_code": "DRAFT_CAP", "error": "Free plan: 3 AI drafts a month",
     "used": 3, "resets_at": "2026-09-01T00:00:00Z" }
   ```
3. If under the cap: build the prompt **without the tone-card block** (skip the
   `a.tone_profile` injection; everything else — venue, conversation, objective,
   rates — stays). Call Gemini. **Only on success**, insert the usage row, then
   respond with `{ draft, voice: 'generic', remaining: n }`. Pro responses carry
   `{ draft, voice: 'yours', remaining: null }`.

**Usage table, not gate_events.** Billing counts and analytics must never share a
table — analytics gets pruned, backfilled, and re-schema'd; a meter can't:

```sql
create table draft_usage (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references artists(id),
  entry_id uuid,
  mode text,                      -- 'draft' | 'enhance'
  plan_at_time text not null,     -- 'free' | 'pro' — downgrade rule needs this
  created_at timestamptz not null default now()
);
-- RLS: artist reads own rows (the app renders the meter chip from this count);
-- only the worker (service key) writes.
```

Count = `draft_usage where artist_id = X and plan_at_time = 'free' and created_at >=
date_trunc('month', now() at time zone 'utc')`. Check-then-insert isn't atomic — two
tabs racing can slip a 4th free draft through. Accepted: this is a soft meter on a
worker-priced action, not the sends trigger; a rare free draft is cheaper than a
serializable transaction.

**Downgrade rule:** `plan_at_time` means drafts made while Pro never count against
the free 3 — a mid-month downgrader gets the full free allowance, not an instant
wall. Their `tone_profile` row is **never deleted** (it's their data; the worker just
stops injecting it while free), and `refreshToneProfile` keeps running daily for free
accounts — one small Gemini call that keeps the voice card warm, so upgrade delivers
their voice on the very next draft, and the gate modal can truthfully say the profile
already exists.

## UX surfaces (the CapCut tray)

1. **Meter chip** on the Draft/Enhance-with-AI button (pipeline detail composer,
   the `aiDraft(id)` button) when free: `✨ Draft with AI · 2 of 3 left`. Rendered
   from a client-side `draft_usage` count (RLS read-own) so it's correct *before*
   the first call — the regeneration trap ("I didn't know re-rolls counted") dies
   here, not in a support email. Post-draft toast confirms: "Draft ready — 1 left
   this month."
2. **The voice gate — the killer in-place render.** When `/ai/draft` returns
   `voice: 'generic'`, the textarea fills exactly as today, and directly beneath it
   a single quiet-primary button appears:
   > ✨ **Rewrite this in your voice — Pro**
   The artist is staring at a good, sendable email that isn't quite *them*, with the
   better one one tap away — locked-effect-in-the-tray. Tap → gate modal built from
   *their* data:
   > **Your voice profile is ready.**
   > Built from {N} emails you actually sent — your greetings, your rhythm, your
   > sign-off. Free drafts don't use it.
   > [ Go Pro — every draft in your voice ] [ Keep this draft ]
   Never show the rewritten text pre-upgrade (no free taste of the paid output);
   the *existence* of the profile is the tease.
3. **Cap modal** (`DRAFT_CAP` mapped, shared gate-modal pattern): "You've used all
   3 AI drafts this month — resets {Sep 1}." Buttons: [ Go Pro — unlimited, in your
   voice ] [ Use a template instead ] — the second keeps free genuinely usable and
   routes into the unmetered dropdown.
4. **Zero-state chip**: at 0 left the button stays visible and tappable
   (`✨ Draft with AI · 0 left — Pro`); tapping opens the cap modal without a worker
   round-trip. The gate renders in place; it never hides the feature.

## Conversion analytics (build day one — the gate is an experiment)

Shared `gate_events` (artist_id, event, context jsonb, created_at):
`draft_used` (with remaining) · `draft_cap_hit` · `draft_cap_upgrade_click` ·
`draft_cap_template_click` · `voice_gate_seen` · `voice_gate_click` ·
`voice_gate_upgrade_click`. Two funnels, tracked separately: **scarcity**
(`cap_hit → upgrade_click`) and **envy** (`voice_gate_seen → upgrade_click`). The
hypothesis worth testing: voice converts better than scarcity. If `voice_gate_seen`
is high and clicks are ~zero, the generic drafts are *too* good — that's a copy
problem on the button, not a reason to degrade free quality. Guardrail: free users
still consuming all 3 monthly = healthy; users stopping after 1 = the taste isn't
landing.

## Edge cases

- **Gemini/worker failure never consumes a credit**: the usage insert happens only
  after `gemini()` resolves. The existing 429/500 paths return unchanged; a 429
  ("AI is catching its breath") with a credit burned would be radioactive. If the
  insert itself fails post-generation, log it and return the draft anyway —
  occasionally goods-without-charge, never charge-without-goods.
- **The free draft must be GOOD.** The generic path is literally today's
  no-tone-card path (`a.tone_profile` is already optional in the prompt) — full
  venue/conversation/objective/rate context intact. Do not add "write blandly"
  instructions; withholding the tone card *is* the entire difference. The taste
  creates the craving; a bad free draft kills both funnels.
- **No tone profile yet** (new Pro user, <2 sent-email samples): draft proceeds
  without the card, exactly as today. For free users in the same state, the voice
  gate modal swaps its line: "We'll learn your voice from the emails you send —
  Pro drafts use it automatically." Never render "built from 0 emails."
- **Templates + Link button + Send/Schedule** are untouched — the gate meters one
  function (`aiDraft` → `/ai/draft`) and nothing else. Reading drafts, editing
  drafts, sending drafts: never blocked.
- **Legacy free drafts after upgrade**: drafts already sitting in `draftText`
  stay as-is; the rewrite button disappears on next render (plan check). Pro users
  simply regenerate — unlimited.
- **Clock games**: `resets_at` comes from the worker, not the client; the chip's
  client-side count is advisory, the worker count is the wall.

## Effort (product fork)

| Piece | Size |
|---|---|
| `draft_usage` table + RLS + worker check/insert + `DRAFT_CAP` + tone-card gating in `handleAiDraft` | ~1 day |
| Meter chip + zero-state + cap modal (shared pattern) | ~half day |
| Voice-gate button + modal (needs `voice` in response + tone-profile-exists check) | ~1 day |
| `gate_events` logging (both funnels) | ~half day |
| **Total** | **~3 days** |

Dependencies: the entitlement primitives from the scheduled-sends spec
(`artists.plan`, `gate_events`, the gate-modal pattern, typed-error mapping) — this
gate is the second consumer and the first to prove the pattern spans DB-enforced
(SEND_CAP) and worker-enforced (DRAFT_CAP) walls with one client vocabulary.
