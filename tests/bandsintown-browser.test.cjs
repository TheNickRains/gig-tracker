const assert = require('node:assert/strict');
const { test } = require('node:test');
const { browserAction, createHostedOperator, dashboardUrl, eventId, inspectSubmission, publishedReceipt, setNewEventStartTime } = require('../worker/bandsintown-browser');

test('the publication receipt must match the submitted Calendar show', async () => {
  const listing = { venue: 'The Reserve Key West', date: '2026-11-27', time: '19:00', city: 'Key West', region: 'FL', address: '510 Southard St' };
  const receipt = { ...listing, id: '12345', status: 'PUBLISHED', time: '19:00:00' };
  const page = { url: () => 'https://artists.bandsintown.com/artists/3251702/events/upcoming?publish_success=1', evaluate: async () => receipt };
  assert.equal(await publishedReceipt(page, listing), '12345');
  assert.equal(await publishedReceipt(page, { ...listing, date: '2026-11-28' }), null);
  assert.equal(await publishedReceipt(page, { ...listing, time: '17:00' }), null);
  assert.equal(await publishedReceipt(page, { ...listing, venue: 'Elsewhere' }), null);
  assert.equal(await publishedReceipt(page, { ...listing, title: 'Changed title' }), null);
  assert.equal(await publishedReceipt(page, { ...listing, description: 'Changed notes' }), null);
  receipt.status = 'DRAFT';
  assert.equal(await publishedReceipt(page, listing), null);
});

test('the hosted browser stays on the artist dashboard and only trusts Bandsintown event IDs', () => {
  assert.equal(dashboardUrl('https://artists.bandsintown.com/'), true);
  assert.equal(dashboardUrl('https://www.artists.bandsintown.com/'), true);
  assert.equal(dashboardUrl('https://artists.bandsintown.com.evil.test/'), false);
  assert.equal(dashboardUrl('https://accounts.google.com/'), false);
  assert.equal(eventId('https://www.bandsintown.com/e/1234-nick-rains'), '1234');
  assert.equal(eventId('https://artists.bandsintown.com/events/1234/edit'), '1234');
  assert.equal(eventId('https://unrelated.test/events/1234/edit'), null);
});

test('dashboard writes require a current revision and never fill a login field', async () => {
  let clicked = 0;
  let url = 'https://artists.bandsintown.com/artists/3251702/events/1234';
  const locator = { isVisible: async () => true, click: async () => { clicked++; } };
  const page = {
    getByRole: () => ({ count: async () => 1, nth: () => locator }),
    url: () => url,
  };
  const publish = { action: 'click', role: 'button', name: 'Publish' };
  await assert.rejects(() => browserAction(page, publish, async () => false), /no longer current/);
  assert.equal(clicked, 0);
  await browserAction(page, publish, async () => true);
  assert.equal(clicked, 1);
  url = 'https://artists.bandsintown.com/artists/32517029/events/1234';
  await assert.rejects(() => browserAction(page, publish, async () => true), /no longer current/);
  assert.equal(clicked, 1);
  const login = await browserAction(page, { action: 'fill', role: 'textbox', name: 'Password', value: 'anything' }, async () => true);
  assert.match(login, /sign in as Nick Rains/i);
});

test('new events fill only the show start time, verify it after blur, and preserve a matching time', async () => {
  const job = { operation: 'upsert', listing: { date: '2026-11-27', time: '19:00' } };
  let url = 'https://artists.bandsintown.com/artists/3251702/events/new/single-page';
  let value = '';
  let rejectChange = false;
  const actions = [];
  const input = {
    isVisible: async () => true,
    isEditable: async () => true,
    getAttribute: async () => 'text',
    inputValue: async () => value,
    fill: async next => { value = next; actions.push(next); },
    press: async key => { actions.push(key); },
    blur: async () => { if (rejectChange) value = ''; actions.push('blur'); },
  };
  const page = {
    url: () => url,
    locator: selector => { assert.equal(selector, 'input[name="start_time"]:visible'); return input; },
  };
  await assert.rejects(() => setNewEventStartTime(page, job, async () => false), /no longer current/);
  assert.deepEqual(actions, []);
  assert.equal(await setNewEventStartTime(page, job, async () => true), true);
  assert.deepEqual(actions, ['7:00 PM', 'Escape', 'blur']);
  value = '07:00 PM';
  assert.equal(await setNewEventStartTime(page, job, async () => true), false);
  assert.equal(actions.length, 3);
  rejectChange = true;
  value = '';
  await assert.rejects(() => setNewEventStartTime(page, job, async () => true), /did not retain/);
  url = 'https://artists.bandsintown.com/artists/3251702/events/123/edit';
  assert.equal(await setNewEventStartTime(page, job, async () => true), false);
});

