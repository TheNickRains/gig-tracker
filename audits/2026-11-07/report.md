# Gig Collective audit — November 7, 2026

**Historical findings.** All 18 are patched and deployed as of November 12, 2026; see [implementation, verification, and rollout](patches.md). The report below describes the original pre-fix behavior. The matching app/worker release and migration 040 are live.

The most urgent finding is a reproducible wrong-recipient race: a realtime refresh can reorder the pipeline while an editor remains open, and Send now then acts on a different deal. The send queue also lacks the coordination needed to prevent duplicate sends and honor last-moment cancellations reliably.

Scope: the current working tree on `feat/bounce-resend`, including the pending bounce-resend change, the worker, static server, and committed database migrations. This was a source and offline behavioral audit, not a production penetration test. No production data was changed and no email was sent during the audit. Live database policies, hosting configuration, and Google account settings were not re-verified.

Evidence: **24 offline probes reproduced the failure behavior across 17 code findings**, plus one schema-level finding (A16). The original probes are archived in `reproduce-before-fixes.cjs.txt`; they require the pre-fix source. Run `npm test` for current regression coverage. A passing audit probe means the defect was reproduced, not that the behavior is correct. At audit time, the separate bounce-resend suite passed all 11 tests. Current validation is recorded in `patches.md`.

P1 = address before relying on the affected flow; P2 = significant functional or security gap to schedule next. These priorities do not mean every path has occurred in production.

| ID | Priority | Finding |
| --- | --- | --- |
| A01 | P1 | A live refresh can send an open draft to the wrong recipient |
| A02 | P1 | Ordinary send clicks and overlapping worker runs can send duplicates |
| A03 | P1 | Canceling or editing a send can race with the worker |
| A04 | P1 | A temporary Google error deletes the account connection; browser status stays stale |
| A05 | P1 | Failed sends disappear; an already accepted email can be marked failed |
| A06 | P1 | Unscheduled drafts and failed quick-log saves can lose the user's text |
| A07 | P2 | Correcting a contact does not update or flag an already queued recipient |
| A08 | P2 | Follow-ups can send before newly arrived replies are checked |
| A09 | P2 | Closing a deal does not cancel its scheduled messages |
| A10 | P2 | Opening a booking form is recorded as a successful submission |
| A11 | P2 | Reminder pushes can be marked completed without delivery |
| A12 | P2 | Calendar busy days persist after events disappear; multi-day events are incomplete |
| A13 | P2 | Gmail pagination and cursor handling can skip messages |
| A14 | P1 | Shared venue fields are inserted into executable HTML without escaping |
| A15 | P2 | A late AI response overwrites intervening human edits |
| A16 | P1 | Deleting a shared venue cascades into other artists' private records |
| A17 | P1 | A malformed request URL can throw out of the static server |
| A18 | P2 | Profile intake allows server requests to internal/private destinations |

**A01 — Bind actions to permanent deal IDs, not list positions.**

`loadPipeline()` sorts by latest activity and rebuilds numeric `id` values. `rerenderOpenDetail()` deliberately leaves the old DOM intact while an input has focus. Its buttons still invoke `sendNowInline(oldIndex)`, while `scheduleSend()` reads the newly reordered `pipeline[oldIndex]`. The probe opened A's editor, refreshed to order B/A, and queued A's private draft to B's email. Other detail actions using numeric indexes need the same review. Fix by carrying the immutable deal UUID through DOM handlers, drafts, asynchronous responses, and mutations, and validating the visible recipient at send time.

Sources: [pipeline rebuild](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/app/index.html:4259>), [held editor](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/app/index.html:4368>), [send action](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/app/index.html:3282>).

**A02 — Claim queue rows atomically and track delivery attempts durably.**

Ordinary Send now has no in-flight guard or request identity, so two clicks create two rows. Independently, `processScheduled()` reads due rows without claiming them; `/poke`, periodic ticks, and other worker instances can process the same row. Two concurrent calls in the probe produced two Gmail sends. A failed sent-status database write is only logged, leaving the row eligible to send again. The new bounce-resend UUID prevents duplicate queue insertion for that action, but does not fix worker concurrency or normal Send now. Use a unique submission identity, an atomic scheduled→sending claim, durable Gmail receipts, and an explicit uncertain state for ambiguous network outcomes; reconcile before retrying.

Sources: [queue insert](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/app/index.html:3304>), [worker dispatch](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/worker/index.js:756>), [ignored PATCH failures](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/worker/index.js:41>).

**A03 — Make cancellation and editing conditional on the real send state.**

