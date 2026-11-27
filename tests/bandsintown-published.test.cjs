const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchPublishedEvents, lookupPublishedEvent, matchPublishedEvents, eventDescription } = require('../worker/bandsintown-published');

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

  const geiger = { ...listing, title: 'Geiger Key', venue: 'Geiger Key Marina', address: 'RV Park & Fish Camp by Parakeet Communities, 5 Geiger Rd',
    date: '2026-12-01', time: '17:00' };
  const geigerEvent = { ...event, id: '109210772', title: '', starts_at: '2026-12-01T17:00:00',
    venue: { ...event.venue, name: 'Geiger Key Marina', street_address: '5 Geiger Rd' } };
  assert.deepEqual(matchPublishedEvents([geigerEvent], geiger), { status: 'matched', id: '109210772' });
  assert.equal(matchPublishedEvents([{ ...geigerEvent, title: 'Jazz Festival' }], geiger).status, 'needs-update');
  assert.equal(matchPublishedEvents([geigerEvent], { ...geiger, title: 'Geiger Key Sunset' }).status, 'needs-update');
  assert.equal(matchPublishedEvents([geigerEvent], { ...geiger, address: '8 Geiger Rd' }).status, 'conflict');
});

test('public notes preserve the advertised doors and admission on a form without dedicated fields', () => {
  const concert = { ...listing, description: 'Acoustic show', doors: '20:00', ticketPrice: '$15' };
  const description = 'Acoustic show\n\nDoors at 8:00 PM.\nAdmission: $15.';
  assert.equal(eventDescription(concert), description);
  assert.deepEqual(matchPublishedEvents([{ ...event, description }], concert), found);
  assert.equal(matchPublishedEvents([{ ...event, description, free: true }], concert).status, 'needs-update');
  assert.deepEqual(matchPublishedEvents([{ ...event, description: concert.description, doors_at: '2026-11-27T20:00:00', ticket_price: '$15' }], concert), found);
  assert.equal(matchPublishedEvents([{ ...event, description: 'Admission: $15.' }], concert).status, 'needs-update');
  assert.equal(eventDescription({ doors: '00:15', ticketPrice: 'FREE' }), 'Doors at 12:15 AM.');
  assert.equal(eventDescription({ doors: '12:00' }), 'Doors at 12:00 PM.');
  assert.equal(eventDescription({ ticketPrice: 'Pay what you can.' }), 'Admission: Pay what you can.');
});

test('The Reach full public venue name matches the building component explicitly present in Calendar', () => {
  const calendar = { ...listing, title: 'The Reach', venue: 'The Reach Key West', address: 'Curio Collection by Hilton, 1435 Simonton St',
    date: '2027-01-09', time: '11:00' };
  const actual = { ...event, id: '109210811', title: '', datetime: '2027-01-09T11:00:00',
    venue: { ...event.venue, name: 'The Reach Key West, Curio Collection by Hilton', street_address: '1435 Simonton Street' } };
  assert.deepEqual(matchPublishedEvents([actual], calendar), { status: 'matched', id: '109210811' });
  assert.equal(matchPublishedEvents([actual], { ...calendar, address: 'Other Collection by Hilton, 1435 Simonton St' }).status, 'conflict');
  assert.equal(matchPublishedEvents([actual], { ...calendar, address: 'Curio Collection by Hilton, 1500 Simonton St' }).status, 'conflict');
  assert.equal(matchPublishedEvents([actual], { ...calendar, address: '1435 Simonton St' }).status, 'conflict');
  assert.equal(matchPublishedEvents([actual], { ...calendar, title: 'Holiday Brunch' }).status, 'needs-update');
  assert.equal(matchPublishedEvents([actual], { ...calendar, city: 'Miami' }).status, 'conflict');
});