const artist = 'https://artists.bandsintown.com/artists/3251702';
const upcoming = artist + '/events/upcoming';
const newForm = artist + '/events/new?version=single-page';
const listing = { title: 'The Reserve', venue: 'The Reserve Key West', address: '510 Southard St',
  city: 'Key West', region: 'FL', date: '2026-11-27', time: '19:00' };

test('a save may continue in an explicit confirmation dialog only', async () => {
  for (const snapshot of ['', '- dialog "Confirm publication"', '- dialog "Failed to publish, try again"']) {
    const overlay = Boolean(snapshot);
    let url = artist + '/events/new';
    let confirms = 0;
    const modal = { last() { return this; }, waitFor: async () => {}, isVisible: async () => overlay,
      ariaSnapshot: async () => snapshot,
      getByRole: () => ({ count: async () => 1, isVisible: async () => true, isEnabled: async () => true,
        click: async () => { confirms++; url = upcoming + '?publish_success=1'; } }),
    };
    const page = { url: () => url, waitForURL: async () => {},
      evaluate: async () => ({ ...listing, status: 'PUBLISHED', id: '1234' }),
      getByRole: () => assert.fail('The event form cannot be submitted again'),
      locator: selector => {
        if (selector.startsWith('.bit-popup-title')) return { ...modal, isVisible: async () => false };
        if (selector.startsWith('[role="dialog"]')) return modal;
        if (selector === 'body') return { ariaSnapshot: async () => '- button "Publish Event"' };
        return { evaluateAll: async () => [] };
      },
    };
    const result = await inspectSubmission(page, listing, async () => true);
    const confirmed = snapshot.includes('Confirm publication');
    assert.deepEqual(result, confirmed ? { id: '1234' } : {});
    assert.equal(confirms, confirmed ? 1 : 0);
  }
});

function hostedFixture({ feeds = [], onSave, onModel, onLoad, receipt, inspect } = {}) {
  let url = artist + '/events/past';
  let removed = false;
  const calls = { adds: 0, saves: 0, reads: 0, model: 0, loads: [], actions: [] };
  const setUrl = next => { url = next; };
  const setRemoved = () => { removed = true; url = upcoming; };
  const visible = { count: async () => 1, isVisible: async () => true, isEnabled: async () => true };
  const empty = { count: async () => 0, evaluateAll: async () => [], isVisible: async () => false };
  const field = value => ({ ...visible, inputValue: async () => value, isEditable: async () => true, getAttribute: async () => null });
  const page = {
    url: () => url, setDefaultTimeout() {}, route: async () => {}, unroute: async () => {},
    goto: async target => {
      url = target;
      calls.loads.push(target);
      if (target === newForm) calls.adds++;
      onLoad?.(target, setUrl, setRemoved);
    },
    waitForURL: async () => {},
    evaluate: async () => /publish_success=1/.test(url) || (receipt && !removed) ? receipt : removed,
    locator: selector => {
      if (selector.includes('password')) return { first: () => empty };
      if (selector.startsWith('form.event-form')) return { first: () => ({ waitFor: async () => {} }) };
      if (selector === 'body') return { ariaSnapshot: async () => '- heading "Nick Rains"\n- button "Save"' };
      if (selector === 'a[href]') return { evaluateAll: async () => ['https://www.bandsintown.com/e/9999'] };
      if (selector === 'input,select') return { evaluateAll: async () => [{ name: 'start_time', value: listing.time }] };
      if (selector.startsWith('input#eventStartDateField')) return field(listing.date);
      if (selector.startsWith('input#venueField')) return { ...field(listing.venue + ' - Key West, FL'),
        locator: () => ({ ...visible, locator: () => visible }) };
      if (selector.includes('input[name="start_time"]')) return field(listing.time);
      if (selector.includes('input[name="title"]')) return field(listing.title);
      if (selector.includes('flag_no_announce')) return { ...visible, isChecked: async () => false };
      return empty;
    },
    getByRole: (_role, { name }) => ({ count: async () => 1, nth: () => ({ ...visible,
      click: async () => {
        calls.actions.push(name);
        if (name === 'Save') { calls.saves++; await onSave?.(setUrl); }
        if (name === 'Delete') setRemoved();
      },
    }) }),
  };
  const operate = createHostedOperator({ GEMINI_API_KEY: 'test' }, {
    connect: async () => ({ isConnected: () => true, contexts: () => [{ pages: () => [page] }] }),
    lookupPublishedEvent: async () => {
      const next = feeds[Math.min(calls.reads++, feeds.length - 1)];
      assert.ok(next, 'Unexpected public listing lookup');
      return next;
    },
    inspectSubmission: inspect || (async () => ({})), wait: async () => {},
    fetch: async (_url, req) => {
      calls.model++;
      const step = onModel ? onModel(JSON.parse(JSON.parse(req.body).contents[0].parts[0].text)) :
        { action: 'click', role: 'button', name: 'Save' };
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(step) }] } }] });
    },
  });
  return { calls, run: (job = {}) => operate({ operation: 'upsert', listing, ...job }, async () => true) };
}