Once the worker reads a due row, it uses that snapshot through token refresh and thread lookup. The user can receive “Send canceled” while that snapshot still sends; the worker subsequently writes `sent` over `canceled`. Editing during the same interval can send the old body while the database shows the corrected body. Both paths were reproduced. A claimed/sending state must prevent edits and make it clear when cancellation is too late. Conditional state updates must arbitrate which operation wins.

Sources: [cancel UI](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/app/index.html:3329>), [draft editing](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/app/index.html:3251>), [snapshot send](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/worker/index.js:778>).

**A04 — Preserve grants during temporary failures and show authoritative connection status.**

Every token-refresh exception, including network outages or Google 503s, deletes `google_connections` and clears the profile flag. An already-open page only ever changes its local connection flag from false to true, so it can keep showing connected. A new browser reads the disconnected account state. Both behaviors were reproduced. Retain the token during transient failures, retry with backoff, and distinguish temporary failure from revoked access. Read connection health consistently across browsers. This explains a possible mechanism for the earlier incident; it does not establish which original token error occurred.

Sources: [grant deletion](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/worker/index.js:829>), [sticky status](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/app/index.html:4030>).

**A05 — Failed sends need a visible, accurate outbox state.**

The UI loads only `scheduled` and `ready`, so failure removes the saved email from view. There is also a second ambiguity: Gmail can accept a message, then activity logging can throw, causing the enclosing catch to label the message `failed`. That path was reproduced. Keep failed/canceled messages reviewable, store the Gmail receipt with the message, separate delivery from later bookkeeping, and avoid offering blind retries for messages whose send outcome is uncertain. Recovery of the seven emails did not fix this underlying behavior.

Sources: [hidden terminal states](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/app/index.html:4354>), [accepted-send bookkeeping and catch](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/worker/index.js:790>).

**A06 — Persist work before redirects and clear inputs only after successful saves.**

Unscheduled bodies, subjects, and drafting context exist in JavaScript objects. Refreshing, closing the tab, or reconnecting Google through a full-page redirect can discard them. Quick-log text is cleared before its database insert succeeds; a failed save leaves no text to retry. The probes reproduced both losses. Autosave account-owned drafts, restore them after OAuth/navigation, and retain entered text until the server acknowledges saving it.

Sources: [draft storage](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/app/index.html:2899>), [quick-log clearing](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/app/index.html:3226>).

**A07 — Address corrections must expose existing queued recipients.**

The queue stores `to_email` at scheduling time. Editing the person updates their contact record, while the worker continues using the queue's old address. The locked draft primarily exposes its subject/body rather than this recipient mismatch. Preserving a recipient snapshot can be intentional, but the app needs to show it and flag a changed contact, allowing the user to explicitly update or cancel the pending send. Silently replacing a recipient would also be unsafe.

Sources: [contact save](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/app/index.html:2535>), [recipient snapshot](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/app/index.html:3305>), [worker recipient](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/worker/index.js:790>).

**A08 — “Cancels if they reply first” is not reliably enforced.**

Each tick processes scheduled sends before polling Gmail. If push delivery was delayed or missed, a reply already in Gmail is absent from `activities`, so the follow-up sends; only afterward does inbox synchronization discover the reply. The probe confirms this ordering. Refresh the relevant conversation before deciding to send a reply-sensitive follow-up, and postpone the send if that check cannot be completed.

Source: [tick order and reply gate](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/worker/index.js:820>).

**A09 — Passed/Dead deals can still send queued follow-ups.**

Changing the deal stage does not cancel its queued messages. The worker consults the stage only after sending, for pipeline advancement. A `dead` deal still sent in the probe. Closing a deal should surface its pending sends and apply an explicit policy—cancel them by default or require a deliberate choice to retain them.

Sources: [stage update](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/app/index.html:4481>), [stage checked after send](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/worker/index.js:793>).

**A10 — Opening an external form is not proof of submission.**

`openBookingForm()` immediately logs “Submitted via booking form” and moves a lead to Pitched, even if the popup was blocked or the user never submits. This also affects follow-up timing and reply/bounce resolution because it is logged as `email_out`. Record “form opened” separately; record submission only after the user confirms it.

Source: [booking-form action](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/app/index.html:2998>).

**A11 — Reminder delivery failures are treated as completed pushes.**

`pushDueReminders()` starts notification delivery without awaiting its outcome, then marks `reminder_pushed=true`. The same occurs if no subscription exists; `notify()` also swallows most delivery errors. A rejected push promise still marked the reminder pushed in the probe. Store per-device outcomes and retry transient failures; the in-app reminder remaining visible is not a substitute for the promised push.

