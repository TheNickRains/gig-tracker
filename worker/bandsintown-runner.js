// Railway runner. The hosted Chromium profile survives service restarts.
const { WebSocket } = require('ws');
const { createHostedOperator } = require('./bandsintown-browser');

const origin = new URL(process.env.SHOW_SYNC_URL);
const token = process.env.SHOW_SYNC_RUNNER_TOKEN;
if (origin.protocol !== 'https:' || !token || token.length < 32) throw new Error('Set SHOW_SYNC_URL and SHOW_SYNC_RUNNER_TOKEN.');
const bearer = 'Bearer ' + token;
const operate = createHostedOperator();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function api(action, body) {
  const res = await fetch(new URL('/calendar-publish/runner/' + action, origin), {
    headers: { Authorization: bearer, 'Content-Type': 'application/json' },
    method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
  });
  if (res.status === 409) return { wait: true };
  if (!res.ok) throw new Error('The publishing worker returned ' + res.status);
  return res.status === 204 ? {} : res.json();
}

let draining = false;
let dirty = false;
async function drain() {
  dirty = true;
  if (draining) return;
  draining = true;
  try {
    while (dirty) {
      dirty = false;
      const claim = await api('claim');
      if (claim.wait || !claim.job) continue;
      const { job } = claim;
      const identity = { event_id: job.event_id, revision: job.revision };
      let result;
      try {
        result = await operate(job, async () => (await api('check', identity)).current === true);
      } catch {
        result = { status: 'review',
          issue: 'Open Bandsintown and confirm whether the listing changed. Use Retry Bandsintown only after checking the result.' };
      }
      await api('result', { ...result, ...identity });
      dirty = true;
    }
  } catch (error) {
    console.error('Bandsintown runner:', error.message);
    setTimeout(() => void drain(), 5000);
  } finally {
    draining = false;
  }
}

async function main() {
  const url = new URL('/calendar-publish/runner/live', origin);
  url.protocol = 'wss:';
  let delay = 1000;
  for (;;) {
    await new Promise(resolve => {
      const socket = new WebSocket(url, { headers: { Authorization: bearer }, handshakeTimeout: 10000 });
      socket.on('open', () => { delay = 1000; void drain(); });
      socket.on('message', () => void drain());
      socket.on('error', error => console.error('Publishing socket:', error.message));
      socket.once('close', resolve);
    });
    await wait(delay);
    delay = Math.min(delay * 2, 30000);
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