test('one artist feed observation supports multiple calendar rows and rejects mixed-artist responses', async () => {
  let requests = 0;
  const shows = await fetchPublishedEvents({ dates: ['2026-12-01', listing.date, '2026-11-29'], fetch: async url => {
    requests++;
    assert.equal(url.searchParams.get('date'), '2026-11-26,2026-12-02');
    return Response.json([event]);
  } });
  assert.deepEqual(matchPublishedEvents(shows, listing), found);
  assert.deepEqual(matchPublishedEvents(shows, { ...listing, date: '2027-12-22' }), { status: 'missing' });
  assert.equal(requests, 1);
  assert.deepEqual(await fetchPublishedEvents({ fetch: async () => Response.json([]) }), []);
  assert.equal(await fetchPublishedEvents({ fetch: async () => Response.json([event, { ...event, artist_id: '67' }]) }), null);
  assert.equal(matchPublishedEvents([{ ...event, datetime: '2026-11-28T00:00:00Z' }], { ...listing, timeZone: 'Unknown/Zone' }).status, 'unavailable');
});

test('reads the complete artist feed with a fresh cache key on each observation', async () => {
  const future = { ...listing, date: '2099-12-01' };
  const upcomingEvent = { ...event, datetime: future.date + 'T19:00:00' };
  const keys = new Set();
  const read = () => lookupPublishedEvent(future, { fetch: async (url, options) => {
    assert.equal(url.origin, 'https://rest.bandsintown.com');
    assert.match(url.pathname, /\/artists\/id_3251702\/events\/$/);
    assert.equal(url.searchParams.get('date'), 'upcoming');
    assert.equal(url.searchParams.get('app_id'), 'js_nickrainsmusic.com');
    assert.ok(url.searchParams.get('_sync'));
    keys.add(url.searchParams.get('_sync'));
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json([event, upcomingEvent]);
  } });
  assert.deepEqual(await read(), found);
  assert.deepEqual(await read(), found);
  assert.equal(keys.size, 2);
  const seen = [];
  assert.deepEqual(await lookupPublishedEvent({ ...listing, date: '2001-12-01' }, { fetch: async url => {
    seen.push(url.searchParams.get('date'));
    return Response.json([]);
  } }), { status: 'missing' });
  assert.deepEqual(seen, ['all', '2001-11-30,2001-12-02']);
});

test('a stale upcoming aggregate cannot authorize a duplicate, or a partial range authorize creation', async () => {
  const upcoming = { ...listing, date: '2099-01-01' };
  const actual = { ...event, starts_at: '2099-01-01T19:00:00' };
  const lookup = (events, init) => lookupPublishedEvent(upcoming, { fetch: async url => {
    if (url.searchParams.get('date') === 'upcoming') return Response.json([]);
    assert.equal(url.searchParams.get('date'), '2098-12-31,2099-01-02');
    return Response.json(events, init);
  } });
  assert.deepEqual(await lookup([actual]), found);
  assert.deepEqual(await lookup([]), { status: 'missing' });
  for (const init of [{ status: 206 }, { headers: { 'x-total-count': '25' } }, { headers: { 'content-range': 'items 0-10/25' } },
    { headers: { link: '<https://rest.bandsintown.com/next>; rel="next"' } }]) {
    assert.equal((await lookup([], init)).status, 'unavailable');
  }
  const crowded = Array.from({ length: 24 }, (_, index) => ({ ...actual, id: String(index + 1), starts_at: '2098-12-31T17:00:00' }));
  assert.equal((await lookup(crowded)).status, 'missing');
  assert.deepEqual(await lookup([...crowded, actual]), found);
  const unavailableAggregate = events => lookupPublishedEvent(upcoming, { fetch: async url =>
    url.searchParams.get('date') === 'upcoming' ? new Response(null, { status: 503 }) : Response.json(events) });
  assert.deepEqual(await unavailableAggregate([actual]), found);
  assert.equal((await unavailableAggregate([])).status, 'unavailable');
});

test('an unavailable feed is distinct from an empty list', async () => {
  for (const response of [Response.json({ error: 'Unauthorized' }), new Response(null, { status: 429 }), new Response('<html>')]) {
    assert.equal((await lookupPublishedEvent(listing, { fetch: async () => response })).status, 'unavailable');
  }
  assert.equal((await lookupPublishedEvent(listing, { fetch: async () => { throw new Error('Offline'); } })).status, 'unavailable');
});
