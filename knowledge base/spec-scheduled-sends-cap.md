# Spec — Scheduled Sends Cap (free: 1 active · Pro: unlimited)

Product-track only. Ships in the commercial fork; Nick's production instance is untouched.

> **Platform note:** this was the first gate spec; its primitives were since
> promoted into [spec-entitlements-platform.md](spec-entitlements-platform.md),
> which supersedes the sketches here. Build against the platform: the trigger
> calls `effective_plan()` + `limit_scheduled_sends()` (app_config-tunable, not
> the hardcoded fn below), errors route through `handleGate()` → `showGate('SEND_CAP', ctx)`,
> and analytics use the six canonical `gate_events` names — `cap_hit`→`gate_hit`,
> `cap_swap`→`swap`, `cap_upgrade_click`→`upgrade_click`, `cap_keep_draft`→`dismiss`
> with `context.kept_draft:true`, `ghost_slot_seen`→`ghost_seen`.

## The rule

A **free** artist may have **one active scheduled send** at a time, account-wide.
**Active** = a `scheduled_messages` row with `status in ('scheduled','ready')`.
The slot frees the moment the send fires (`sent`), is canceled (`canceled`), or fails.
**Pro** = unlimited.

Why "1 active" beats "N per month": the slot recycles, so free users touch the gate
*every time they try to queue a second send* — usually while staring at a going-quiet
deal. Maximum-motivation moments, indefinitely repeated, without ever making the free
tier useless. The auto-follow-up engine (worker-generated sends) is not metered by
this cap — it is Pro-only entirely and never runs for free accounts.

## Entitlements (minimal, Stripe-ready)

- `artists.plan text not null default 'free'` — values `free | pro`. Stripe webhook
  flips it later; for beta, flip by hand in SQL.
- Limits live in one SQL function (single source of truth, callable from trigger and
  PostgREST):

```sql
create or replace function plan_scheduled_send_limit(p text)
returns int language sql immutable as
$$ select case when p = 'pro' then null else 1 end $$;  -- null = unlimited
```

## Enforcement — DB is the wall, UI is the concierge

Client checks are UX only; the real gate is a **before-insert trigger** (atomic — no
race where two tabs each queue "the one" slot):

```sql
create or replace function enforce_scheduled_send_cap()
returns trigger language plpgsql as $$
declare lim int; cnt int;
begin
  if new.status not in ('scheduled','ready') then return new; end if;
  select plan_scheduled_send_limit(plan) into lim from artists where id = new.artist_id;
  if lim is null then return new; end if;
  select count(*) into cnt from scheduled_messages
    where artist_id = new.artist_id and status in ('scheduled','ready');
  if cnt >= lim then
    raise exception 'SEND_CAP' using errcode = 'P0001',
      detail = 'Free plan: 1 scheduled send at a time';
  end if;
  return new;
end $$;
```

App maps the `SEND_CAP` error to the gate modal (never a raw alert).
`scheduled_messages` needs `artist_id` denormalized if it only carries
`pipeline_entry_id` today — required for a sane per-artist count + RLS.

**Downgrade rule:** Pro→free with N sends queued: queued sends are grandfathered
(they fire), but no new scheduling until active count < 1. Never cancel work the
user already queued — gates block the next convenience, never take hostages.

## UX surfaces (the CapCut tray)

1. **Meter chip** on the draft composer's Schedule button when free:
   `Schedule · 1 slot`. Always visible — the cap is learned before it's hit.
2. **Gate modal** (on hitting the cap) — shows *their own data*, not a pricing table:
   > **Your slot is holding a send.**
   > 📅 The Lava Room — fires Tue 9:00 AM
   > [ Go Pro — schedule them all ]  [ Swap: cancel that one, queue this ]  [ Keep as draft ]
   **Swap is deliberate**: it keeps free genuinely usable, and every swap is a
   conversion impression that also proves the feature's value.
3. **War-room ghost slots** (free users with ≥2 deals that have drafts ready):
   under "Scheduled sends," render locked rows —
   `⚡ 2 more could be queued right now — Pro`. The pipeline sells itself with the
   user's own backlog.
4. **Post-fire nudge** (slot just freed, other drafts waiting): notification/war-room
   line — "Your send to The Lava Room fired ✓ — your slot is open. 2 drafts waiting."
   Keeps free users cycling the slot = habit loop.

## Conversion analytics (build day one — the gate is an experiment)

Event rows (`gate_events`: artist_id, event, context jsonb, created_at):
`cap_hit` · `cap_swap` · `cap_upgrade_click` · `cap_keep_draft` · `ghost_slot_seen`.
North star: `cap_hit → upgrade_click` rate. Guardrail: swap-rate trending up with
retention flat means the cap is working *as a feature*; churn after `cap_hit` means
the modal copy or slot count needs tuning (2 slots is the fallback experiment).

## Edge cases

- **Bounce/failure**: failed sends leave `scheduled/ready` → slot frees. Never let a
  stuck row brick the free tier; worker must terminal-state every fired message.
- **Cancel-reason** already exists (`cancel_reason`) — swaps write `Swapped by you`.
- **Reply-arrived auto-cancel** (worker cancels a queued send when the contact
  replies): frees the slot; the post-fire nudge covers this case too ("They replied
  before your follow-up fired — slot's open").
- **Race**: trigger is the arbiter; UI count is advisory only.
- **Auto-send review flow** (`ready` status): counts against the slot — it's queued
  intent. Free users with auto-send… auto-send is Pro anyway; moot.

## Effort (product fork)

| Piece | Size |
|---|---|
| `plan` column, limit fn, trigger, `artist_id` denorm + backfill | ~half day |
| Gate modal + meter chip + SEND_CAP error mapping | ~1 day |
| Ghost slots + post-fire nudge | ~half day |
| `gate_events` + logging calls | ~half day |
| **Total** | **~2.5 days** |

Dependencies: none on Stripe (hand-flip `plan` during beta). The same
`plan` + `gate_events` + modal pattern is the template every other meter
(AI drafts 3/mo, tone-profile rewrite, instant push) reuses — this feature
is deliberately the entitlement system's proving ground.