test('reuses a public exact match; conflicts, mismatched metadata, and unavailable reads never create events', async () => {
  for (const status of ['matched', 'conflict', 'needs-update', 'unavailable']) {
    const { calls, run } = hostedFixture({ feeds: [{ status, id: '1234', issue: 'Check this listing.' }] });
    const result = await run();
    assert.deepEqual(result, status === 'matched' ? { status: 'verified', bandsintown_id: '1234' } :
      { status: 'review', issue: 'Check this listing.' });
    assert.deepEqual(calls.loads, [upcoming]);
    assert.equal(calls.adds + calls.saves + calls.model, 0);
  }
});

test('after one Save, a lost acknowledgement or click timeout is reconciled without resubmitting', async () => {
  for (const timeout of [false, true]) {
    const { calls, run } = hostedFixture({ feeds: [{ status: 'missing' }, { status: 'missing' }, { status: 'matched', id: '1234' }],
      onSave: () => { if (timeout) throw new Error('Click timed out'); } });
    assert.deepEqual(await run(), { status: 'verified', bandsintown_id: '1234' });
    assert.equal(calls.adds, 1);
    assert.equal(calls.model, 1);
    assert.equal(calls.saves, 1);
    assert.equal(calls.reads, 3);
  }
});

test('an ambiguous save and an unrelated event link cannot validate a missing show', async () => {
  const attempted = hostedFixture({ feeds: [{ status: 'missing' }] });
  assert.match((await attempted.run()).issue, /Save was attempted/);
  assert.equal(attempted.calls.saves, 1);
  assert.equal(attempted.calls.model, 1);
  assert.equal(attempted.calls.reads, 4);
  const unrelated = hostedFixture({ feeds: [{ status: 'missing' }], onModel: () => ({ action: 'verified', bandsintown_id: '9999' }) });
  assert.equal((await unrelated.run()).status, 'review');
  assert.equal(unrelated.calls.saves, 0);
});

test('a stored ID is edited on its exact form and a changed schedule is confirmed without publish_success', async () => {
  const { calls, run } = hostedFixture({ onSave: setUrl => setUrl(upcoming), receipt: { ...listing, status: 'PUBLISHED', id: '1234' } });
  assert.deepEqual(await run({ bandsintown_id: '1234' }), { status: 'verified', bandsintown_id: '1234' });
  assert.deepEqual(calls.loads, [artist + '/events/1234?version=single-page']);
  assert.equal(calls.adds, 0);
  assert.equal(calls.saves, 1);
  assert.equal(calls.reads, 0);
});

test('stored edits do not adopt other IDs or reuse public evidence when optional fields were cleared', async () => {
  const { calls, run } = hostedFixture({ onSave: setUrl => setUrl(upcoming), receipt: { ...listing, status: 'PUBLISHED', id: '7777' } });
  assert.equal((await run({ bandsintown_id: '1234' })).status, 'review');
  assert.equal(calls.adds, 0);
  assert.equal(calls.saves, 1);
  assert.equal(calls.reads, 0);
});

