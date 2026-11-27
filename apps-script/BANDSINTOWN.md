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

Cover and busking shows publish with free admission. A cover booking can include a venue RSVP link in `Ticket URL:`. Original shows use their own admission details.

## Hosted Bandsintown browser

The Calendar webhook and queue live in `gig-worker`. Run the Bandsintown browser as a second persistent service in the same Railway project. The Mac is only used to open an authenticated SSH tunnel during sign-in.

1. Create a Railway service named `bandsintown-runner` from the same repository and branch. Set its root directory to `/worker` and set `RAILWAY_DOCKERFILE_PATH=Dockerfile.bandsintown`. Attach a volume at `/data`. Keep the service private. Chromium and the sign-in viewer listen on the container loopback.
2. Set `SHOW_SYNC_BROWSER_SETUP=true` on the browser service and deploy it. Copy its **Service Instance ID** from Railway. Add your SSH key to Railway if needed, then open the tunnel below in your Mac’s Terminal using that ID. Keep the SSH shell open while you use [the private browser viewer](http://127.0.0.1:6081/vnc.html?autoconnect=true). Sign in to Bandsintown for Artists as an editor for Nick Rains (artist ID `3251702`) and select **Keep me logged in** if available. Leave the Nick Rains artist dashboard tab open inside Chromium. Close the viewer and SSH tunnel after sign-in. The browser profile stays in the Railway volume. [Railway SSH port forwarding](https://docs.railway.com/cli/ssh)

   ```bash
   ssh -t -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 \
     -L 127.0.0.1:6081:127.0.0.1:6080 <service-instance-id>@ssh.railway.com
   ```

3. Set the following on `bandsintown-runner`, then redeploy. Share the runner token with `gig-worker`. Use a Railway variable reference for the existing Gemini key. [Railway variable references](https://docs.railway.com/variables)

   | Variable | Value |
   |---|---|
   | `SHOW_SYNC_BROWSER_SETUP` | `false` |
   | `SHOW_SYNC_URL` | `https://gig-worker-production.up.railway.app` |
   | `SHOW_SYNC_RUNNER_TOKEN` | The same dedicated random token of at least 32 characters on both services |
   | `GEMINI_API_KEY` | Reference the worker’s existing key with `${{gig-worker.GEMINI_API_KEY}}` |

4. In **Show publishing**, use **Copy trial ID** for one show. In a single Railway deploy for `gig-worker`, set `SHOW_SYNC_PILOT_EVENT_ID` to that ID, set the runner token, and set `SHOW_SYNC_LIVE=true`. Verify the pilot listing and the update/delete workflow before removing the pilot ID. A trial on a cover show exercises Bandsintown. An original also exercises the separate live-site feed. Keep the active site on the production Gig worker feed or set `VITE_SHOW_FEED_URL` for a different host.
5. If a show asks you to sign in again, reconnect the private tunnel from step 2, sign in, and leave the artist dashboard tab open. Check the affected listing, then use **Retry Bandsintown**.

If Bandsintown takes you to a particular dashboard URL after login, you can set `SHOW_SYNC_BANDSINTOWN_URL` to that URL on the browser service. Use the Bandsintown for Artists address without temporary sign-in or callback parameters.

The hosted runner verifies that a Calendar job is current before interacting with a dashboard control. Uncertain saves go into the private review queue. Stop the hosted browser service to pause Bandsintown writes.

## Weekly Sheets view

Under `nickrainsmusic@gmail.com`, make a workbook with a tab called **Template** copied from the current Bandsintown **Upload Events** download. Cross-check it against [your linked template](https://docs.google.com/spreadsheets/d/1BwhgMbrQDq25IfdoGkJCXmC75M-XfdPiLzmT_lgksQw/edit?usp=sharing).

Add `bandsintown-week.gs` under **Extensions → Apps Script** in that workbook. In **Project Settings → Script properties**, set `SHOW_SYNC_URL`, `SHOW_SYNC_SHEETS_TOKEN`, and, if needed, `TEMPLATE_HEADER_ROW`. Reopen the workbook and choose **Bandsintown → Prepare next week** or **Set up Friday refresh**. The script generates a Monday–Sunday batch and an adjacent review tab using the workbook’s time zone. It uses the worker’s private weekly endpoint, so the Gmail account needs access to the workbook.

If using the file as a fallback, pause automatic Bandsintown publishing and compare the rows with the current dashboard before submitting. Verify the accepted file format in the live dashboard.
