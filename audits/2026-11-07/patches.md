# Reliability patches — November 8, 2026

All 18 findings in the November 7 audit have local code fixes. These changes have **not been deployed**, and migration 040 has **not been applied to production**. No real emails were sent by the patch verification.

| Finding | Result |
| --- | --- |
| A01 | Open editors retain immutable deal identity across realtime sorting. Sending also checks the recipient displayed in the editor against the current contact. |
| A02 | Normal sends and bounce resends use persistent request IDs. Database RPCs serialize queue changes per deal; workers must atomically claim a message before Gmail receives a send request. |
| A03 | Edit/cancel actions compare the saved version and stop once sending begins. A stale worker snapshot cannot claim an edited or canceled message. |
| A04 | Temporary Google failures preserve the account grant. Revoked access prompts reconnect without deleting recovery data. Connection indicators refresh from account state in every browser. |
| A05 | Home and the outbox surface failed and uncertain delivery. Full saved messages remain reviewable, including on closed deals. Gmail receipts and activity logging are separate; bookkeeping failure cannot relabel an accepted send as failed. |
| A06 | Draft body, subject, angle, AI source, and request identity recover from account-scoped local storage and versioned cloud drafts. Conflicting browser edits require an explicit choice. Failed quick-log saves retain text. |
| A07 | The outbox shows its saved recipient and flags contact changes. The final claim pauses changed recipients for explicit review; editing confirms the current address. |
| A08 | Reply-sensitive follow-ups check current Gmail mail before claiming. A failed reply lookup postpones sending. The database also rechecks the assistant-send preference. |
| A09 | Closing a deal cancels pending sends in the same database transaction. Sending or uncertain delivery must be resolved before closing/deleting. |
| A10 | Opening a form no longer records submission or advances the deal. The artist explicitly confirms submission. |
| A11 | Reminder delivery is claimed and tracked per device. Failed pushes retry, and aggregate completion requires acknowledged delivery to every active subscription. Stable notification tags collapse duplicate delivery notifications. |
| A12 | Imported Google busy dates are separate from manual choices, cover multi-day events, and are reconciled after all pages load. Failed event deletes retain their Google ID for retry. Deterministic IDs protect new calendar events from duplicate creation. |
| A13 | Gmail search/history drain pagination. History checkpoints advance only after successful processing; expired cursors trigger resync, and polling resumes from the durable cursor. Reconnecting resets mailbox-specific cursors. |
| A14 | Shared venue text, profile previews, and toasts are escaped. URL links are limited to HTTP(S), and inline actions no longer embed shared venue names. |
| A15 | AI responses are bound to the deal and editor revision. Late suggestions remain available separately, without replacing intervening human edits. |
| A16 | Shared venues are archived/restorable; private deal history and archived room links remain available. Authenticated hard deletion is revoked and the venue-to-pipeline foreign key now restricts deletion. |
| A17 | Malformed/NULL-byte request URLs return HTTP 400 without terminating the static server. |
| A18 | Website intake validates all resolved IPs, pins DNS for the request, revalidates redirects, restricts ports/protocols, and caps time, redirects, content type, and body size. |

## Validation

- `npm test`: **54 passing offline regression tests**, including rendering the complete app script against a simulated DOM, worker concurrency/failure cases, draft recovery, sync, reminder delivery, and SSRF boundaries.
- `npm run test:database`: passes against isolated PostgreSQL 15 using the real schema and every migration through 040. Includes **36 SQL assertions**, competing queue requests, competing worker claims, and preservation/review of legacy pending messages during upgrade.
- JavaScript syntax checks and `git diff --check` pass.
- Tests use synthetic mail and mocked Google/push responses. Real browser layout, production RLS/schema drift, OAuth configuration, and live Google/push delivery still need deployment smoke checks.

The database runner requires an isolated local PostgreSQL server; defaults are socket `/private/tmp`, port `55440`, binaries `/opt/homebrew/opt/postgresql@15/bin`. Set `PGHOST`, `PGPORT`, and `PG_BIN` as needed. It creates and removes only its uniquely named test database. It rejects remote hosts.

## Rollout order

1. Stop all old worker instances and place the app in maintenance mode. Back up the affected database tables.
2. Apply `supabase/migration-040-reliability.sql` after migrations 001–039. The migration pauses existing scheduled messages for review and marks legacy failures without a definite pre-send explanation as uncertain. It preserves their full content.
3. Deploy the matching app and worker together, then resume traffic. Old app tabs must reload: direct browser queue writes are intentionally revoked.
4. Verify account connection status, draft recovery across reload/browser, queued address review, cancel/edit behavior, and calendar import. Use a deliberate test message to an account you control for the live Gmail check. Review paused/uncertain legacy attempts against Gmail Sent before releasing any message.

## Boundaries that remain explicit

Gmail and PostgreSQL cannot participate in one transaction. An ambiguous send is therefore held for receipt reconciliation or explicit verification; it is never automatically replayed. New sends use a stable RFC Message-ID for Sent-folder lookup. A reply arriving in the short interval between the final inbox check and Gmail accepting the outbound may still cross the outgoing message.

Legacy calendar rows have no trustworthy source marker. They are preserved and labeled for review instead of guessing which busy days were manually entered. Newly imported events reconcile separately and cannot overwrite manual preferences.

A successful web-push response means the push service accepted the notification; it cannot prove the device displayed it. A crash between push acceptance and saving its receipt can produce another push attempt, mitigated by the stable notification tag.

The original audit is historical. Its defect probes are archived as `reproduce-before-fixes.cjs.txt`; `node --test audits/2026-11-07/reproduce.cjs` now runs the desired-behavior regression suite.
