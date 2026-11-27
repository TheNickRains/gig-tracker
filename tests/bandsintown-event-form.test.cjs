const { test } = require('node:test');
const assert = require('node:assert/strict');
const { prepareEventForm, submitLocationDialog, venueMatchesListing } = require('../worker/bandsintown-event-form');

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

test('prefixed Calendar addresses match the numbered street while preserving venue identity', () => {
  const geiger = { ...listing, venue: 'Geiger Key Marina', address: 'RV Park & Fish Camp by Parakeet Communities, 5 Geiger Rd' };
  assert.equal(venueMatchesListing('Geiger Key Marina', '5 Geiger Road, Key West, FL', geiger), true);
  assert.equal(venueMatchesListing('Geiger Key Marina', '15 Geiger Road, Key West, FL', geiger), false);
  assert.equal(venueMatchesListing('Geiger Key Marina', '5 Geiger Road Extension, Key West, FL', geiger), false);
  assert.equal(venueMatchesListing('Geiger Key', '5 Geiger Rd, Key West, FL', geiger), false);

  const reach = { ...listing, venue: 'The Reach Key West', address: 'Curio Collection by Hilton, 1435 Simonton St' };
  assert.equal(venueMatchesListing('The Reach', 'The Reach Key West, 1435 Simonton Street, Key West, FL', reach), true);
  assert.equal(venueMatchesListing('The Reach', 'Key West, FL', reach), false);
  assert.equal(venueMatchesListing('The Reach', '1435 Southard Street, Key West, FL', reach), false);
  assert.equal(venueMatchesListing('The Reach Annex', '1435 Simonton Street, Key West, FL', reach), false);
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

test('the post-Save location warning submits once with the verified city, region, country and venue', async () => {
  const empty = { count: async () => 0 };
  const visible = { count: async () => 1, isVisible: async () => true, isEnabled: async () => true };
  const input = () => {
    let value = '';
    return { ...visible, isEditable: async () => true, inputValue: async () => value,
      fill: async text => { value = text; }, blur: async () => {} };
  };
  const select = (code, label) => {
    let value = '';
    return { ...visible, waitFor: async () => {}, evaluate: async () => true, inputValue: async () => value,
      locator: () => ({ evaluateAll: async () => [{ value: code, label }] }), selectOption: async selected => { value = selected; } };
  };
  const country = select('United States', '🇺🇸 United States'), region = select('FL', 'Florida'), name = input(), city = input();
  let clicks = 0;
  const form = { ...visible, locator: selector => ({
    '#venueFormCountryField': country, '#venueFormRegionField': region,
    'input[name="venue_name"]': name, 'input[name="city"]': city,
  })[selector] || empty, getByRole: () => ({ ...visible, click: async () => { clicks++; } }) };
  const page = { url: () => 'https://artists.bandsintown.com/artists/3251702/events/new',
    locator: selector => { assert.match(selector, /#venueFormNameField/); return {
      ...visible, getAttribute: async () => 'venue_name', locator: () => form }; } };
  const proof = { dateMatches: true, timeMatches: true, venueMatches: true, notificationsOff: true };
  assert.equal(await submitLocationDialog(page, listing, async () => true, { ...proof, dateMatches: false }), false);
  await assert.rejects(() => submitLocationDialog(page, listing, async () => false, proof), /no longer current/);
  assert.equal(clicks, 0);
  assert.equal(await submitLocationDialog(page, listing, async () => true, proof), true);
  assert.equal(clicks, 1);
  assert.equal(await city.inputValue(), listing.city);
  assert.equal(await name.inputValue(), listing.venue);
  assert.equal(await region.inputValue(), 'FL');
  assert.equal(await country.inputValue(), 'United States');
});

test('a read-only date field traverses the December–January boundary and commits the exact day', async () => {
  const empty = { count: async () => 0 };
  let value = '';
  let currentMonth = 0;
  let checked = 0;
  const months = ['Dec 2026', 'Jan 2027', 'Feb 2027'];
  const heading = {
    waitFor: async () => {}, innerText: async () => months[currentMonth],
    locator: selector => { assert.match(selector, /following-sibling/); return { click: async () => { currentMonth++; } }; },
    filter: ({ hasText }) => ({ waitFor: async () => assert.equal(hasText, months[currentMonth]) }),
  };
  const picker = {
    isVisible: async () => true, count: async () => 1,
    locator: selector => { assert.equal(selector, 'button.month'); return heading; },
    getByRole: (role, { name, exact }) => {
      assert.deepEqual([role, name, exact], ['button', '9', true]);
      return { count: async () => 1, isEnabled: async () => true,
        click: async () => { assert.equal(currentMonth, 2); value = '2027-02-09'; } };
    },
  };
  const field = { count: async () => 1, isVisible: async () => true, isEnabled: async () => true,
    getAttribute: async () => null, isEditable: async () => false, inputValue: async () => value,
    locator: () => ({ locator: () => picker }) };
  const page = { url: () => 'https://artists.bandsintown.com/artists/3251702/events/new',
    locator: selector => selector.startsWith('input#eventStartDateField') ? field : empty };
  const actual = await prepareEventForm(page, { ...listing, date: '2027-02-09' }, async () => { checked++; return true; });
  assert.equal(actual.dateMatches, true);
  assert.ok(checked >= 3);
});

test('venue search refines by city and selects the exact live suggestion on mousedown', async () => {
  const empty = { count: async () => 0 };
  let value = '', committed = false, searchOpen = false;
  const searches = [], stages = [];
  const target = { ...listing, venue: 'La Te Da', address: '1125 Duval St' };
  const label = 'La Te Da, Duval Street, Key West, FL, USA';
  const matches = () => value.includes('Key West') ? [label] : ['La Te Da, Washington, DC'];
  const row = { isVisible: async () => true, isEnabled: async () => true, innerText: async () => matches()[0],
    dispatchEvent: async type => { assert.equal(type, 'mousedown'); value = label; committed = true; searchOpen = false; } };
  const rows = { evaluateAll: async () => matches().map(label => ({ label, name: '', address: '' })),
    nth: index => { assert.equal(index, 0); return row; } };
  const custom = { isVisible: async () => searchOpen, waitFor: async ({ state }) => assert.equal(searchOpen, state === 'visible') };
  const clear = { isVisible: async () => committed, waitFor: async () => assert.ok(committed) };
  const group = { count: async () => 1, locator: selector => ({ 'aside button': custom, 'ul > li > button': rows,
    'button[aria-label="Clear value"]': clear })[selector] };
  const field = { count: async () => 1, isVisible: async () => true, isEnabled: async () => true,
    inputValue: async () => value, locator: () => group, fill: async next => {
      value = next; searchOpen = Boolean(next); if (next) searches.push(next);
    } };
  const page = { url: () => 'https://artists.bandsintown.com/artists/3251702/events/new', getByRole: () => empty,
    locator: selector => selector.startsWith('input#venueField') ? field : empty };
  const actual = await prepareEventForm(page, target, async () => true, message => stages.push(message));
  assert.deepEqual(searches, ['La Te Da', 'La Te Da, Key West']);
  assert.equal(actual.venueMatches, true);
  assert.ok(stages.includes('selecting the matching venue suggestion'));
});

test('a custom location uses the street from a resort address and commits the state option', async () => {
  const venue = { ...listing, venue: 'The Reach Key West', address: 'Curio Collection by Hilton, 1435 Simonton St' };
  const visible = { count: async () => 1, isVisible: async () => true, isEnabled: async () => true };
  const fields = {}, stages = [];
  const input = name => ({ ...visible, inputValue: async () => fields[name] || '', isEditable: async () => true,
    fill: async value => { fields[name] = value; }, blur: async () => {} });
  let regionChosen = false;
  const button = { ...visible, waitFor: async () => {}, first() { return this; },
    dispatchEvent: async type => { assert.equal(type, 'mousedown'); regionChosen = true; } };
  const options = { evaluateAll: async () => [{ value: 'FL', label: 'Florida', selected: regionChosen }],
    getByRole: (role, { name }) => { assert.equal(name, 'Florida'); return button; } };
  const region = { ...input('region'), waitFor: async () => {}, evaluate: async () => false, locator: () => ({ locator: () => options }) };
  const country = { ...visible, inputValue: async () => 'US', evaluate: async () => true,
    locator: () => ({ evaluateAll: async () => [{ value: 'US', label: 'United States' }] }) };
  let completed = false;
  const form = { ...visible, locator: selector => {
    if (selector === '#venueFormCountryField') return country;
    if (selector === '#venueFormRegionField') return region;
    return input(selector.match(/name="([^"]+)"/)[1]);
  }, getByRole: () => ({ ...visible, click: async () => { completed = true; } }) };
  const page = { url: () => 'https://artists.bandsintown.com/artists/3251702/events/new/add-location',
    waitForURL: async () => {}, locator: () => ({ locator: () => form }) };
  await prepareEventForm(page, venue, async () => true, message => stages.push(message));
  assert.equal(completed, true);
  assert.equal(regionChosen, true);
  assert.deepEqual(fields, { region: 'Florida', name: 'The Reach Key West', address: '1435 Simonton St', city: 'Key West', postal_code: '33040' });
  assert.ok(stages.includes('selecting the venue state or region'));
});
