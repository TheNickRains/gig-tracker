const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { test } = require('node:test');
const { projectEvent, recurrenceEnd } = require('../worker/calendar-publish-data');
const { createCalendarPublisher } = require('../worker/calendar-publish');

const options = { now: Date.parse('2026-11-25T00:00:00Z'), timeZone: 'America/New_York' };
const event = {
  id: 'show1', summary: 'Kill Your Idol', status: 'confirmed',
  start: { dateTime: '2090-12-02T20:00:00-05:00', timeZone: 'America/New_York' },
  location: 'Kill Your Idol, 222 Española Way, Miami Beach, FL 33139, USA',
  description: 'Show type: Original<br>Doors: 7 PM<br>Ticket price: $15<br>Public notes: Full-band set<br>Set length: 40<br>Pay: $400',
};

test('ordinary titles and notes become public fields with venue-local times', async () => {
  const projected = await projectEvent(event, options);
  assert.equal(projected.issue, null);
  assert.equal(projected.operation, 'upsert');
  assert.equal(projected.listing.city, 'Miami Beach');
  assert.equal(projected.listing.type, 'original');
  assert.equal(projected.listing.doors, '19:00');
  assert.equal(projected.listing.time, '20:00');
  assert.equal(projected.listing.ticketPrice, '$15');
  assert.equal(projected.listing.description, 'Full-band set');
  assert.doesNotMatch(JSON.stringify(projected), /\$400|set length/i);
  const unlabeled = await projectEvent({ ...event, description: '' }, options);
  assert.equal(unlabeled.operation, 'upsert');
  assert.equal(unlabeled.listing.type, '');
});

test('notes-only edits change the fingerprint and busking removes a paid ticket link', async () => {
  const original = await projectEvent(event, options);
  const edited = await projectEvent({ ...event,
    description: 'Show type: Busking\nTicket URL: https://example.com/tickets\nShow time: 8:30 PM',
  }, options);
  assert.equal(edited.issue, null);
  assert.notEqual(edited.fingerprint, original.fingerprint);
  assert.equal(edited.listing.ticketUrl, '');
  assert.equal(edited.listing.ticketPrice, 'Free');
  assert.equal(edited.listing.time, '20:30');
  assert.equal(edited.listing.showAt, '2090-12-03T01:30:00.000Z');
});

test('holds, all-day bookings and Calendar deletions withdraw an existing public show', async () => {
  for (const state of [
    { summary: 'Gig: HOLD: Venue' }, { visibility: 'private' }, { status: 'tentative' },
    { description: 'Publish: No' }, { start: { date: '2090-12-02' } }, { status: 'cancelled' },
  ]) {
    const row = await projectEvent({ ...event, ...state }, options);
    assert.equal(row.operation, 'remove');
    assert.equal(row.listing, null);
  }
  const blocked = await projectEvent({ ...event, location: 'Room somewhere' }, options);
  assert.ok(blocked.issue);
  assert.equal(blocked.listing.validationIssue, true);
  assert.equal(recurrenceEnd({ recurrence: ['RRULE:FREQ=WEEKLY;COUNT=8'] }, options.now), null);
  assert.equal(recurrenceEnd({ recurrence: ['RRULE:FREQ=WEEKLY'] }, options.now), '2027-11-25T00:00:00.000Z');
});

