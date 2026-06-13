# Gig Collective

An intelligent gig-booking assistant for working musicians. It reads your booking inbox, moves each conversation through a pipeline, drafts the right outreach in your own voice, and schedules sends around your real availability — so a stack of business cards turns into booked shows instead of dropped threads.

Built and dogfooded against a real touring musician's pipeline.

## What it does

- **Inbox → pipeline.** Connects your Gmail; replies advance deals through `lead → pitched → talks → hold → booked → played` automatically, both directions logged.
- **AI drafting.** Context-aware drafts (Gemini) that read the whole thread, the venue, the buyer, and your past sent mail — channel-aware (email vs. text), and learns your voice from every edit you make.
- **Scheduled sends.** Queue a message; it fires on time and cancels itself if they reply first.
- **Calendar.** Two-way Google Calendar sync — availability in, gig dates out.
- **People × Rooms × Deals.** Talent buyers are first-class and travel across the venues (rooms) they book.
- **The Collective.** A shared layer of venue intel and wins across an invited roster.

The full intent and behavioral contract live in [`knowledge base/agent-framework.md`](knowledge%20base/agent-framework.md).

## Architecture

| Piece | What it is |
|---|---|
| `app/index.html` | The entire client — one file, no build step, `supabase-js` over CDN. |
| `server.js` | Zero-dependency static server; generates `/config.js` from env at runtime. |
| `worker/index.js` | Background service: Gmail push + poll, AI drafting, calendar sync, scheduled sends. |
| `supabase/` | Postgres schema + numbered migrations. RLS keeps pipelines private; venue intel is shared. |
| `knowledge base/` | Design system, UX spec, decision journal, agent framework. **Code is the source of truth** — some docs trail it. |

LLM is Gemini. Auth + data is Supabase. Hosting is Railway (app + worker as two services).

## Run locally

```bash
npm install
# provide SUPABASE_URL + SUPABASE_ANON_KEY in the environment (or app/config.js)
npm start          # serves the app on the configured port
```

The worker runs separately (`cd worker && npm install && npm start`) and needs its own service credentials — never committed; see `worker/` and the migrations.

## Contributing / workflow

`main` is the stable, deployed line. Work happens on `feat/<name>` branches → pull request → merge. Deploys are gated to `main`.

## License

All rights reserved (for now). Open an issue if you want to use any of it.
