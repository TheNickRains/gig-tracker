const { randomUUID, timingSafeEqual } = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { desired, projectEvent, recurrenceEnd } = require('./calendar-publish-data');
const { fetchPublishedEvents, matchPublishedEvents, UNCERTAIN_SAVE_ISSUE } = require('./bandsintown-published');

const DAY = 86400000;
const filtered = (key, value) => key + '=eq.' + encodeURIComponent(value);

function equalToken(a, b) {
  return typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b)
    && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function createCalendarPublisher(deps, env = process.env) {
  const artist = env.SHOW_SYNC_ARTIST_ID;
  if (!artist) return null;
  const fetchGoogle = deps.fetch || fetch;
  const live = env.SHOW_SYNC_LIVE === 'true';
  const pilot = env.SHOW_SYNC_PILOT_EVENT_ID || null;
  const bookingAccount = 'booking@nickrainsmusic.com';
  const calendarId = env.SHOW_SYNC_CALENDAR_ID || bookingAccount;
  const address = new URL('/calendar-publish/google', env.SHOW_SYNC_URL);
  if (address.protocol !== 'https:' || (live && (env.SHOW_SYNC_RUNNER_TOKEN || '').length < 32)) {
    throw new Error('Show publishing requires an HTTPS URL and live mode requires a runner token of at least 32 characters.');
  }
  const statePath = 'calendar_publish_state?' + filtered('artist_id', artist);
  const showsPath = 'calendar_publish_shows?' + filtered('artist_id', artist);
  const calendar = 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/events';
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  let running = false;
  let rescan = false;
  let wakeAgain = false;
  let timer;
  let retry = 1000;
  let leaseWake;
  let heartbeat;
  let closed = false;
  let reviewTimer;
  let reviewDue = Infinity;
  let checkingReviews = false;
  const reviewAbort = new AbortController();
  // An existing ID can refer to a prior version whose cleared optional fields
  // aren't observable in the feed. Edits still require the browser receipt.
  const uncertainPath = showsPath + '&operation=eq.upsert&status=eq.review&bandsintown_id=is.null&' +
    filtered('issue', UNCERTAIN_SAVE_ISSUE) + (pilot ? '&' + filtered('event_id', pilot) : '');

  async function state() {
    const [current] = await deps.get(statePath + '&limit=1');
    if (current?.calendar_id !== calendarId) {
      throw new Error('Show publishing state is not bound to the configured Calendar');
    }
    return current;
  }
  const wake = () => {
    for (const socket of sockets.clients) {
      if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 4096) socket.send('pending');
    }
  };

  function scheduleReviewCheck(delay) {
    if (!live || closed || Date.now() + delay >= reviewDue) return;
    clearTimeout(reviewTimer);
    reviewDue = Date.now() + delay;
    reviewTimer = setTimeout(() => {
      reviewDue = Infinity;
      void checkUncertainSaves();
    }, delay);
    reviewTimer.unref();
  }

  async function checkUncertainSaves() {
    if (closed) return;
    if (checkingReviews) { scheduleReviewCheck(60000); return; }
    checkingReviews = true;
    try {
      await state();
      const candidates = await deps.get(uncertainPath + '&select=event_id,revision,listing,updated_at,operation,status,issue,bandsintown_id&order=event_id.asc');
      const rows = candidates.filter(row => row.operation === 'upsert' && row.status === 'review' &&
        row.issue === UNCERTAIN_SAVE_ISSUE && !row.bandsintown_id && (!pilot || row.event_id === pilot));
      if (closed || !rows.length) return;
      const events = await fetchPublishedEvents({ fetch: deps.fetch, signal: reviewAbort.signal,
        appId: env.SHOW_SYNC_BANDSINTOWN_APP_ID, dates: rows.map(row => row.listing?.date) });
      if (closed) return;
      const matches = rows.map(row => ({ row, result: matchPublishedEvents(events, row.listing) }));
      const counts = new Map();
      for (const { result } of matches) {
        if (result.status === 'matched') counts.set(result.id, (counts.get(result.id) || 0) + 1);
      }
      let unresolved = false;
      for (const { row, result } of matches) {
        if (closed) return;
        if (result.status !== 'matched' || counts.get(result.id) !== 1) {
          unresolved = true;
          continue;
        }
        await deps.patch(uncertainPath + '&' + filtered('event_id', row.event_id) + '&' + filtered('revision', row.revision), {
          status: 'published', bandsintown_id: result.id, issue: null, updated_at: new Date().toISOString(),
        });
      }
      if (unresolved) {
        const recent = rows.some(row => Date.parse(row.updated_at) > Date.now() - 60 * 60000);
        scheduleReviewCheck(recent ? 60000 : 15 * 60000);
      }
    } catch (error) {
      if (!closed) console.error('Checking unconfirmed Bandsintown saves:', error.message);
      scheduleReviewCheck(60000);
    } finally {
      checkingReviews = false;
    }
  }

  async function calendarAccessToken() {
    if (env.SHOW_SYNC_GOOGLE_REFRESH_TOKEN) return deps.refresh(env.SHOW_SYNC_GOOGLE_REFRESH_TOKEN);
    const [connection] = await deps.get('google_connections?' + filtered('artist_id', artist) + '&select=refresh_token&limit=1');
    if (!connection?.refresh_token) throw new Error('Connect the booking Google account in Gig Collective.');
    const token = await deps.refresh(connection.refresh_token);
    const account = await deps.googleAccount(token);
    if (account?.emailAddress?.toLowerCase() !== bookingAccount) {
      throw new Error('The connected Google account must be booking@nickrainsmusic.com.');
    }
    return token;
  }

  async function google(url, token, body) {
    const headers = { Authorization: 'Bearer ' + token };
    if (body) headers['Content-Type'] = 'application/json';
    const response = await fetchGoogle(url, {
      method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    if (response.status === 410) return null;
    if (!response.ok) throw new Error('Calendar API returned ' + response.status);
    return response.json();
  }

  async function pages(path, query, token) {
    const params = new URLSearchParams(query);
    const items = [];
    let timeZone;
    let response;
    do {
      response = await google(path + '?' + params, token);
      if (!response) return null;
      items.push(...(response.items || []));
      timeZone = response.timeZone || timeZone;
      if (response.nextPageToken) params.set('pageToken', response.nextPageToken);
    } while (response.nextPageToken);
    return { items, timeZone, cursor: response.nextSyncToken };
  }

  async function sync(current, token, full) {
    const expected = current.cursor;
    let selected = await pages(calendar, {
      showDeleted: 'true', singleEvents: 'false',
      ...(!full && expected ? { syncToken: expected } : {}),
    }, token);
    if (!selected && !full) {
      full = true;
      selected = await pages(calendar, { showDeleted: 'true', singleEvents: 'false' }, token);
    }
    if (!selected?.cursor) throw new Error('Calendar returned no sync token');

    const now = Date.now();
    const options = {
      now, timeZone: selected.timeZone, resolveVenue: deps.resolveVenue,
    };
    const project = new Map();
    const existing = await deps.get(showsPath + '&select=event_id,series_id,listing,status,bandsintown_id&order=event_id.asc');
    const byId = new Map(existing.map(row => [row.event_id, row]));
    const bySeries = new Map();
    for (const row of existing) {
      if (!row.series_id) continue;
      if (!bySeries.has(row.series_id)) bySeries.set(row.series_id, []);
      bySeries.get(row.series_id).push(row);
    }

    for (const event of selected.items) {
      if (event.status === 'cancelled' || !event.recurrence?.length || event.recurringEventId) continue;
      const end = recurrenceEnd(event, now);
      const exceptions = await pages(calendar + '/' + encodeURIComponent(event.id) + '/instances', {
        timeMin: new Date(now).toISOString(), showDeleted: 'true',
        ...(end ? { timeMax: end } : {}),
      }, token);
      if (!exceptions) throw new Error('Calendar could not expand a recurring show');
      const occurrences = new Set();
      for (const occurrence of exceptions.items) {
        occurrences.add(occurrence.id);
        project.set(occurrence.id, await projectEvent(occurrence, options));
      }
      for (const old of bySeries.get(event.id) || []) {
        if (!occurrences.has(old.event_id) && Date.parse(old.listing?.showAt) > now &&
          (!end || Date.parse(old.listing?.showAt) < Date.parse(end))) {
          project.set(old.event_id, desired({ id: old.event_id, recurringEventId: event.id }, 'remove'));
        }
      }
    }

    for (const event of selected.items) {
      if (event.status === 'cancelled') {
        for (const old of bySeries.get(event.id) || []) {
          if (old.bandsintown_id || Date.parse(old.listing?.showAt) > now || old.status === 'working') {
            project.set(old.event_id, desired({ id: old.event_id, recurringEventId: event.id }, 'remove'));
          }
        }
        if (byId.has(event.id)) {
          project.set(event.id, desired(event, 'remove'));
        }
      } else if (!event.recurrence?.length && !project.has(event.id)) {
        if (!byId.has(event.id) && Date.parse(event.start?.dateTime) <= now) continue;
        project.set(event.id, await projectEvent(event, options));
      }
    }

    if (full) {
      for (const old of existing) {
        if (!project.has(old.event_id) && Date.parse(old.listing?.showAt) > now) {
          project.set(old.event_id, desired({ id: old.event_id, recurringEventId: old.series_id }, 'remove'));
        }
      }
    }
    const rows = [...project.values()].flatMap(row => {
      const old = byId.get(row.event_id);
      if (row.operation === 'upsert' || old?.bandsintown_id || old?.status === 'working') return [row];
      if (row.listing?.exclusion) return [desired({ id: row.event_id, recurringEventId: row.series_id,
        htmlLink: row.calendar_link }, 'ignore', row.listing)];
      return old ? [row] : [];
    });
    const changed = await deps.rpc('calendar_publish_apply', {
      p_artist: artist, p_cursor: selected.cursor, p_expected: expected, p_received: current.received,
      p_rows: rows, p_live: live, p_pilot_event: pilot,
    });
    if (changed < 0) wakeAgain = true;
    if (changed > 0) wake();
    if (changed > 0 && live && rows.some(row => row.issue)) {
      await deps.notify(artist, 'Show publishing needs a detail', 'Open the Calendar publishing inbox to review.', '/app#calendar')
        .catch(() => {});
    }
  }

  async function replaceWatch(current, token) {
    const channels = current.channels.filter(channel => channel.expiration > Date.now());
    const watch = { id: randomUUID(), token: randomUUID() + randomUUID(), expiration: Date.now() + 7 * DAY };
    // Persist first because Google can deliver the initial push before watch returns.
    await deps.patch(statePath, { channels: [...channels, watch] });
    try {
      const watched = await google(calendar + '/watch', token, {
        id: watch.id, token: watch.token, type: 'web_hook', address: address.href, expiration: String(watch.expiration),
      });
      watch.expiration = Number(watched?.expiration);
      watch.resourceId = watched?.resourceId;
      if (!watch.resourceId || !Number.isFinite(watch.expiration) || watch.expiration <= Date.now()) {
        throw new Error('Calendar watch did not return an active channel');
      }
      await deps.patch(statePath, { channels: [...channels, watch] });
      return watch.expiration;
    } catch (error) {
      await deps.patch(statePath, { channels });
      throw error;
    }
  }

  async function process(full = false) {
    if (closed) return;
    rescan ||= full;
    if (running) { wakeAgain = true; return; }
    running = true;
    clearTimeout(timer);
    let scanAll;
    try {
      do {
        wakeAgain = false;
        scanAll = rescan;
        rescan = false;
        const current = await state();
        const expires = Math.max(0, ...current.channels.filter(channel => channel.resourceId).map(channel => channel.expiration));
        const renewing = expires - Date.now() <= DAY;
        const token = await calendarAccessToken();
        const expiration = renewing ? await replaceWatch(current, token) : expires;
        // Full watch-renewal reconciliation also extends indefinite recurrences.
        scanAll ||= renewing || !current.cursor;
        await sync(current, token, scanAll);
        const latest = await state();
        wakeAgain ||= latest.received > latest.processed;
        retry = 1000;
        if (closed) return;
        timer = setTimeout(() => void process(true), Math.max(1000, expiration - Date.now() - DAY));
        if (wakeAgain) clearTimeout(timer);
      } while (wakeAgain);
    } catch (error) {
      if (closed) return;
      rescan ||= scanAll;
      console.error('Show publishing sync:', error.message);
      timer = setTimeout(() => void process(), retry);
      retry = Math.min(retry * 2, 300000);
    } finally {
      running = false;
    }
  }

  function response(req, res, status, data) {
    res.writeHead(status, { ...deps.cors(req), 'Cache-Control': 'no-store' });
    res.end(data == null ? undefined : JSON.stringify(data));
  }

  async function runner(req, res, action) {
    if (!live || !equalToken(req.headers.authorization, 'Bearer ' + env.SHOW_SYNC_RUNNER_TOKEN)) {
      return response(req, res, 403, { error: 'Publishing runner unavailable' });
    }
    const current = await state();
    if (action === 'claim') {
      // Process already-received Calendar data before dispatching a job.
      if (running || current.received > current.processed) {
        setTimeout(wake, 1000);
        return response(req, res, 409, { error: 'Calendar is syncing' });
      }
      const [job] = await deps.rpc('calendar_publish_claim', { p_artist: artist, p_pilot_event: pilot });
      if (job) {
        clearTimeout(leaseWake);
        leaseWake = setTimeout(wake, 10 * 60000 + 1000);
      } else {
        const [working] = await deps.get(showsPath + '&status=eq.working&select=started_at&limit=1');
        if (working) {
          clearTimeout(leaseWake);
          leaseWake = setTimeout(wake, Math.max(1000, Date.parse(working.started_at) + 10 * 60000 + 1000 - Date.now()));
        }
      }
      return response(req, res, 200, { job: job || null });
    }
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 8192) return response(req, res, 413);
    }
    let result;
    try { result = JSON.parse(body); } catch { return response(req, res, 400); }
    if (!result || typeof result.event_id !== 'string' || !/^[\w-]{1,512}$/.test(result.event_id) ||
        (pilot && result.event_id !== pilot) || !/^[\da-f-]{36}$/i.test(result.revision || '')) return response(req, res, 400);
    const path = showsPath + '&' + filtered('event_id', result.event_id);
    const [job] = await deps.get(path + '&limit=1');
    if (action === 'check') {
      return response(req, res, 200, { current: !running && current.received === current.processed &&
        job?.status === 'working' && job.revision === result.revision });
    }
    if (!job || action !== 'result') return response(req, res, 404);
    if (!['verified', 'review'].includes(result.status)) return response(req, res, 400);
    const listingId = /^\d{1,30}$/.test(result.bandsintown_id || '') ? String(result.bandsintown_id) : null;
    if (job.revision !== result.revision || job.status !== 'working') {
      if (result.status === 'verified' && listingId && !job.bandsintown_id) {
        const patch = { bandsintown_id: listingId };
        if (job.operation === 'remove' && ['removed', 'review'].includes(job.status)) { patch.status = 'pending'; patch.issue = null; }
        await deps.patch(path + '&' + filtered('revision', job.revision) + '&bandsintown_id=is.null', patch);
      }
      wake();
      return response(req, res, 409, { error: 'A newer Calendar version superseded this job' });
    }
    if (result.status === 'verified' && job.operation === 'upsert' && !listingId) return response(req, res, 400);
    const status = result.status === 'review' ? 'review' : job.operation === 'remove' ? 'removed' : 'published';
    await deps.patch(path + '&' + filtered('revision', job.revision) + '&status=eq.working', {
      status, issue: status === 'review' ? String(result.issue || 'Check this listing in Bandsintown.').slice(0, 250) : null,
      bandsintown_id: status === 'removed' ? null : listingId || job.bandsintown_id,
      updated_at: new Date().toISOString(),
    });
    if (status === 'review' && result.issue === UNCERTAIN_SAVE_ISSUE && job.operation === 'upsert' && !job.bandsintown_id) {
      scheduleReviewCheck(30000);
    }
    if (status === 'review') await deps.notify(artist, 'Bandsintown needs your review', 'Open the Calendar publishing inbox.', '/app#calendar').catch(() => {});
    wake();
    return response(req, res, 204);
  }

  async function route(req, res, pathname) {
    try {
      if (pathname === '/calendar-publish/public' && req.method === 'GET') {
        await state();
        const pilotFilter = pilot ? '&' + filtered('event_id', pilot) : '';
        const rows = live ? await deps.get(showsPath + pilotFilter + "&operation=eq.upsert&status=neq.preview&listing->>type=eq.original&select=public_id,listing&order=event_id.asc") : [];
        const shows = rows
          .filter(row => !row.listing.validationIssue && Date.parse(row.listing.showAt) > Date.now() - 4 * 3600000)
          .map(({ public_id, listing }) => {
            const { validationIssue, ...publicFields } = listing;
            return { id: public_id, ...publicFields };
          });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=30' });
        return res.end(JSON.stringify({ shows }));
      }
      if (req.method !== 'POST') return response(req, res, 405);
      if (pathname === '/calendar-publish/google') {
        const current = await state();
        const channel = current?.channels.find(value => value.id === req.headers['x-goog-channel-id']);
        if (!channel || channel.expiration <= Date.now() || !equalToken(channel.token, req.headers['x-goog-channel-token']) ||
            (channel.resourceId && channel.resourceId !== req.headers['x-goog-resource-id'])) {
          return response(req, res, 403);
        }
        await deps.rpc('calendar_publish_receive', { p_artist: artist });
        response(req, res, 204);
        if (running) wakeAgain = true;
        else void process();
        return;
      }
      if (pathname === '/calendar-publish/week') {
        const key = env.SHOW_SYNC_SHEETS_TOKEN;
        if (!key || key.length < 32 || !equalToken(req.headers.authorization, 'Bearer ' + key)) {
          return response(req, res, 403);
        }
        await state();
        const start = new URL(req.url, address).searchParams.get('start');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '') || !Number.isFinite(Date.parse(start))) {
          return response(req, res, 400);
        }
        const end = new Date(Date.parse(start) + 7 * DAY).toISOString().slice(0, 10);
        const rows = await deps.get(showsPath + '&operation=eq.upsert&select=listing,status,issue&order=event_id.asc');
        return response(req, res, 200, { rows: rows
          .filter(row => row.listing.date >= start && row.listing.date < end)
          .sort((a, b) => (a.listing.date + a.listing.time).localeCompare(b.listing.date + b.listing.time)) });
      }
      if (pathname === '/calendar-publish/retry') {
        if (!live || await deps.user(req) !== artist) return response(req, res, 403);
        await state();
        const event = new URL(req.url, address).searchParams.get('event');
        if (!/^[\w-]{1,512}$/.test(event || '') || (pilot && event !== pilot)) return response(req, res, 400);
        const path = showsPath + '&' + filtered('event_id', event) + '&status=eq.review';
        const [job] = await deps.get(path + '&select=revision,operation,listing,bandsintown_id&limit=1');
        if (!job || job.listing?.validationIssue || (job.operation === 'remove' && !job.bandsintown_id)) {
          return response(req, res, 409, { error: 'Resolve this issue in Calendar or Bandsintown first' });
        }
        const changed = await deps.patch(path + '&' + filtered('revision', job.revision), {
          status: 'pending', issue: null, revision: randomUUID(), updated_at: new Date().toISOString(),
        });
        if (!changed.length) return response(req, res, 409);
        wake();
        return response(req, res, 202);
      }
      if (pathname === '/calendar-publish/status') {
        if (await deps.user(req) !== artist) return response(req, res, 403);
        await state();
        const mode = live ? (pilot ? 'pilot' : 'live') : 'preview';
        return response(req, res, 200, {
          mode, runnerConnected: [...sockets.clients].some(socket => socket.readyState === WebSocket.OPEN),
        });
      }
      if (pathname === '/calendar-publish/reconcile') {
        if (await deps.user(req) !== artist) return response(req, res, 403);
        await state();
        response(req, res, 202);
        void process(true);
        return;
      }
      if (pathname.startsWith('/calendar-publish/runner/')) return await runner(req, res, pathname.split('/').at(-1));
      return response(req, res, 404);
    } catch (error) {
      console.error('Calendar publishing route:', error.message);
      if (!res.headersSent) response(req, res, 503, { error: 'Calendar publishing is temporarily unavailable' });
      else res.end();
    }
  }

  function attach(server) {
    server.on('upgrade', (req, socket, head) => {
      if (req.url !== '/calendar-publish/runner/live' || !live ||
          !equalToken(req.headers.authorization, 'Bearer ' + env.SHOW_SYNC_RUNNER_TOKEN)) return socket.destroy();
      sockets.handleUpgrade(req, socket, head, ws => {
        ws.alive = true;
        ws.on('pong', () => { ws.alive = true; });
        ws.on('error', () => {});
        ws.send('pending');
      });
    });
    heartbeat = setInterval(() => {
      for (const ws of sockets.clients) {
        if (!ws.alive) { ws.terminate(); continue; }
        ws.alive = false;
        if (ws.readyState === WebSocket.OPEN) ws.ping();
      }
    }, 30000);
    heartbeat.unref();
  }

  async function start() {
    if (closed) return;
    try {
      await deps.createState({ artist_id: artist, calendar_id: calendarId });
      scheduleReviewCheck(0);
      await process(true);
    } catch (error) {
      if (closed) return;
      console.error('Calendar publishing startup:', error.message);
      timer = setTimeout(() => void start(), 30000);
    }
  }

  function close() {
    closed = true;
    clearTimeout(reviewTimer);
    reviewAbort.abort();
    clearTimeout(timer);
    clearTimeout(leaseWake);
    clearInterval(heartbeat);
    for (const socket of sockets.clients) socket.terminate();
    sockets.close();
  }
  return { attach, route, start, close };
}

module.exports = { createCalendarPublisher };
