const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { test } = require('node:test');
const { createCalendarPublisher } = require('../worker/calendar-publish');
const { UNCERTAIN_SAVE_ISSUE } = require('../worker/bandsintown-published');

const token = 'test-only-runner-token-with-over-32-bytes';
const revision = '00000000-0000-4000-8000-000000000001';
const listing = { title: 'La Te Da', venue: 'La Te Da', address: '1125 Duval St', city: 'Key West', region: 'FL',
  country: 'US', timeZone: 'America/New_York', date: '2026-12-05', time: '20:00' };

function row(id, fields = {}) {
  return { artist_id: 'artist', event_id: id, revision, listing: { ...listing }, operation: 'upsert', status: 'review',
    updated_at: new Date().toISOString(), bandsintown_id: null, issue: UNCERTAIN_SAVE_ISSUE, ...fields };
}
function publicEvent(id, schedule = listing) {
  return { id, artist_id: '3251702', title: schedule.title, datetime: schedule.date + 'T' + schedule.time + ':00',
    venue: { name: schedule.venue, street_address: schedule.address, city: schedule.city, region: schedule.region, country: 'United States',
      latitude: '24.5494458', longitude: '-81.7977856' } };
}

function harness(t, rows, settings = {}) {
  let now = Date.now();
  const pending = new Set();
  t.mock.method(Date, 'now', () => now);
  t.mock.method(global, 'setTimeout', (callback, delay) => {
    const timer = { callback, due: now + delay, unref() {} };
    pending.add(timer);
    return timer;
  });
  t.mock.method(global, 'clearTimeout', timer => { pending.delete(timer); });
  for (const row of rows) row.updated_at = new Date().toISOString();
  const calls = { feed: 0, google: 0, queries: [], updates: [], events: [] };
  const state = { calendar_id: 'calendar', channels: [{ expiration: Date.now() + 7 * 86400000, resourceId: 'active' }],
    cursor: 'known', processed: 0, received: 0 };
  function selected(path) {
    const query = new URLSearchParams(path.split('?')[1]);
    return rows.filter(row => [...query].every(([k, value]) =>
      value === 'is.null' ? row[k] == null : !value.startsWith('eq.') || row[k] === value.slice(3)));
  }
  const publisher = createCalendarPublisher({
    createState: async () => {}, refresh: async () => 'access', rpc: async () => 0, cors: () => ({}), notify: async () => {},
    get: async key => {
      calls.queries.push(key);
      return key.startsWith('calendar_publish_state') ? [state] : structuredClone(selected(key));
    },
    patch: async (key, change) => {
      calls.updates.push(key);
      const matches = selected(key);
      matches.forEach(row => Object.assign(row, change));
      return matches;
    },
    fetch: async (url, options) => {
      const host = new URL(url).hostname;
      if (host === 'www.googleapis.com') {
        calls.google++;
        return Response.json({ items: [], nextSyncToken: 'current' });
      }
      assert.equal(host, 'rest.bandsintown.com');
      assert.equal(options.cache, 'no-store');
      calls.feed++;
      if (calls.onFeed) await calls.onFeed(options.signal);
      return Response.json(calls.events);
    },
  }, { SHOW_SYNC_ARTIST_ID: 'artist', SHOW_SYNC_CALENDAR_ID: 'calendar', SHOW_SYNC_LIVE: 'true',
    SHOW_SYNC_URL: 'https://worker.example', SHOW_SYNC_RUNNER_TOKEN: token, SHOW_SYNC_GOOGLE_REFRESH_TOKEN: 'grant', ...settings });
  t.after(() => publisher.close());
  async function tick(ms) {
    now += ms;
    for (const timer of [...pending]) {
      if (timer.due > now) continue;
      pending.delete(timer);
      timer.callback();
    }
    await new Promise(resolve => setImmediate(resolve));
  }
  async function sendResult(id) {
    const req = Readable.from([JSON.stringify({ event_id: id, revision, status: 'review', issue: UNCERTAIN_SAVE_ISSUE })]);
    req.method = 'POST';
    req.headers = { authorization: 'Bearer ' + token };
    const res = { writeHead(status) { this.status = status; }, end() {} };
    await publisher.route(req, res, '/calendar-publish/runner/result');
    assert.equal(res.status, 204);
  }
  return { publisher, calls, tick, sendResult };
}

