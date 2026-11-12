const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../app/index.html'), 'utf8');
const helpers = html.slice(html.indexOf('var bounceResending = {};'), html.indexOf('// Bounce notifications are dismissable:'));
const loader = html.slice(html.indexOf('function loadActivities('), html.indexOf('var actsReady = false'));
const bounceAt = '2026-11-07T21:50:00.000Z';
const bounceBody = '⚠️ Email bounced — wrong@example.com doesn’t exist. Fix the contact’s address and re-send.';
const fullBody = 'Hello Ashley,\n\n' + 'Complete original email. '.repeat(45) + '\n[EPK](https://example.com/epk)\nThanks!';
function deal(overrides = {}) {
  return { uuid: 'deal-id', id: 0, bounced: true, bounceId: 'bounce-id', bounceEmail: 'wrong@example.com',
    lastBounceTs: Date.parse(bounceAt), email: 'correct@example.com', activity: [], ...overrides };
}
function harness(responses = [], p = deal()) {
  const requests = [], toasts = [], calls = { poke: 0, reload: 0 };
  const context = vm.createContext({
    pipeline: [p], ME: 'artist-id', currentScreen: 'detail', loadSeq: 1,
    renderHome() {}, renderPipeline() {}, rerenderOpenDetail() {}, renderHomeIfReady() {},
    openDetail() {}, jumpToDraft() {},
    dotFor() {}, relTime() { return 'Today'; },
    showToast(message, error) { toasts.push({ message, error }); },
    loadPipeline() { calls.reload++; }, pokeWorker() { calls.poke++; },
    sb: { rpc(name,args){const request={rpc:name,args,ops:[]};requests.push(request);const response=responses.shift();return Promise.resolve(typeof response==='function'?response(request):response);}, from(table) {
      const request = { table, ops: [] };
      const chain = {};
      for (const method of ['select', 'eq', 'in', 'ilike', 'lte', 'gte', 'order', 'limit', 'single', 'insert']) {
        chain[method] = (...args) => { request.ops.push({ method, args }); return chain; };
      }
      chain.then = (resolve, reject) => {
        requests.push(request);
        if (!responses.length) return Promise.reject(Error('Unexpected database request')).then(resolve, reject);
        const response = responses.shift();
        return Promise.resolve(typeof response === 'function' ? response(request) : response).then(resolve, reject);
      };
      return chain;
    } }
  });
  vm.runInContext(helpers + '\n' + loader, context);
  return { context, requests, toasts, calls, p };
}
const ok = data => ({ data, error: null });
function normalResponses() {
  return [ok({ person: { email: 'correct@example.com' } }), ok([]), ok([]),
    ok([{ subject: 'My original subject', body: fullBody, ai_draft: 'AI draft' }]),
    request => ok({ id:request.args.p_id, pipeline_entry_id:request.args.p_entry, human:request.args.p_human, status:'scheduled' })];
}

