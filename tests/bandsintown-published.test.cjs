const test = require('node:test');
const assert = require('node:assert/strict');
const { lookupPublishedEvent, matchPublishedEvents } = require('../worker/bandsintown-published');

const listing = {
  title: 'The Reserve', venue: 'The Reserve Key West', address: '510 Southard St', city: 'Key West',
  region: 'FL', country: 'US', timeZone: 'America/New_York', date: '2026-11-27', time: '19:00',
};
const event = {
  id: '101', artist_id: '3251702', artist: { id: '3251702' }, datetime: '2026-11-27T19:00:00',
  venue: { name: 'The Reserve, Key West', street_address: '510 Southard Street', city: 'Key West', region: 'FL', country: 'United States' },
};
const found = { status: 'matched', id: '101' };

test('matches one public event by artist, precise venue-local start, name, city and street', () => {
  assert.deepEqual(matchPublishedEvents([event], listing), found);
  assert.deepEqual(matchPublishedEvents([event, { ...event }], listing), found);
  assert.deepEqual(matchPublishedEvents([{ ...event, starts_at: '2026-11-28T00:00:00Z' }], listing), found);
  assert.deepEqual(matchPublishedEvents([{ ...event, starts_at: '2026-11-28T00:00:00Z' }], { ...listing, time: '17:00' }), { status: 'missing' });
  assert.deepEqual(matchPublishedEvents([{ ...event, title: listing.title, venue: { ...event.venue, name: listing.title } }], listing), found);
  assert.equal(matchPublishedEvents([{ ...event, venue: { ...event.venue, street_address: '1510 Southard St' } }], listing).status, 'conflict');
  assert.equal(matchPublishedEvents([{ ...event, venue: { ...event.venue, street_address: '' } }], listing).status, 'conflict');
  assert.equal(matchPublishedEvents([{ ...event, venue: { ...event.venue, city: '' } }], listing).status, 'conflict');
});

test('distinct IDs, an unavailable artist feed and cancelled listings cannot confirm publication', () => {
  assert.equal(matchPublishedEvents([event, { ...event, id: '102' }], listing).status, 'conflict');
  assert.equal(matchPublishedEvents([event], listing, '102').status, 'conflict');
  assert.equal(matchPublishedEvents([{ ...event, artist_id: '99' }], listing).status, 'unavailable');
  assert.equal(matchPublishedEvents([{ artist_id: event.artist_id }], listing).status, 'unavailable');
  assert.equal(matchPublishedEvents([{ ...event, status: 'CANCELLED' }], listing).status, 'conflict');
  assert.equal(matchPublishedEvents([{ ...event, datetime: 'TBA' }], listing).status, 'unavailable');
  assert.deepEqual(matchPublishedEvents([], listing), { status: 'missing' });
});

test('preserves existing IDs when changes require dashboard verification', () => {
  const data = { ...listing, description: 'Acoustic show', ticketUrl: 'https://venue.example/tickets', ticketPrice: 'Free', doors: '18:30' };
  const change = matchPublishedEvents([event], data);
  assert.equal(change.status, 'needs-update');
  assert.equal(change.id, '101');
  assert.deepEqual(matchPublishedEvents([{ ...event, description: data.description, offers: [{ url: data.ticketUrl }], free: true,
    doors_at: '2026-11-27T18:30:00' }], data), found);
  assert.equal(matchPublishedEvents([event], { ...listing, ticketPrice: '$15' }).status, 'needs-update');
  assert.equal(matchPublishedEvents([event], { ...listing, time: '20:00' }, '101').status, 'needs-update');
  assert.equal(matchPublishedEvents([event], { ...listing, venue: 'Another venue' }, '101').status, 'needs-update');
});

test('events with no Calendar street can be created when the artist feed has no matching city and start', () => {
  const noStreet = { ...listing, address: '' };
  assert.deepEqual(matchPublishedEvents([], noStreet), { status: 'missing' });
  assert.deepEqual(matchPublishedEvents([event], { ...noStreet, time: '18:00' }), { status: 'missing' });
  assert.deepEqual(matchPublishedEvents([event], { ...noStreet, city: 'Miami' }), { status: 'missing' });
  assert.equal(matchPublishedEvents([event], noStreet).status, 'conflict');
});

test('a blank public event title verifies a venue display name only when it represents the requested title', () => {
  const reach = { ...listing, title: 'The Reach', venue: 'The Reach Key West', address: 'Curio Collection by Hilton, 1435 Simonton St' };
  const reachEvent = { ...event, title: '', venue: { ...event.venue, name: 'The Reach, Key West', street_address: '1435 Simonton Street' } };
  assert.deepEqual(matchPublishedEvents([reachEvent], reach), found);
  assert.deepEqual(matchPublishedEvents([reachEvent], { ...reach, title: '' }), found);
  const mustEdit = matchPublishedEvents([reachEvent], { ...reach, title: 'Acoustic Sunset at The Reach' });
  assert.equal(mustEdit.status, 'needs-update');
  assert.equal(mustEdit.id, event.id);
  const otherVenue = { ...reachEvent, venue: { ...reachEvent.venue, name: 'Hotel Bar', street_address: '1435 Simonton Street' } };
  assert.equal(matchPublishedEvents([otherVenue], reach).status, 'conflict');
});

test('reads only the artist’s date-range endpoint and distinguishes dependency failure from an empty list', async () => {
  const result = await lookupPublishedEvent(listing, { fetch: async (url, options) => {
    assert.equal(url.origin, 'https://rest.bandsintown.com');
    assert.match(url.pathname, /\/artists\/id_3251702\/events\/$/);
    assert.equal(url.searchParams.get('date'), '2026-11-27,2026-11-27');
    assert.equal(url.searchParams.get('app_id'), 'js_nickrainsmusic.com');
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json([event]);
  } });
  assert.deepEqual(result, found);
  for (const response of [Response.json({ error: 'Unauthorized' }), new Response(null, { status: 429 }), new Response('<html>')]) {
    assert.equal((await lookupPublishedEvent(listing, { fetch: async () => response })).status, 'unavailable');
  }
  assert.equal((await lookupPublishedEvent(listing, { fetch: async () => { throw new Error('Offline'); } })).status, 'unavailable');
});
