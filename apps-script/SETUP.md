# Slice 2 — read-only inbox agent setup

`email-agent.gs` runs inside your `booking@nicholasrains.com` Google account on a
timer. It **reads** Gmail (never sends/modifies), asks Claude what each booker
reply means, logs it to your pipeline, and advances `outreach → waiting` when a
booker replies. Won/Dead are **proposed in the activity note**, never auto-applied.

## 1. Gather 4 values

| Script property | Where to get it |
|---|---|
| `SUPABASE_URL` | `https://fjqfqykytqtwqbzyihqq.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Supabase → Project Settings → API → **service_role** key. ⚠️ Bypasses RLS — only ever lives in Script Properties, never in the app or git. |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys → create key (`sk-ant-...`) |
| `ARTIST_ID` | Supabase → Authentication → Users → the UID for `booking@nicholasrains.com` (or run `select id, email from auth.users;` in the SQL editor) |

## 2. Create the script
1. Go to **script.google.com** — make sure you're signed in as **booking@nicholasrains.com** (it reads *that* account's inbox).
2. **New project** → paste in the contents of `email-agent.gs`.
3. **Project Settings → Script properties** → add the 4 properties above.
4. Back in the editor, run **`syncInbox`** once. Google will prompt you to authorize **read-only Gmail** access — review and allow. (You'll see an "unverified app" screen since it's your own script — continue.)
5. **Triggers** (clock icon) → **Add trigger** → function `syncInbox`, event source *Time-driven*, **every 10 minutes**.

## 3. Cost / model
Defaults to `claude-opus-4-8` (per the Anthropic guidance — don't downgrade silently).
For a high-volume email classifier, **`claude-haiku-4-5` is ~5× cheaper** and well
suited to this — change the `MODEL` constant at the top of `email-agent.gs` if you
prefer cost over headroom. Each email is one short request (a few hundred tokens).

## 4. What you'll see
- Booker replies appear in the venue's **Activity** log within ~10 min, e.g.
  *"Tom asked for your EPK  [suggests: waiting]"* or *"Confirmed Sept 14, $400  [suggests: won — confirm in app]"*.
- Stage auto-moves `outreach → waiting` on first reply; you set Won/Dead yourself.
- Your **sent** emails are logged too (`email_out`) — the raw material for the
  tone-learning loop in the agentic-outreach slice.

## Scope (v1)
Watches **your** inbox only. Each roster member who wants this runs their own copy
bound to their inbox (or we build a centralized Gmail-API version later).