test('stored removals require an exact dashboard confirmation; a redirect alone proves nothing', async () => {
  const deleted = hostedFixture({ onModel: () => ({ action: 'click', role: 'button', name: 'Delete' }) });
  assert.deepEqual(await deleted.run({ operation: 'remove', bandsintown_id: '1234' }), { status: 'verified' });
  assert.deepEqual(deleted.calls.actions, ['Delete']);
  const redirected = hostedFixture({ onLoad: (_target, setUrl) => setUrl(upcoming) });
  assert.equal((await redirected.run({ operation: 'remove', bandsintown_id: '1234' })).status, 'review');
  assert.deepEqual(redirected.calls.actions, []);
  const wrong = hostedFixture({ onLoad: (_target, setUrl) => setUrl(artist + '/events/2222') });
  assert.equal((await wrong.run({ operation: 'remove', bandsintown_id: '1234' })).status, 'review');
  assert.deepEqual(wrong.calls.actions, []);
});

test('a missing show opens its exact single-page form despite an obstructed Add Event button', async () => {
  let url = upcoming;
  let openings = 0;
  const page = {
    url: () => url,
    setDefaultTimeout() {},
    route: async () => {},
    unroute: async () => {},
    goto: async target => { assert.equal(target, newForm); openings++; url = target; },
    locator: selector => {
      if (selector.includes('password')) return { first: () => ({ isVisible: async () => false }) };
      if (selector.startsWith('form.event-form')) return { first: () => ({ waitFor: async () => assert.equal(url, newForm) }) };
      if (selector === 'body') return { ariaSnapshot: async () => openings ?
        '- textbox "Venue"\n  - option "7:00 PM":\n    - button "7:00 PM"\n- button "Continue"' : '- heading "You have no upcoming events"' };
      if (selector === '.bit-dropdown-options > ul') return { evaluateAll: async () => true };
      return { evaluateAll: async () => [] };
    },
    waitForURL: async () => {},
    getByRole: () => assert.fail('The covered dashboard Add Event control must never be required'),
  };
  const operate = createHostedOperator({ GEMINI_API_KEY: 'test' }, {
    connect: async () => ({ contexts: () => [{ pages: () => [page] }] }),
    lookupPublishedEvent: async () => ({ status: 'missing' }),
    fetch: async (_target, req) => {
      const request = JSON.parse(req.body);
      const data = JSON.parse(request.contents[0].parts[0].text);
      assert.equal(data.url, artist + '/events/new');
      assert.equal(request.generationConfig.thinkingConfig.thinkingBudget, 0);
      assert.equal(openings, 1);
      assert.equal(data.snapshot, '- textbox "Venue"\n- button "Continue"');
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"action":"click"}' }] } }] });
    },
  });
  const result = await operate({ operation: 'upsert', listing: { title: 'Test show' } }, async () => true);
  assert.equal(result.status, 'review');
  assert.match(result.issue, /could not identify the next control/);
  assert.equal(openings, 1);
});

test('a signed-out browser leaves a sign-in tab open for the owner', async () => {
  const tabs = [];
  let url = 'about:blank';
  const page = {
    url: () => url,
    setDefaultTimeout() {},
    route: async () => {},
    unroute: async () => {},
    goto: async target => {
      assert.equal(target, 'https://artists.bandsintown.com/artists/3251702/events/upcoming');
      url = 'https://artists.bandsintown.com/en-US/account/login';
    },
    waitForURL: async matches => {
      assert.equal(matches(new URL(url)), false);
      throw new Error('Still signed out');
    },
    close: async () => assert.fail('Keep the sign-in tab open'),
  };
  const operate = createHostedOperator({ GEMINI_API_KEY: 'test' }, {
    connect: async () => ({
      isConnected: () => true,
      contexts: () => [{ pages: () => tabs, newPage: async () => { tabs.push(page); return page; } }],
    }),
    fetch: async () => assert.fail('The model should only receive the dashboard'),
  });
  const job = { operation: 'upsert', listing: { title: 'Test show' } };
  const result = await operate(job, async () => true);
  assert.equal(result.status, 'review');
  assert.match(result.issue, /private Railway browser viewer.*Retry Bandsintown/);
  assert.equal(url, 'https://artists.bandsintown.com/en-US/account/login');
  assert.deepEqual(await operate(job, async () => true), result);
  assert.deepEqual(tabs, [page]);
});
