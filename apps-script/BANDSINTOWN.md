# Calendar publishing setup

The publisher subscribes directly to the Google Calendar identified by `SHOW_SYNC_CALENDAR_ID` using Google’s HTTPS event watch. Create and edit your dates in Google Calendar by hand or as recurring events. This watch operates independently of Gig Collective’s booking pipeline. The publishing queue belongs to one artist UUID and one Google Calendar ID. Other artists’ Google connections and booking records do not feed this queue. The worker refuses to reuse that queue if its configured Calendar ID changes. Gig Collective’s **Calendar → Show publishing** panel displays results, and a WebSocket delivers queued changes from the worker to the Bandsintown browser runner. It reconciles when renewing the Google subscription, on startup, and when you choose **Recheck Calendar**.

## Worker and Calendar

1. Apply `supabase/migration-041-calendar-publishing.sql` to the Gig Collective database and deploy the updated worker and PWA. Run a single replica of the publishing worker.
2. Use the existing Gig Collective Google connection for `booking@nickrainsmusic.com`. The worker takes the token only from the configured artist's connection and verifies the signed-in Google email before watching the booking calendar. The publisher does not edit Calendar events. A separate grant is optional. [Google Calendar watch scopes](https://developers.google.com/workspace/calendar/api/v3/reference/events/watch)
3. Set these worker environment variables in the deployment dashboard.

   | Variable | Value |
   |---|---|
   | `SHOW_SYNC_ARTIST_ID` | Nick’s UUID from the Gig Collective `artists` table |
   | `SHOW_SYNC_CALENDAR_ID` | Defaults to `booking@nickrainsmusic.com`. Set the actual calendar ID if bookings live on a separate calendar. |
   | `SHOW_SYNC_URL` | Public HTTPS origin of the Gig worker |
   | `SHOW_SYNC_GOOGLE_REFRESH_TOKEN` | Optional dedicated read-only grant. Leave unset to reuse the existing booking-account connection. |
   | `SHOW_SYNC_RUNNER_TOKEN` | Required for live publishing. Set a dedicated random secret of at least 32 characters and share it with the local browser runner |
   | `SHOW_SYNC_SHEETS_TOKEN` | A different random secret of at least 32 characters for the workbook |
   | `SHOW_SYNC_LIVE` | Keep `false` for the initial preview |
   | `SHOW_SYNC_PILOT_EVENT_ID` | An optional Google event ID that limits live changes to one listing during the supervised trial |

   If using a dedicated grant, the existing `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` must match the OAuth client that issued its refresh token. If `PLACES_API_KEY` is set, enable Places Text Search and Time Zone for venue lookup.
4. Review the initial queue before enabling writes. Confirm gigs by setting the event color to Sage or Basil. Gray, uncolored, and other events stay off the publishing queue and appear under **Held back**, where applicable. In Calendar notes use `Show type: Original`, `Show type: Cover`, or `Show type: Busking`. The `Original:`, `Cover:`, and `Busking:` title prefixes also work. Add public details on separate lines using `Doors:`, `Show time:`, `Ticket price:`, `Ticket URL:`, or `Public notes:`. Put the named venue and address in Location. Use `Publish: No`, `HOLD`, or `PRIVATE` to take the show out of publication.

## Signed-in browser trial

1. Sign in to Bandsintown for Artists as an editor for artist ID `3251702` in a dedicated browser session on the machine running the browser agent. Confirm that `orca skills get computer-use --json` and `codex exec --help` both work on that machine. Leave the browser available to Orca.
2. Install dependencies with `npm ci` in `worker/`. Set `SHOW_SYNC_URL` and `SHOW_SYNC_RUNNER_TOKEN` on that machine and run `node bandsintown-runner.js` from `worker/`. The same machine needs the authenticated Codex CLI and the computer-use skill.
3. Set `SHOW_SYNC_PILOT_EVENT_ID` to the Google API event ID for one show and turn on `SHOW_SYNC_LIVE`. Supervise a create, a time edit, and a deletion for that listing. Verify the signed-in artist, venue-local time, and fan notification controls on the current dashboard. If a browser action cannot be verified, check the listing in Bandsintown before using **Retry Bandsintown**.
4. Remove the pilot event ID when ready to enable the full queue. Stop the browser runner any time you need to pause Bandsintown writes. Confirm that the first original appears on the live site. The site uses the production Gig worker feed by default. Set `VITE_SHOW_FEED_URL` when building the site against a different worker.

The browser runner connects only after its computer-use preflight passes. An expired login or an unverified save appears in the private inbox. A job begins with the latest synced Calendar revision and checks it again before confirming a write.

## Weekly Sheets view

Under `nickrainsmusic@gmail.com`, make a workbook with a tab called **Template** copied from the current Bandsintown **Upload Events** download. Cross-check it against [your linked template](https://docs.google.com/spreadsheets/d/1BwhgMbrQDq25IfdoGkJCXmC75M-XfdPiLzmT_lgksQw/edit?usp=sharing).

Add `bandsintown-week.gs` under **Extensions → Apps Script** in that workbook. In **Project Settings → Script properties**, set `SHOW_SYNC_URL`, `SHOW_SYNC_SHEETS_TOKEN`, and, if needed, `TEMPLATE_HEADER_ROW`. Reopen the workbook and choose **Bandsintown → Prepare next week** or **Set up Friday refresh**. The script generates a Monday–Sunday batch and an adjacent review tab using the workbook’s time zone. It uses the worker’s private weekly endpoint, so the Gmail account needs access to the workbook.

If using the file as a fallback, pause automatic Bandsintown publishing and compare the rows with the current dashboard before submitting. Verify the accepted file format in the live dashboard.
