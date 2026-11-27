const { test } = require('node:test');
const assert = require('node:assert/strict');
const { projectEvent } = require('../worker/calendar-publish-data');
const { addressFromLocation, resolveShowVenue } = require('../worker/calendar-venue');

const event = {
  id: 'venue1', summary: 'Original: Kill Your Idol', colorId: '2', status: 'confirmed',
  start: { dateTime: '2026-12-02T22:00:00-05:00', timeZone: 'America/New_York' },
};
const options = { now: Date.parse('2026-11-27'), timeZone: 'America/New_York' };
const component = (type, longText, shortText = longText) => ({ types: [type], longText, shortText });
const place = {
  displayName: { text: 'Kill Your Idol' }, types: ['bar', 'point_of_interest'], timeZone: { id: 'America/New_York' },
  addressComponents: [component('street_number', '222'), component('route', 'Española Way', 'Española Wy'),
    component('locality', 'Miami Beach'), component('administrative_area_level_1', 'Florida', 'FL'),
    component('country', 'United States', 'US'), component('postal_code', '33139')],
};
function googleResults(places, queries = []) {
  return (venue, title) => resolveShowVenue(venue, title, 'fixture', async (_url, init) => {
    queries.push(JSON.parse(init.body).textQuery);
    return Response.json({ places });
  });
}

test('street-only Calendar location resolves to the named establishment matching title, street, and city', async () => {
  const queries = [];
  const location = '222 Espanola Way, Miami Beach, FL 33139, USA';
  const geocode = { ...place, displayName: { text: '222 Espanola Way' }, types: ['street_address', 'geocode'] };
  const other = { ...place, displayName: { text: 'Different Club' } };
  const row = await projectEvent({ ...event, location }, { ...options, resolveVenue: googleResults([geocode, other, place], queries) });
  assert.match(queries[0], /^Kill Your Idol, 222 Espanola Way, Miami Beach/);
  assert.equal(row.issue, null);
  assert.equal(row.listing.venue, 'Kill Your Idol');
  assert.equal(row.listing.address, '222 Espanola Way');
  for (const results of [[geocode, other], [place, { ...place }]]) {
    const unresolved = await projectEvent({ ...event, location }, { ...options, resolveVenue: googleResults(results) });
    assert.match(unresolved.issue, /venue name/);
  }
  const geocodeTitle = await projectEvent({ ...event, summary: '222 Espanola Way', location },
    { ...options, resolveVenue: googleResults([geocode]) });
  assert.match(geocodeTitle.issue, /venue name/);
});

test('venue and locality lookups fill only the street; conflicting branches and geocodes are ignored', async () => {
  const location = 'Kill Your Idol, Miami Beach, FL 33139, USA';
  const wrongCity = { ...place, addressComponents: place.addressComponents.map(c => c.types.includes('locality')
    ? component('locality', 'Key West') : c) };
  const row = await projectEvent({ ...event, location }, { ...options, resolveVenue: googleResults([wrongCity, place]) });
  assert.equal(row.issue, null);
  assert.equal(row.listing.address, '222 Española Wy');
  assert.equal(row.listing.city, 'Miami Beach');
  const short = await projectEvent({ ...event, location: 'Kill Your Idol, Miami Beach' }, { ...options, resolveVenue: googleResults([wrongCity, place]) });
  assert.equal(short.issue, null);
  assert.equal(short.listing.city, 'Miami Beach');
  assert.equal(short.listing.address, '222 Española Wy');
  assert.equal((await projectEvent({ ...event, location }, { ...options, resolveVenue: googleResults([wrongCity]) })).listing.address, '');
  const conflicting = addressFromLocation('Kill Your Idol, 333 Ocean Dr, Miami Beach, FL 33139, USA', {});
  assert.equal(await googleResults([place])(conflicting, event.summary), null);
});

test('complete Calendar locations work without Places, and numeric venue names survive parsing', async () => {
  const location = '54 Below\n254 W 54th St\nNew York, NY 10019, USA';
  const row = await projectEvent({ ...event, location, summary: 'Cover: Rock night' }, options);
  assert.equal(row.issue, null);
  assert.equal(row.listing.venue, '54 Below');
  assert.equal(row.listing.address, '254 W 54th St');
  const explicit = await projectEvent({ ...event, location: '222 Española Wy, Miami Beach, FL 33139, USA', description: 'Venue: Kill Your Idol' }, options);
  assert.equal(explicit.issue, null);
  assert.equal(explicit.listing.venue, 'Kill Your Idol');
  assert.equal(await resolveShowVenue(explicit.listing, 'title', ''), null);
});
