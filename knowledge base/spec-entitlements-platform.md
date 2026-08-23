# Spec — Entitlements Platform (the foundation every gate builds on)

Product-track only. Ships in the commercial fork; Nick's production instance is untouched.

This is the promotion of the primitives sketched ad hoc in
`spec-scheduled-sends-cap.md` into the platform every per-feature gate spec
(scheduled sends, AI drafts, collective intel, instant push, …) reuses. Feature
specs define **the rule and the copy**; this spec defines **everything else**:
where plan state lives, how limits are declared, how enforcement raises, how the
client catches and renders, how events are logged, and where Stripe plugs in.

Non-negotiables (decided; do not relitigate in feature specs):
- Enforcement is **server-side** — Postgres triggers/RLS for DB writes, worker
  checks for worker endpoints. Client checks are UX only.
- Typed errors (`SEND_CAP`, `DRAFT_CAP`, …) map to **one** shared gate modal.
- Gates render **in place with the user's own data** — never a bare pricing table.
- Never block reading the user's own data. Gates block the *next convenience*.
- Downgrades never destroy queued/earned things (grandfather).

---

## 1. Plan model

### 1a. The column pair

```sql
alter table artists
  add column plan text not null default 'pro'
    check (plan in ('free','pro','team')),          -- 'team' reserved, unused
  add column plan_expires_at timestamptz default (now() + interval '14 days');
```

**Trial policy (decided): every signup gets a 14-day Pro trial**, and those two
defaults *are* the implementation — new artist rows are born `pro` with a
14-day expiry. Semantics of the pair:

| plan | plan_expires_at | Effective |
|---|---|---|
| `pro` | null | Pro (paid, or hand-granted) |
| `pro` | future | Pro (trial / comped window) |
| `pro` | past | **free** (trial lapsed — nothing to clean up) |
| `free` | anything | free |

Backfill for existing beta rows when this migrates: `update artists set plan='pro', plan_expires_at=null;` (beta testers are comped).

### 1b. `effective_plan()` — the one plan-read function

Expiry collapses to effective plan in exactly one place, so **every gate
inherits trial expiry for free** — no trigger, no RLS predicate, no worker
check ever reads `artists.plan` raw:

```sql
create or replace function effective_plan(p_artist uuid)
returns text language sql stable security definer
set search_path = public as $$
  select case
    when a.plan in ('pro','team')
     and (a.plan_expires_at is null or a.plan_expires_at > now())
    then a.plan else 'free' end
  from artists a where a.id = p_artist
$$;
```

`security definer` so RLS predicates on *other* tables can call it without a
grant on `artists`. When Stripe flips `plan`, nothing else changes.

### 1c. Limit functions — one per limit, single source of truth

One SQL function per metered thing, name pattern `limit_<thing>(p_plan text)
returns int`, **null = unlimited**. Callable from triggers, RLS, and PostgREST
alike. They read `app_config` (§6) with a hardcoded fallback:

```sql
create or replace function limit_scheduled_sends(p_plan text)
returns int language sql stable as $$
  select case when p_plan in ('pro','team') then null
    else coalesce((select (value->>'free')::int
                     from app_config where key = 'limit.scheduled_sends'), 1)
  end
$$;
```

> Correction to the sends-cap sketch: these are **`stable`, not `immutable`** —
> they read `app_config`, and Postgres will happily let you lie with
> `immutable` and then cache wrong answers. `stable` is the honest and correct
> marking; it still inlines fine inside triggers.

Every feature spec that adds a cap adds exactly one `limit_*` function + one
`app_config` row. Nothing else in the platform changes.

### 1d. How the client learns plan + limits

One RPC, fetched once at boot (alongside `loadProfile()`), cached in memory:

```sql
create or replace function my_entitlements()
returns jsonb language sql stable security definer
set search_path = public as $$
  select jsonb_build_object(
    'plan',            effective_plan(auth.uid()),
    'plan_raw',        a.plan,
    'plan_expires_at', a.plan_expires_at,
    'limits', jsonb_build_object(
      'scheduled_sends', limit_scheduled_sends(effective_plan(auth.uid()))
      -- each gate spec appends its key here
    ))
  from artists a where a.id = auth.uid()
$$;
grant execute on function my_entitlements() to authenticated;
```