Source: [reminder processing](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/worker/index.js:811>).

**A12 — Calendar import can misrepresent availability.**

Only an event's start date becomes busy, so the remaining days of a multi-day event are missed. Imported busy rows are indistinguishable from manually set rows and are only inserted, never reconciled when Google events move or disappear. The probe reproduced the incomplete range and stale busy day. Track source/event identity separately from manual overrides, expand date ranges in the relevant timezone, and reconcile updates/deletions. Separately, date-clear export drops the saved Google event ID without checking that Google's DELETE succeeded, making an orphaned event harder to repair.

Source: [calendar synchronization](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/worker/index.js:681>).

**A13 — Gmail sync can skip mail and truncate “full history.”**

Search returns at most 20 messages without pagination. History reads one page, and push processing advances the saved cursor even when the history API failed and returned an empty list. The probes confirm the missing next-page request and cursor advancement after a 503. The limited polling fallback may recover some mail, but cannot guarantee recovery beyond its recent/top-20 windows. Drain pages and commit cursors only after successful processing; distinguish API failure from a genuinely empty result.

Sources: [search/history requests](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/worker/index.js:121>), [cursor commit](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/worker/index.js:410>), [history import](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/worker/index.js:262>).

**A14 — Escape shared fields before rendering them as HTML.**

The deal header inserts venue name/type/city/state/pay directly into `innerHTML`; shared venue fields are editable by authenticated users under the committed policies. The offline probe passed a harmless HTML marker through the real rendering expression and confirmed its event-handler markup survived. This is a stored script-injection path when rendered in a browser, not just a formatting issue. Escape plain text, validate URLs, and remove inline handlers that mix JavaScript with untrusted strings. Toast rendering also accepts raw message HTML. No malicious content was inserted into production and no browser exploit was executed.

Sources: [unescaped detail header](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/app/index.html:2839>), [toast HTML](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/app/index.html:3959>), [shared write policy](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/supabase/schema.sql:120>).

**A15 — AI generation needs an editor revision check.**

When an AI response arrives it unconditionally replaces both the saved draft object and matching textarea. Typing while generation is in flight loses those edits; overlapping requests can also arrive out of order. The probe reproduced a late response replacing a human edit. Associate requests with a deal UUID and editor revision, and offer an explicit replacement when the draft changed meanwhile.

Source: [AI response application](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/app/index.html:2963>).

**A16 — Shared deletion has a larger scope than the private pipeline suggests.**

The committed schema permits every authenticated member to delete shared venues. Deleting a venue cascades into its pipeline entries, then their activities and scheduled messages, including other artists' private records. The UI warns “Deletes for everyone,” but that does not explain irreversible loss of other people's private work. Prefer archiving shared venues, restrict permanent deletion, and retain private deal history. This finding is based on the migration definitions; live constraints/policies were not inspected and no deletion was attempted.

Sources: [shared delete control](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/app/index.html:4890>), [venue-to-deal cascade](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/supabase/schema.sql:62>), [activity cascade](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/supabase/schema.sql:75>), [queued-message cascade](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/supabase/migration-011-scheduled-messages.sql:11>).

**A17 — Reject malformed URLs instead of throwing from the request handler.**

`decodeURIComponent()` runs outside a try/catch. Passing an invalid percent-encoded path to the actual handler threw `URIError` in the local probe; in the standalone server this is an uncaught request exception and can terminate the process. Return HTTP 400 for invalid paths. The production proxy's handling of such requests was not tested.

Source: [request parsing](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/server.js:52>).

**A18 — Restrict website/EPK fetches to public destinations.**

An authenticated intake request can supply an arbitrary HTTP URL, including loopback/private hosts; the worker follows redirects without validating destinations. The local probe confirms an internal URL is passed to fetch, using a mock response only. The actual reachable services and impact depend on hosting configuration. Validate resolved addresses and redirects, restrict schemes/ports, and set response-size and timeout limits before using the result as AI input.

Source: [website fetching](</Users/nicholasrains/code/Nick Rains Music/Repos/gig-tracker/worker/index.js:870>).

Recommended implementation order: first fix A01's recipient identity, then A02/A03/A05 as one coherent send-state change, and A04/A06 for connection and draft recovery. Address A14/A16/A17 before widening access to the collective. Then close the contact, follow-up, calendar, reminder, and sync gaps with desired-behavior regression tests derived from these probes.

This audit added the report and offline reproduction harness only. It did not modify application behavior or deploy any of these fixes.
