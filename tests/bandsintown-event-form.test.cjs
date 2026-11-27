const { test } = require('node:test');
const assert = require('node:assert/strict');
const { prepareEventForm, venueMatchesListing } = require('../worker/bandsintown-event-form');

const listing = {
  venue: 'The Reserve Key West', address: '510 Southard St', city: 'Key West',
  region: 'FL', country: 'US', postcode: '33040', date: '2026-11-27',
};

test('an autocomplete result must match the venue and its location independently', () => {
  assert.equal(venueMatchesListing('The Reserve Key West', 'Key West, FL', listing), true);
  assert.equal(venueMatchesListing('The Reserve', '510 Southard Street, Key West, FL', listing), true);
  assert.equal(venueMatchesListing('The Reserve', 'Key West, FL', listing), false);
  assert.equal(venueMatchesListing('The Reserve Key West', '510 Southard Street, Miami, FL', listing), false);
  assert.equal(venueMatchesListing('The Reserve Key West', '500 Southard Street, Key West, FL', listing), false);
  assert.equal(venueMatchesListing('The Reserve Key West', 'Key West, IA', listing), false);
  assert.equal(venueMatchesListing('The Reserve Annex', '510 Southard Street, Key West, FL', listing), false);
});

test('a typed search is distinct from a committed venue with matching details', async () => {
  let committed = false;
  const clear = { isVisible: async () => committed };
  const field = {
    count: async () => 1, isVisible: async () => true, isEnabled: async () => false,
    inputValue: async () => 'The Reserve Key West - Key West, FL',
    locator: () => ({ count: async () => 1, locator: () => clear }),
  };
  const page = {
    url: () => 'https://artists.bandsintown.com/artists/3251702/events/new',
    locator: selector => selector.startsWith('input#venueField') ? field : { locator: () => ({ count: async () => 0 }) },
  };
  const check = async () => assert.fail('No action should be requested');
  assert.equal((await prepareEventForm(page, listing, check)).venueMatches, false);
  committed = true;
  assert.equal((await prepareEventForm(page, listing, check)).venueMatches, true);
});

test('read back the accepted event date and restrict changes to the current new-event job', async () => {
  let url = 'https://artists.bandsintown.com/artists/3251702/events/new';
  let value = '2026-11-24';
  const field = {
    count: async () => 1, isVisible: async () => true, isEnabled: async () => true,
    getAttribute: async () => 'date', inputValue: async () => value, fill: async v => { value = v; },
    blur: async () => {},
  };
  const page = {
    url: () => url,
    locator: selector => selector === '.high-fields__start_date' ? { locator: () => field } : { count: async () => 0 },
  };
  await assert.rejects(() => prepareEventForm(page, listing, async () => false), /no longer current/);
  assert.equal(value, '2026-11-24');
  assert.equal((await prepareEventForm(page, listing, async () => true)).dateMatches, true);
  assert.equal(value, listing.date);
  url = 'https://artists.bandsintown.com/artists/3251702/events/123';
  assert.equal((await prepareEventForm(page, listing, async () => assert.fail())).dateMatches, false);
});
