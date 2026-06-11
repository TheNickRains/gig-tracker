# Gig Collective — Agentic spec

## /goal
An **intelligent gig-booking personal assistant**. Reduce the artist's thought and
friction: the app drafts the right outreach with the right context at the right time,
manages the pipeline by conversation state, and schedules around real availability.

## Committed architecture: Google-native
Everything funnels through **Google OAuth + a backend worker**. No Resend, no email
routing, no per-user Apps Script — those are dropped.

- **One Google login, several scopes:** `email`/`profile` + **Gmail read** (`gmail.readonly`)
  + **Gmail send** (`gmail.send`) + **Calendar** (`calendar.events`). Requested at the
  "Continue with Google" step with `access_type=offline` so we get a refresh token.
- **Outreach is sent from the artist's OWN Gmail** (Gmail API) — authentic, from their
  real address. Replies land in their inbox; the **backend worker reads them** (Gmail API),
  logs the activity, and advances the stage. The pipeline is conversation-driven.
- **Calendar is the artist's Google Calendar, two-way synced** (Calendar API): availability
  in, confirmed gigs out, conflict checks against real events.
- **Backend worker** (scheduled): per artist, refreshes Google access tokens from the
  stored refresh token, then polls Gmail + Calendar and runs the LLM steps.
- **LLM = the user's existing credits** — **Gemini** (recommended; same Google project +
  billing) or **Grok/xAI** (OpenAI-compatible). **Not Anthropic.**
- **Distribution:** Google OAuth app stays in **Testing** (≤100 test users = the roster,
  many times over). Caveats: unverified-app consent screen; refresh tokens expire ~7 days
  so inactive users re-connect; restricted Gmail scopes mean a real public launch later
  needs Google's CASA security assessment.

## The three features

### 1. Agentic outreach  (agentic > dynamic > static)
The LLM composes each message from everything on record — profile, venue ticket-type +
details, contact, stage, notes, thread history — instead of filling a fixed template, and
**sends it from the artist's Gmail**. **Tone-learning loop:** store the *proposed* draft vs
the *sent* version; the diff is the per-user tone signal, fed back as few-shot examples.

### 2. Intelligent pipeline  (stateful, conversation-driven)
- Activity log ingests **emails** (Gmail read) and **manual call logs**.
- Stage advances on **events**: sent → outreach; reply → waiting; quiet N days → follow-up;
  artist confirms → won/dead.
- **Scheduled follow-ups:** edit + **lock** the follow-up text, save, **schedule send** from
  the artist's Gmail. *Intelligent disconnect:* a reply before the scheduled time
  auto-cancels the queued send.

### 3. Calendar  (Google Calendar, synced from the start)
- Availability view backed by the artist's Google Calendar; **won** gigs write back as events.
- The assistant checks conflicts and **proposes dates** when a booker asks.

## Build sequence
| Slice | What | Needs LLM key? |
|---|---|---|
| **A — Google substrate** (keystone) | OAuth scopes + offline refresh-token capture/store + worker skeleton + Gmail **read** → pipeline activity/stage | No |
| **B — Send + scheduled follow-ups** | Send outreach from the artist's Gmail; `scheduled_messages` + worker; intelligent disconnect | No |
| **C — Agentic drafting + tone learning** | LLM composes/tunes outreach; few-shot from sent-vs-proposed diffs | **Yes (Gemini/Grok)** |
| **D — Google Calendar** | Two-way sync, availability, conflict-check; LLM date proposals | UI no / proposals yes |

A is the foundation B–D ride on (same OAuth + worker).

## Open decisions
1. **LLM provider:** **Gemini** (recommended — one Google project/billing alongside Gmail +
   Calendar) vs **Grok** (you have credits; OpenAI-compatible). Pick one.
2. **Worker host:** Railway cron service (parity) vs Supabase `pg_cron` + Edge Function.
3. **Re-consent UX:** prompt for Google consent on every login (always-fresh token, extra
   click) vs only on first connect (simpler, but the ~7-day expiry bites inactive users).

## Google Cloud prereqs (your hands — guided)
- OAuth consent screen → add scopes (`gmail.readonly`, `gmail.send`, `calendar.events`);
  add the roster as **test users**; keep status **Testing**.
- Enable **Gmail API** + **Google Calendar API** in the project.
- LLM key: Gemini (AI Studio) or Grok (xAI console).
