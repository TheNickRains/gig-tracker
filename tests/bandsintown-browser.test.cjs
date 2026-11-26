const assert = require('node:assert/strict');
const { test } = require('node:test');
const { browserAction, createHostedOperator, dashboardUrl, eventId } = require('../worker/bandsintown-browser');

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

test('a blocked time-picker click uses its exact enabled option and rechecks the revision', async () => {
  let current = true;
  let dispatched = 0;
  const locator = {
    isVisible: async () => true,
    isEnabled: async () => true,
    click: async () => { throw Object.assign(new Error('Time option click timed out'), { name: 'TimeoutError' }); },
    dispatchEvent: async name => { assert.equal(name, 'click'); dispatched++; },
  };
  const page = {
    getByRole: () => ({ count: async () => 1, nth: () => locator }),
    url: () => 'https://artists.bandsintown.com/artists/3251702/events/new',
  };
  const time = { action: 'click', role: 'button', name: '7:00 PM' };
  assert.match(await browserAction(page, time, async () => current), /Verify the selected time/);
  await assert.rejects(() => browserAction(page, time, async () => {
    const previous = current;
    current = false;
    return previous;
  }), /no longer current/);
  await assert.rejects(() => browserAction(page, { ...time, name: 'Publish' }, async () => true), /click timed out/);
  assert.equal(dispatched, 1);
});

test('the hosted operator starts at Upcoming Events and verifies the saved event ID', async () => {
  const upcoming = 'https://artists.bandsintown.com/artists/3251702/events/upcoming';
  let url = 'https://artists.bandsintown.com/artists/3251702/events/past';
  let routeHandler;
  let clicks = 0;
  let modelCalls = 0;
  const page = {
    url: () => url,
    setDefaultTimeout() {},
    getByRole: (role, options) => options.name instanceof RegExp ? {
      or() { return this; },
      first() { return this; },
      waitFor: async () => {},
    } : { count: async () => 1, nth: () => ({
      isVisible: async () => true,
      click: async () => { clicks++; },
    }) },
    route: async (pattern, handler) => {
      assert.equal(pattern, '**/*');
      routeHandler = handler;
    },
    unroute: async (pattern, handler) => {
      assert.equal(pattern, '**/*');
      assert.equal(handler, routeHandler);
      routeHandler = undefined;
    },
    goto: async target => { assert.equal(target, upcoming); url = target; },
    locator: selector => {
      if (selector.includes('password')) return { first: () => ({ isVisible: async () => false }) };
      if (selector === 'body') return { ariaSnapshot: async () => '- heading "Nick Rains"\n- button "Save"' };
      return { evaluateAll: async () => clicks ? ['https://www.bandsintown.com/e/1234'] : [] };
    },
    close: async () => assert.fail('Keep the dashboard tab open'),
  };
  const signInTab = { url: () => 'https://artists.bandsintown.com/en-US/account/login' };
  const operate = createHostedOperator({ GEMINI_API_KEY: 'test' }, {
    connect: async () => ({ isConnected: () => true, contexts: () => [{
      pages: () => [page, signInTab],
      newPage: async () => assert.fail('Reuse the dashboard tab'),
    }] }),
    fetch: async (target, req) => {
      assert.match(target, /generativelanguage\.googleapis\.com/);
      assert.equal(req.headers['x-goog-api-key'], 'test');
      assert.equal(JSON.parse(JSON.parse(req.body).contents[0].parts[0].text).url, upcoming);
      const step = [
        { action: 'verified', bandsintown_id: '1234' },
        { action: 'click', role: 'button', name: 'Save' },
        { action: 'verified', bandsintown_id: '1234' },
      ][modelCalls++] || { action: 'click', role: 'table', name: 'Drafts' };
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(step) }] } }] });
    },
  });
  assert.deepEqual(await operate({ operation: 'upsert', listing: { title: 'Test show' } }, async () => true),
    { status: 'verified', bandsintown_id: '1234' });
  assert.equal(clicks, 1);
  assert.equal(routeHandler, undefined);
  const stalled = await operate({ operation: 'upsert', listing: { title: 'Test show' } }, async () => true);
  assert.equal(stalled.status, 'review');
  assert.match(stalled.issue, /runner stalled at “Drafts”/);
  assert.equal(modelCalls, 6);
  assert.equal(clicks, 1);
});

test('empty Upcoming Events opens Add Event and an incomplete model reply cannot click a control', async () => {
  const upcoming = 'https://artists.bandsintown.com/artists/3251702/events/upcoming';
  let url = upcoming;
  let openings = 0;
  const addEvent = {
    or() { return this; },
    first() { return this; },
    waitFor: async () => {},
    isVisible: async () => true,
    click: async () => {
      openings++;
      url = 'https://artists.bandsintown.com/artists/3251702/events/new';
    },
  };
  const page = {
    url: () => url,
    setDefaultTimeout() {},
    route: async () => {},
    unroute: async () => {},
    locator: selector => {
      if (selector.includes('password')) return { first: () => ({ isVisible: async () => false }) };
      if (selector === 'body') return { ariaSnapshot: async () => openings ? '- textbox "Venue"' : '- heading "You have no upcoming events"' };
      return { evaluateAll: async () => [] };
    },
    getByRole: (role, { name }) => {
      assert.match('Add Event', name);
      return addEvent;
    },
  };
  const operate = createHostedOperator({ GEMINI_API_KEY: 'test' }, {
    connect: async () => ({ contexts: () => [{ pages: () => [page] }] }),
    fetch: async (_target, req) => {
      const request = JSON.parse(req.body);
      const data = JSON.parse(request.contents[0].parts[0].text);
      assert.equal(data.url, url);
      assert.equal(request.generationConfig.thinkingConfig.thinkingBudget, 0);
      assert.equal(openings, 1);
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