Client side (app/index.html, next to the other boot globals like `ME`):

```js
var ENT = { plan: 'free', limits: {} };            // pessimistic until loaded
function loadEntitlements(cb){
  sb.rpc('my_entitlements').then(function(r){
    if (r.data) ENT = r.data;
    if (cb) cb();
  });
}
function entLimit(key){                            // null = unlimited
  return ENT.limits ? ENT.limits[key] : 0;
}
```

Rules: call `loadEntitlements()` at boot and inside `refetchAll()` (so
wake-from-sleep and trial expiry mid-session self-heal). `ENT` drives **meter
chips, ghost rows, and pre-checks only** — it is advisory. The server is the
wall; a stale `ENT` at worst shows a chip that's one count off, and the trigger
still arbitrates.

---

## 2. Enforcement toolkit — three patterns, when to use which

| Pattern | Use for | Example gates |
|---|---|---|
| (a) before-insert/update trigger raising typed errcode | **DB writes** where the free tier gets N of something | scheduled sends, drafts, deals |
| (b) RLS predicate | **Row visibility** — Pro sees rows free doesn't | collective intel, pay-range history |
| (c) worker endpoint check | Anything the **worker** does (costs money / uses service key) | AI drafts, tone rewrite, instant push |

Never double-enforce the same rule in two layers — one wall per rule, chosen by
where the write/read actually happens.

### (a) Trigger — the template

Atomic (no two-tabs race), and the *only* arbiter — the UI count is advisory:

```sql
create or replace function enforce_scheduled_send_cap()
returns trigger language plpgsql as $$
declare lim int; cnt int;
begin
  if new.status not in ('scheduled','ready') then return new; end if;
  lim := limit_scheduled_sends(effective_plan(new.artist_id));
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

Note the two platform-isms vs. the original sketch: it calls
`effective_plan()` (trial expiry inherited) and `limit_scheduled_sends()`
(tunable via `app_config`). Every future cap trigger copies this shape.

**Grandfather rule (applies to every trigger gate):** enforce on
insert/update-into-active only — never on existing rows. Pro→free with N things
queued: they run/fire/keep; the gate only blocks *creating the next one* while
count ≥ limit. Gates block the next convenience, never take hostages.

### (b) RLS predicate

For "Pro sees more rows" gates. The predicate ORs the pro check onto the
existing visibility rule:

```sql
-- e.g. deep intel rows visible to contributors + Pro
create policy intel_read on venue_intel for select using (
  effective_plan(auth.uid()) in ('pro','team')
  or artist_id = auth.uid()          -- never block reading your own data
);
```

Hard rule: **a user's own rows are always visible** — RLS gates apply only to
*collective/derived* data. RLS gates are silent (rows just absent), so the
feature spec must pair them with a client-side ghost/teaser surface that fires
`ghost_seen` (§4) — otherwise the gate converts nobody because nobody sees it.

### (c) Worker endpoint check

Worker endpoints already do `verifyUser(req)` → uid. Add one helper next to it
(worker/index.js) and call it after auth in every metered endpoint:

```js
// Plan logic lives in SQL — the worker asks, never re-derives expiry.
async function effectivePlan(uid) {
  const r = await fetch(`${SUPA}/rest/v1/rpc/effective_plan`, {
    method: "POST",
    headers: { apikey: SVC, Authorization: "Bearer " + SVC, "Content-Type": "application/json" },
    body: JSON.stringify({ p_artist: uid }),
  });
  return r.ok ? await r.json() : "free";           // fail closed
}
```

On a cap breach the endpoint responds
`403 {"gate":"DRAFT_CAP","error":"Free plan: 3 AI drafts a month"}` — the
`gate` key is what the client mapper (§3) looks for. Usage counting for worker
gates (e.g. drafts/month) is a plain count against an existing table or a
small usage table defined by that feature's spec — the *response shape* is what
this platform standardizes.

### Error convention (all three patterns)

- Gate codes are `SCREAMING_SNAKE`, one per rule: `SEND_CAP`, `DRAFT_CAP`,
  `INTEL_GATE`, `PUSH_GATE`, … Registered in the copy table (§3); a code
  without copy is a bug.
- Postgres: `raise exception '<CODE>'` with `errcode = 'P0001'`,
  `detail` = human fallback copy. The **message is the code** — PostgREST
  surfaces it as `error.message`, which is what the mapper keys on.
- Worker: JSON body with `gate: '<CODE>'`, `error` = human fallback copy,
  status 403.

---

## 3. Gate modal + client plumbing

One shared component. No feature ever builds its own upgrade UI.

### The mapper — one function between errors and the modal

Both error shapes funnel through one function; callers wrap their existing
error branch:

```js
// Returns true if the error was a gate (and the modal is now up).
function handleGate(err, context) {
  if (!err) return false;
  var code = null;
  if (err.gate) code = err.gate;                       // worker JSON shape
  else if (err.message && GATE_COPY[err.message]) code = err.message; // PostgREST
  if (!code) return false;
  showGate(code, context || {});
  return true;
}
```

Call-site pattern (replaces the raw-toast branch, keeps toast as fallback):

```js
sb.from('scheduled_messages').insert(row).then(function(r){
  if (r.error) {
    if (handleGate(r.error, { queued: currentQueuedSend })) return;
    showToast('Could not schedule: ' + r.error.message, true);
    return;
  }
  ...
});
```

A gate error must **never** reach `showToast`/`alert` raw.

### `showGate(code, context)` — the component

One overlay (same visual family as the app's existing sheets), fully driven by
a copy table so feature specs ship *copy rows*, not markup:

```js
var GATE_COPY = {
  SEND_CAP: {
    title: 'Your slot is holding a send.',
    body:  function(ctx){ return ctx.queued
             ? '📅 ' + ctx.queued.venue + ' — fires ' + ctx.queued.when
             : 'Free plan: 1 scheduled send at a time.'; },
    cta:   'Go Pro — schedule them all',
    secondary: { label: 'Swap: cancel that one, queue this', event: 'swap',
                 action: function(ctx){ /* feature-supplied */ } },
  },
  // DRAFT_CAP, INTEL_GATE, … — each gate spec adds its row here
};