test('worker startup reconciles a batch with one feed read and a revision-guarded patch per matching create', async t => {
  const first = row('first'), second = row('second', { listing: { ...listing, date: '2026-12-06' } });
  const changed = row('changed', { listing: { ...listing, date: '2026-12-07' } });
  const conflict = row('conflict', { listing: { ...listing, date: '2026-12-08' } });
  const other = row('other', { artist_id: 'someone-else' }), edit = row('edit', { bandsintown_id: '999' }),
    detail = row('detail', { issue: 'Specify the venue.' }), removed = row('remove', { operation: 'remove' });
  const { publisher, calls, tick } = harness(t, [first, second, changed, conflict, other, edit, detail, removed]);
  calls.events = [publicEvent('101'), publicEvent('102', second.listing), publicEvent('103', changed.listing),
    publicEvent('104', conflict.listing), publicEvent('105', conflict.listing)];
  calls.onFeed = () => { changed.revision = '00000000-0000-4000-8000-000000000002'; };
  await publisher.start();
  await tick(0);
  assert.equal(calls.feed, 1);
  assert.deepEqual([first.status, first.bandsintown_id, first.issue], ['published', '101', null]);
  assert.deepEqual([second.status, second.bandsintown_id], ['published', '102']);
  for (const row of [changed, conflict, other, edit, detail, removed]) assert.equal(row.status, 'review');
  assert.equal(calls.google, 1);
});

test('empty queue makes no public request, then delayed publication is picked up without another submit', async t => {
  const show = row('one', { status: 'working', issue: null });
  const { publisher, calls, tick, sendResult } = harness(t, [show]);
  await publisher.start();
  await tick(0);
  assert.equal(calls.feed, 0);
  await sendResult('one');
  await tick(30000);
  assert.equal(calls.feed, 1);
  assert.equal(show.status, 'review');
  calls.events = [publicEvent('101')];
  await tick(60000);
  assert.equal(show.status, 'published');
  assert.equal(calls.feed, 2);
  await tick(60000);
  assert.equal(calls.feed, 2);
  assert.equal(calls.google, 1);
});

test('pilot restricts both reads and writes to the selected Calendar event', async t => {
  const pilot = row('pilot'), outside = row('outside');
  const { publisher, calls, tick } = harness(t, [pilot, outside], { SHOW_SYNC_PILOT_EVENT_ID: 'pilot' });
  calls.events = [publicEvent('101')];
  await publisher.start();
  await tick(0);
  assert.equal(pilot.status, 'published');
  assert.equal(outside.status, 'review');
  const ambiguousPaths = calls.queries.concat(calls.updates).filter(path => path.includes('status=eq.review'));
  assert.ok(ambiguousPaths.length >= 2 && ambiguousPaths.every(path => path.includes('event_id=eq.pilot')));
  publisher.close();
  await tick(120000);
  assert.equal(calls.feed, 1);
});


test('closing during an in-flight public check aborts the lookup and prevents late writes or timers', async t => {
  const show = row('one');
  const { publisher, calls, tick } = harness(t, [show]);
  let release, signal;
  calls.onFeed = active => {
    signal = active;
    return new Promise(resolve => { release = resolve; });
  };
  calls.events = [publicEvent('101')];
  await publisher.start();
  await tick(0);
  assert.ok(signal && !signal.aborted);
  publisher.close();
  assert.ok(signal.aborted);
  release();
  await tick(15 * 60000);
  assert.equal(show.status, 'review');
  assert.equal(calls.feed, 1);
});
