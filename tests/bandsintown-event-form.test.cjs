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
    locator: selector => selector.startsWith('input#venueField') ? field : { count: async () => 0 },
    getByRole: () => ({ count: async () => 0 }),
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
    getAttribute: async name => name === 'type' ? 'date' : null, inputValue: async () => value, fill: async v => { value = v; },
    blur: async () => {},
  };
  const page = {
    url: () => url,
    locator: selector => selector.startsWith('input#eventStartDateField') ? field : { count: async () => 0 },
  };
  await assert.rejects(() => prepareEventForm(page, listing, async () => false), /no longer current/);
  assert.equal(value, '2026-11-24');
  assert.equal((await prepareEventForm(page, listing, async () => true)).dateMatches, true);
  assert.equal(value, listing.date);
  url = 'https://artists.bandsintown.com/artists/3251702/events/123';
  assert.equal((await prepareEventForm(page, listing, async () => assert.fail())).dateMatches, false);
});

test('Start Date* is found outside the wrapper and verified after the form processes blur', async () => {
  let value = '';
  let acceptsDate = true;
  let filled = '';
  const empty = { count: async () => 0 };
  const field = {
    count: async () => 1, isVisible: async () => true, isEnabled: async () => true, isEditable: async () => true,
    getAttribute: async name => ({ type: 'text', placeholder: 'MM/DD/YYYY' })[name] || null,
    inputValue: async () => value, fill: async v => { filled = value = v; },
    blur: async () => { value = acceptsDate ? 'Nov 27, 2026' : ''; },
    locator: () => ({ locator: () => empty }),
  };
  const page = {
    url: () => 'https://artists.bandsintown.com/artists/3251702/events/new',
    locator: () => empty,
    getByRole: (role, { name }) => { assert.equal(role, 'textbox'); assert.match('Start Date*', name); return field; },
  };
  const read = () => prepareEventForm(page, listing, async () => true);
  assert.deepEqual(await read(), { date: 'Nov 27, 2026', dateMatches: true, venueMatches: false });
  assert.equal(filled, '11/27/2026');
  acceptsDate = false;
  value = '';
  assert.equal((await read()).dateMatches, false);
});