function showGate(code, context) {
  var c = GATE_COPY[code];
  if (!c) { showToast('Upgrade to Pro to do that', true); logGate(code, 'gate_hit', context); return; }
  logGate(code, 'gate_hit', context);               // automatic — no call sites
  // render overlay: title, body(context), [CTA] [secondary?] [dismiss]
  // CTA click     -> logGate(code, 'upgrade_click', context); openUpgrade(code);
  // secondary     -> logGate(code, c.secondary.event, context); c.secondary.action(context);
  // close/dismiss -> logGate(code, 'dismiss', context);
}
```

Contract:
- `context` carries **the user's own data** (the queued send, the drafts
  waiting, the locked row count) — the body renders their situation, never a
  generic pitch. Feature specs define what goes in `context`.
- Title/body/CTA/secondary come from `GATE_COPY[code]` only. Copy tweaks are
  one-object edits.
- Event logging (§4) is *inside* the component — open, CTA, secondary, and
  dismiss log automatically. Feature code never calls `logGate` for modal
  events (it does call it for ambient surfaces: `ghost_seen`, `unlock_earned`).
- `openUpgrade(code)` is the single upgrade entry point: during beta it shows
  the "reply to your invite email / DM Nick" panel; post-Stripe it opens
  Checkout (§5) with `code` passed through as metadata so conversions
  attribute to the gate that closed them.

### Ambient surfaces (shared vocabulary, feature-owned rendering)

Meter chips (`Schedule · 1 slot`), ghost rows (`⚡ 2 more could be queued —
Pro`), and post-fire nudges are defined per feature, but they all: read `ENT`
for the limit, call `showGate(code, ctx)` on tap, and log `ghost_seen` when a
locked row renders. That's the entire contract.

---

## 4. `gate_events` — schema + funnel

```sql
create table gate_events (
  id bigint generated always as identity primary key,
  artist_id uuid not null references artists(id),
  gate text not null,            -- the gate code: 'SEND_CAP', 'DRAFT_CAP', …
  event text not null,           -- canonical event name, see below
  context jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index gate_events_funnel on gate_events (gate, event, created_at);
alter table gate_events enable row level security;
create policy ge_insert_own on gate_events for insert
  with check (artist_id = auth.uid());
-- no select policy for authenticated: analytics are read via SQL editor / service role
```

Client logging (fire-and-forget, never blocks UX, failures swallowed):

```js
function logGate(gate, event, context) {
  sb.from('gate_events').insert({ artist_id: ME, gate: gate, event: event,
    context: context || {} }).then(function(){});
}
```

The worker logs its own gate hits directly via service key (same rows,
`context` includes `{source:'worker'}`).

### Canonical event names — the only six

| event | meaning |
|---|---|
| `gate_hit` | gate modal opened (user hit the wall) |
| `upgrade_click` | tapped the Pro CTA anywhere |
| `dismiss` | closed the modal without acting |
| `swap` | took the free-tier escape hatch (cancel-one-queue-one etc.) |
| `ghost_seen` | a locked/teaser row rendered in view |
| `unlock_earned` | user earned a gated thing via product behavior (referral, streak) |

Feature specs **reuse these names** with their own `gate` code — never invent
per-feature event names. (The sends-cap sketch's `cap_hit`/`cap_swap`/… become
`gate='SEND_CAP'` + canonical event; `cap_keep_draft` is `dismiss` with
`context.kept_draft: true`.)

### The north-star funnel

`gate_hit → upgrade_click → subscribed`. Subscription lands in `artists.plan`
(via Stripe webhook or hand-flip), so the third stage joins against plan
flips. The canonical query:

```sql
with f as (
  select artist_id, gate,
         min(created_at) filter (where event = 'gate_hit')      as first_hit,
         min(created_at) filter (where event = 'upgrade_click') as first_click
  from gate_events
  where created_at > now() - interval '30 days'
  group by artist_id, gate
)
select gate,
       count(*) filter (where first_hit is not null)                 as hit,
       count(*) filter (where first_click is not null)               as clicked,
       count(*) filter (where first_click is not null
                    and effective_plan(artist_id) in ('pro','team')) as subscribed,
       round(100.0 * count(*) filter (where first_click is not null)
             / nullif(count(*) filter (where first_hit is not null), 0), 1)
         as click_rate_pct
from f group by gate order by hit desc;
```

Guardrail reads per feature spec (e.g. swap-rate vs churn for SEND_CAP) query
the same table with the same names.

---

## 5. Stripe integration path (seam defined now, built later)

Not built for beta. But every piece above is shaped so that turning Stripe on
touches **three things and nothing else**:

```sql
create table stripe_customers (
  artist_id uuid primary key references artists(id),
  stripe_customer_id text not null unique,
  stripe_subscription_id text,
  created_at timestamptz not null default now()
);
-- service-role only; no client policies
alter table stripe_customers enable row level security;
```

**Webhook endpoint on the worker** (it already holds secrets and the service
key; same house as Gmail/Gemini): `POST /stripe/webhook`, signature-verified
with `STRIPE_WEBHOOK_SECRET`, handling exactly two events at first:

- `checkout.session.completed` → upsert `stripe_customers`, then
  `update artists set plan='pro', plan_expires_at=null where id=<artist_id from session metadata>`
- `customer.subscription.deleted` → `update artists set plan='free' where id=…`
  (grandfathering of queued work is already handled by §2's enforce-on-create
  rule — the webhook just flips the column and walks away)

Checkout sessions are created by a small worker endpoint `POST /stripe/checkout`
(verifyUser → create session with `metadata: { artist_id, gate }`), which is
what `openUpgrade(code)` calls. The `gate` metadata closes the attribution loop
back to §4's funnel.

**Beta path (now):** no Stripe. `openUpgrade` shows the contact-Nick panel;
Nick hand-flips plans in the SQL editor (§7). Because *everything* reads
`effective_plan()`, the hand-flip and the webhook are indistinguishable to the
rest of the system.

**Trial:** already implemented by the column defaults in §1a. Expiry is not an
event — it's a read-time fact inside `effective_plan()`, so there is no cron,
no cleanup job, and no gate that can miss it.

---

## 6. Experiment flags — `app_config`

Cap tuning must not require a deploy (the fallback experiments — "2 slots
instead of 1", "5 drafts instead of 3" — are copy-and-number changes):

```sql
create table app_config (
  key text primary key,           -- 'limit.scheduled_sends', 'limit.ai_drafts', …
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table app_config enable row level security;
create policy cfg_read on app_config for select to authenticated using (true);
-- writes: service role / SQL editor only

insert into app_config (key, value) values
  ('limit.scheduled_sends', '{"free": 1}');
```

Conventions:
- Key pattern `limit.<thing>`; value is jsonb keyed by plan (`{"free": 1}`) so
  a future `team` tier is a key, not a migration.
- **Limit functions (§1c) read it, with a hardcoded fallback** — a wiped or
  missing row degrades to the shipped default, never to broken gates.
- `my_entitlements()` reads through the limit functions, so a config change
  reaches meter chips on the next boot/`refetchAll()` with zero client changes.
- Values are not secret (they render in the UI anyway) — read-for-authenticated
  is fine.

---

## 7. Admin & beta ops — SQL cookbook

Everything the solo dev needs, runnable in the Supabase SQL editor:

```sql
-- Who's on what (with effective plan and trial state)
select display_name, plan, plan_expires_at, effective_plan(id) as effective
from artists order by created_at desc;

-- Comp someone to Pro (permanent)
update artists set plan='pro', plan_expires_at=null
where id = '<artist-uuid>';

-- Extend a trial 14 more days
update artists set plan='pro',
  plan_expires_at = greatest(coalesce(plan_expires_at, now()), now()) + interval '14 days'
where id = '<artist-uuid>';

-- Downgrade to free (grandfathering is automatic — nothing else to run)
update artists set plan='free' where id = '<artist-uuid>';

-- Tune a cap live (no deploy)
update app_config set value='{"free": 2}', updated_at=now()
where key='limit.scheduled_sends';

-- Funnel (see §4 for the full query); quick pulse:
select gate, event, count(*) from gate_events
where created_at > now() - interval '7 days'
group by 1,2 order by 1,3 desc;

-- Who hit gates this week (outreach list for beta conversations)
select a.display_name, g.gate, count(*) as hits, max(g.created_at) as last
from gate_events g join artists a on a.id = g.artist_id
where g.event='gate_hit' and g.created_at > now() - interval '7 days'
group by 1,2 order by hits desc;
```

---

## 8. Effort rollup — platform pieces only

(Feature-gate effort — e.g. the sends-cap trigger, its chips and ghosts — is
costed in each feature spec. This is the shared substrate.)

| Piece | Size |
|---|---|
| `plan`/`plan_expires_at` columns, `effective_plan()`, `my_entitlements()`, migration + backfill | ~half day |
| `app_config` table + first `limit_*` function pattern | ~quarter day |
| Gate modal component + `GATE_COPY` + `handleGate` mapper + `ENT` boot cache | ~1 day |
| `gate_events` table + `logGate` + worker-side logging | ~quarter day |
| Worker `effectivePlan()` helper + 403 gate-response convention | ~quarter day |
| Admin cookbook validation (run every snippet once against the fork) | ~quarter day |
| **Total** | **~2.5 days** |
| *(Deferred: Stripe webhook + checkout endpoints + `stripe_customers`)* | *(~1.5 days, later)* |

Sequencing: platform lands **with** the scheduled-sends cap (its proving
ground) — the cap's feature spec then shrinks to: its trigger, its three
`GATE_COPY`/chip/ghost surfaces, and its guardrail queries.