test('correcting the address changes Fix address to Resend across reloads', async () => {
  const p = deal({ bounceId: null, bounceEmail: '', email: ' CORRECT@example.com ' });
  const h = harness([ok([{ id: 'bounce-id', pipeline_entry_id: p.uuid, kind: 'system', body: bounceBody, created_at: bounceAt }])], p);
  h.context.loadActivities([p.uuid], 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(p.bounced, true);
  assert.equal(p.bounceEmail, 'wrong@example.com');
  assert.equal(p.bounceId, 'bounce-id');
  assert.equal(h.context.bounceAction(p).label, 'Resend');
  p.email = ' WRONG@example.com ';
  assert.equal(h.context.bounceAction(p).label, 'Fix address');
  p.email = '';
  assert.equal(h.context.bounceAction(p).label, 'Fix address');
  p.email = 'not-an-email';
  assert.equal(h.context.bounceAction(p).label, 'Fix address');
});

test('bounce history describes the old address without claiming the new address is invalid', () => {
  const h = harness();
  assert.equal(h.context.bounceHistoryText(bounceBody), 'Earlier email to wrong@example.com bounced.');
  assert.equal(h.context.bounceHistoryText('Other system event'), 'Other system event');
});

test('resend preserves the entire original body and subject and uses the corrected recipient', async () => {
  const h = harness(normalResponses());
  await h.context.resendBouncedEmail(h.p.uuid);
  const insert = h.requests.find(r=>r.rpc==='queue_message').args;
  assert.equal(insert.p_to, 'correct@example.com');
  assert.equal(insert.p_body, fullBody);
  assert.ok(insert.p_body.length > 600);
  assert.equal(insert.p_subject, 'My original subject');
  assert.equal(insert.p_ai, 'AI draft');
  assert.equal(insert.p_human, true);
  assert.equal(insert.p_entry, h.p.uuid);
  assert.equal(insert.p_id, h.p.bounceId);
  assert.equal(h.calls.poke, 1);
  assert.equal(h.p.bounced, true, 'queueing is not successful delivery');
  assert.equal(h.context.bounceAction(h.p).label, 'Sending…');
  assert.equal(h.context.bounceAction(h.p).disabled, true);
});

test('repeated clicks queue only one resend', async () => {
  const h = harness(normalResponses());
  await Promise.all([h.context.resendBouncedEmail(h.p.uuid), h.context.resendBouncedEmail(h.p.uuid)]);
  await h.context.resendBouncedEmail(h.p.uuid);
  assert.equal(h.requests.filter(r=>r.rpc==='queue_message').length, 1);
  assert.equal(h.calls.poke, 1);
});

test('another tab reuses the bounce request and reviews the existing outcome', async () => {
  const responses = normalResponses();
  responses[4] = ok({status:'sent'});
  const h = harness(responses);
  await h.context.resendBouncedEmail(h.p.uuid);
  assert.equal(h.calls.poke, 0);
  assert.match(h.toasts.at(-1).message, /already attempted/);
});

test('a contact edited again in another tab must be reviewed before resending', async () => {
  const h = harness([ok({ person: { email: 'different@example.com' } })]);
  await h.context.resendBouncedEmail(h.p.uuid);
  assert.equal(h.requests.length, 1);
  assert.equal(h.calls.poke, 0);
  assert.match(h.toasts.at(-1).message, /contact changed/);
});

test('an existing pending draft blocks an additional resend', async () => {
  const h = harness([ok({ person: { email: 'correct@example.com' } }), ok([{ id: 'another-draft' }])]);
  await h.context.resendBouncedEmail(h.p.uuid);
  assert.equal(h.requests.length, 2);
  assert.equal(h.calls.poke, 0);
  assert.match(h.toasts.at(-1).message, /draft is already waiting/);
});

test('a manual resend or a new bounce since the page loaded prevents a stale resend', async () => {
  for (const event of [{ kind: 'email_out' }, { id: 'new-bounce', kind: 'system', body: bounceBody }, { kind: 'system', body: '✓ Bounce dismissed' }]) {
    const h = harness([ok({ person: { email: 'correct@example.com' } }), ok([]), ok([event])]);
    await h.context.resendBouncedEmail(h.p.uuid);
    assert.equal(h.requests.length, 3);
    assert.equal(h.calls.poke, 0);
    assert.match(h.toasts.at(-1).message, /conversation changed/);
  }
});

test('missing original content never falls back to a truncated activity preview', async () => {
  const h = harness([ok({ person: { email: 'correct@example.com' } }), ok([]), ok([]), ok([])]);
  await h.context.resendBouncedEmail(h.p.uuid);
  assert.equal(h.calls.poke, 0);
  assert.match(h.toasts.at(-1).message, /complete original email is not saved/);
  assert.equal(h.context.bounceAction(h.p).label, 'Resend');
});

test('database failures keep the bounce visible and do not trigger the worker', async () => {
  const responses = normalResponses();
  responses[4] = { error: { message: 'Database unavailable' } };
  const h = harness(responses);
  await h.context.resendBouncedEmail(h.p.uuid);
  assert.equal(h.p.bounced, true);
  assert.equal(h.calls.poke, 0);
  assert.match(h.toasts.at(-1).message, /Database unavailable/);
  assert.equal(h.context.bounceAction(h.p).label, 'Resend');
});

test('a confirmed outbound clears the current bounce, and a later bounce resurfaces it', async () => {
  const p = deal();
  const events = [
    { id: 'bounce-id', pipeline_entry_id: p.uuid, kind: 'system', body: bounceBody, created_at: bounceAt },
    { id: 'outbound-id', pipeline_entry_id: p.uuid, kind: 'email_out', body: fullBody, created_at: '2026-11-07T21:51:00Z' }
  ];
  const h = harness([ok(events)], p);
  h.context.loadActivities([p.uuid], 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(p.bounced, false);
  const later = { id: 'later-bounce', pipeline_entry_id: p.uuid, kind: 'system', body: bounceBody.replace('wrong@', 'correct@'), created_at: '2026-11-07T21:52:00Z' };
  const h2 = harness([ok([later, ...events])], p);
  h2.context.loadActivities([p.uuid], 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(p.bounced, true);
  assert.equal(p.bounceId, 'later-bounce');
  assert.equal(h2.context.bounceAction(p).label, 'Fix address');
});
