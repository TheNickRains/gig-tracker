const assert = require('node:assert/strict');
const { test } = require('node:test');
const { browserAction, createHostedOperator, dashboardUrl, eventId } = require('../worker/bandsintown-browser');

test('the hosted browser stays on the artist dashboard and only trusts Bandsintown event IDs', () => {
  assert.equal(dashboardUrl('https://artists.bandsintown.com/'), true);
  assert.equal(dashboardUrl('https://artists.bandsintown.com.evil.test/'), false);
  assert.equal(dashboardUrl('https://accounts.google.com/'), false);
  assert.equal(eventId('https://www.bandsintown.com/e/1234-nick-rains'), '1234');
  assert.equal(eventId('https://artists.bandsintown.com/events/1234/edit'), '1234');
  assert.equal(eventId('https://unrelated.test/events/1234/edit'), null);
});

test('dashboard writes require a current revision and never fill a login field', async () => {
  let clicked = 0;
  const locator = { isVisible: async () => true, click: async () => { clicked++; } };
  const page = {
    getByRole: () => ({ count: async () => 1, nth: () => locator }),
    url: () => 'https://artists.bandsintown.com/events/1234',
  };
  const publish = { action: 'click', role: 'button', name: 'Publish' };
  await assert.rejects(() => browserAction(page, publish, async () => false), /no longer current/);
  assert.equal(clicked, 0);
  await browserAction(page, publish, async () => true);
  assert.equal(clicked, 1);
  const login = await browserAction(page, { action: 'fill', role: 'textbox', name: 'Password', value: 'anything' }, async () => true);
  assert.match(login, /sign in as Nick Rains/);
});

test('the hosted operator uses its Chromium context and verifies the saved event ID', async () => {
  let closed = false;
  let clicks = 0;
  let url = 'about:blank';
  let modelCalls = 0;
  const page = {
    url: () => url,
    setDefaultTimeout() {},
    route: async () => {},
    goto: async target => { url = target; },
    locator: selector => {
      if (selector.includes('password')) return { first: () => ({ isVisible: async () => false }) };
      if (selector === 'body') return { ariaSnapshot: async () => '- heading "Nick Rains"\n- button "Save"' };
      return { evaluateAll: async () => clicks ? ['https://www.bandsintown.com/e/1234'] : [] };
    },
    getByRole: () => ({ count: async () => 1, nth: () => ({
      isVisible: async () => true,
      click: async () => { clicks++; },
    }) }),
    close: async () => { closed = true; },
  };
  const operate = createHostedOperator({ GEMINI_API_KEY: 'test' }, {
    connect: async () => ({ contexts: () => [{ newPage: async () => page }] }),
    fetch: async (target, req) => {
      assert.match(target, /generativelanguage\.googleapis\.com/);
      assert.equal(req.headers['x-goog-api-key'], 'test');
      const step = [
        { action: 'verified', bandsintown_id: '1234' },
        { action: 'click', role: 'button', name: 'Save' },
        { action: 'verified', bandsintown_id: '1234' },
      ][modelCalls++];
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(step) }] } }] });
    },
  });
  assert.deepEqual(await operate({ operation: 'upsert', listing: { title: 'Test show' } }, async () => true),
    { status: 'verified', bandsintown_id: '1234' });
  assert.equal(clicks, 1);
  assert.equal(closed, true);
});