test('the direct booking Calendar watch picks up manual creates, notes edits, and deletions', async t => {
  const store = { cursor: null, channels: [], received: 0, processed: 0 };
  let changes = [];
  let version = 1;
  const rows = new Map();
  const calls = [];
  const resolved = Response.json.bind(Response);
  const deps = {
    fetch: async (url, req) => {
      calls.push(url);
      if (url.endsWith('/watch')) {
        return resolved({ ...JSON.parse(req.body), resourceId: 'resource-id' });
      }
      return resolved({ timeZone: 'America/New_York', items: changes, nextSyncToken: 'cursor' + version });
    },
    createState: async ({ artist_id, calendar_id }) => {
      assert.equal(artist_id, 'artist');
      store.calendar_id ??= calendar_id;
    },
    get: async key => {
      if (key.startsWith('calendar_publish_state')) return [structuredClone(store)];
      if (key.startsWith('google_connections')) {
        assert.equal(key, 'google_connections?artist_id=eq.artist&select=refresh_token&limit=1');
        return [{ refresh_token: 'existing-booking-grant' }];
      }
      return [...rows.values()];
    },
    patch: async (key, patch) => Object.assign(store, patch),
    refresh: async refreshToken => {
      assert.equal(refreshToken, 'existing-booking-grant');
      return 'google-token';
    },
    googleAccount: async token => {
      assert.equal(token, 'google-token');
      return { emailAddress: 'booking@nickrainsmusic.com' };
    },
    user: async req => req.headers['test-user'],
    cors: () => ({ 'Content-Type': 'application/json' }),
    notify: async () => {},
    rpc: async (name, body) => {
      assert.equal(body.p_artist, 'artist');
      if (name === 'calendar_publish_receive') { store.received++; return; }
      assert.equal(store.cursor, body.p_expected);
      for (const row of body.p_rows) rows.set(row.event_id, row);
      store.cursor = body.p_cursor;
      store.processed = body.p_received;
      return body.p_rows.length;
    },
  };
  const publisher = createCalendarPublisher(deps, {
    SHOW_SYNC_ARTIST_ID: 'artist', SHOW_SYNC_LIVE: 'true',
    SHOW_SYNC_URL: 'https://worker.example', SHOW_SYNC_RUNNER_TOKEN: 'runner-secret-long-enough-for-testing',
  });
  t.after(() => publisher.close());
  await publisher.start();
  assert.equal(rows.size, 0);
  const eventsUrl = 'https://www.googleapis.com/calendar/v3/calendars/booking%40nickrainsmusic.com/events';
  assert.equal(calls[0], eventsUrl + '/watch');

  async function post(path, headers) {
    const req = Readable.from([]);
    req.method = 'POST';
    req.url = path;
    req.headers = headers;
    const res = { writeHead(code) { this.code = code; }, end() {} };
    await publisher.route(req, res, path.split('?')[0]);
    return res.code;
  }

  function push(token, resourceId = 'resource-id') {
    return post('/calendar-publish/google', {
      'x-goog-channel-id': store.channels[0].id,
      'x-goog-channel-token': token,
      'x-goog-resource-id': resourceId,
    });
  }
  assert.equal(await push('wrong'), 403);
  assert.equal(await push(store.channels[0].token, 'other-artist-calendar'), 403);
  const countBeforeDenied = calls.length;
  assert.equal(await post('/calendar-publish/reconcile', { 'test-user': 'other-artist' }), 403);
  assert.equal(await post('/calendar-publish/retry?event=show1', { 'test-user': 'other-artist' }), 403);
  assert.equal(calls.length, countBeforeDenied);
  assert.equal(store.received, 0);
  version++;
  changes = [event];
  assert.equal(await push(store.channels[0].token), 204);
  await waitFor(() => store.processed === 1);
  assert.equal(rows.get(event.id).listing.ticketPrice, '$15');
  assert.ok(calls.some(url => url.startsWith(eventsUrl + '?') && url.includes('syncToken=cursor1')));
  version++;
  changes = [{ ...event, description: 'Show type: Original\nTicket price: $20' }];
  assert.equal(await push(store.channels[0].token), 204);
  await waitFor(() => store.processed === 2);
  assert.equal(rows.get(event.id).listing.ticketPrice, '$20');
  version++;
  changes = [{ id: event.id, status: 'cancelled' }];
  assert.equal(await push(store.channels[0].token), 204);
  await waitFor(() => store.processed === 3);
  assert.equal(rows.get(event.id).operation, 'remove');
  assert.ok(calls.every(url => url === eventsUrl + '/watch' || url.startsWith(eventsUrl + '?')));
});

test('an artist connection for a different Google account never starts a Calendar watch', async t => {
  const messages = [];
  const calendarId = 'booking@nickrainsmusic.com';
  const publisher = createCalendarPublisher({
    createState: async () => {},
    get: async key => key.startsWith('calendar_publish_state')
      ? [{ calendar_id: calendarId, channels: [] }] : [{ refresh_token: 'different-account' }],
    refresh: async () => 'google-token',
    googleAccount: async () => ({ emailAddress: 'other-artist@example.com' }),
    fetch: async url => { messages.push(url); },
  }, { SHOW_SYNC_ARTIST_ID: 'artist', SHOW_SYNC_URL: 'https://worker.example' });
  t.after(() => publisher.close());
  const log = t.mock.method(console, 'error', () => {});
  await publisher.start();
  assert.equal(messages.length, 0);
  assert.match(log.mock.calls[0].arguments.join(' '), /connected Google account must be booking/);
});

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('The durable notification was not processed');
}
