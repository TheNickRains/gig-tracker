/**
 * Gig Collective — read-only inbox agent (slice 2)
 *
 * Runs on a time trigger inside the booking@ Google account. For each booker
 * the artist is pursuing, it reads recent Gmail threads (READ-ONLY — it never
 * sends or modifies mail), asks Claude what each new message means, logs it to
 * the pipeline, and conservatively advances the stage. Won/Dead are PROPOSED,
 * not auto-applied — Nick confirms those in the app.
 *
 * Secrets live in Script Properties (Project Settings → Script properties),
 * NEVER in this file:
 *   SUPABASE_URL          https://fjqfqykytqtwqbzyihqq.supabase.co
 *   SUPABASE_SERVICE_KEY  the service_role key (bypasses RLS — server-only)
 *   ANTHROPIC_API_KEY     sk-ant-...
 *   ARTIST_ID             Nick's auth user id (uuid) from the artists table
 *
 * Setup + how to find ARTIST_ID: see SETUP.md in this folder.
 */

// Per the claude-api skill default. Haiku 4.5 ('claude-haiku-4-5') is ~5x cheaper
// per the model table and is well-suited to short-email classification — switch
// this one line if you'd rather optimize cost over headroom. Your call.
var MODEL = 'claude-opus-4-8';
var ANTHROPIC_VERSION = '2023-06-01';
var LOOKBACK = 'newer_than:2d';   // how far back each run scans Gmail
var MAX_THREADS = 25;             // per contact, per run — keep runs cheap

function P_(k) { return PropertiesService.getScriptProperties().getProperty(k); }

// ── Entry point: set a time-driven trigger (~ every 10 min) on this ──
function syncInbox() {
  var me = P_('ARTIST_ID');
  var entries = sbGet_('pipeline_entries?artist_id=eq.' + me +
    '&select=id,status,contact:contacts(email,name),venue:venues(name)');
  if (!entries || !entries.length) return;

  var myEmail = Session.getActiveUser().getEmail().toLowerCase();

  entries.forEach(function (e) {
    var contact = e.contact || {};
    var email = (contact.email || '').trim().toLowerCase();
    if (!email) return;

    // READ-ONLY: search threads involving this booker, recent only.
    var threads = GmailApp.search('(from:' + email + ' OR to:' + email + ') ' + LOOKBACK, 0, MAX_THREADS);
    threads.forEach(function (thread) {
      thread.getMessages().forEach(function (msg) {
        var from = msg.getFrom().toLowerCase();
        var inbound = from.indexOf(email) > -1;          // booker -> us
        var outbound = from.indexOf(myEmail) > -1;       // us -> booker
        if (!inbound && !outbound) return;

        var msgId = msg.getId();
        if (inbound) {
          handleInbound_(e, contact, msg, msgId);
        } else if (outbound) {
          // Foundation for tone-learning: capture what Nick actually sends.
          logActivity_(e.id, 'email_out', 'Sent: ' + truncate_(msg.getPlainBody(), 280), msgId);
        }
      });
    });
  });
}

function handleInbound_(entry, contact, msg, msgId) {
  var read = interpret_(contact.name || 'the booker', (entry.venue || {}).name || 'the venue',
    entry.status, msg.getSubject(), truncate_(msg.getPlainBody(), 4000));
  if (!read) return;

  var note = read.summary || 'Reply received';
  if (read.suggested_status && read.suggested_status !== 'none' && read.suggested_status !== entry.status) {
    note += '  [suggests: ' + read.suggested_status + (read.date ? ', ' + read.date : '') + (read.pay ? ', ' + read.pay : '') + ' — confirm in app]';
  }

  // Dedup is enforced by the unique index on activities.email_message_id.
  var inserted = logActivity_(entry.id, 'email_in', note, msgId);
  if (!inserted) return; // already logged this message on a prior run

  // Conservative auto-advance only: outreach -> waiting when a booker replies.
  // Won/Dead/offers are PROPOSED in the note above, never auto-applied.
  if (entry.status === 'outreach') {
    sbPatch_('pipeline_entries?id=eq.' + entry.id, { status: 'waiting', last_activity_at: new Date().toISOString() });
  } else {
    sbPatch_('pipeline_entries?id=eq.' + entry.id, { last_activity_at: new Date().toISOString() });
  }
}

// ── Claude: classify + extract from one email (raw HTTP via UrlFetchApp) ──
function interpret_(contactName, venueName, status, subject, body) {
  var schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      intent: { type: 'string', enum: ['interested', 'passed', 'scheduling', 'asked_for_info', 'other'] },
      summary: { type: 'string' },
      suggested_status: { type: 'string', enum: ['outreach', 'waiting', 'followup', 'won', 'dead', 'none'] },
      date: { type: 'string' },
      pay: { type: 'string' }
    },
    required: ['intent', 'summary', 'suggested_status', 'date', 'pay']
  };
  var system = 'You read one email a booking contact sent to an independent musician and update a CRM. ' +
    'Be terse and factual. "summary" is one short line for the activity log (<=120 chars). ' +
    'suggested_status: "won" only if a date/booking is confirmed; "dead" only if clearly declined; ' +
    '"followup" if they went quiet or said "later"; "waiting" if the ball is in their court; else "none". ' +
    'Extract date and pay only if explicitly stated, else return an empty string "". Never invent details.';
  var user = 'Venue: ' + venueName + '\nContact: ' + contactName + '\nCurrent stage: ' + status +
    '\nSubject: ' + subject + '\n\nEmail:\n' + body;

  var payload = {
    model: MODEL,
    max_tokens: 400,
    system: system,
    messages: [{ role: 'user', content: user }],
    output_config: { format: { type: 'json_schema', schema: schema } }
  };
  try {
    var resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': P_('ANTHROPIC_API_KEY'), 'anthropic-version': ANTHROPIC_VERSION },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var data = JSON.parse(resp.getContentText());
    if (data.type === 'error') { Logger.log('Anthropic error: ' + resp.getContentText()); return null; }
    var text = (data.content || []).map(function (b) { return b.text || ''; }).join('');
    return JSON.parse(text);
  } catch (err) {
    Logger.log('interpret_ failed: ' + err);
    return null;
  }
}

// ── Supabase REST (service_role key — bypasses RLS) ──
function sbHeaders_() {
  var k = P_('SUPABASE_SERVICE_KEY');
  return { apikey: k, Authorization: 'Bearer ' + k };
}
function sbGet_(path) {
  var resp = UrlFetchApp.fetch(P_('SUPABASE_URL') + '/rest/v1/' + path, {
    method: 'get', headers: sbHeaders_(), muteHttpExceptions: true
  });
  try { return JSON.parse(resp.getContentText()); } catch (e) { return []; }
}
function sbPatch_(path, body) {
  UrlFetchApp.fetch(P_('SUPABASE_URL') + '/rest/v1/' + path, {
    method: 'patch', contentType: 'application/json',
    headers: Object.assign({ Prefer: 'return=minimal' }, sbHeaders_()),
    payload: JSON.stringify(body), muteHttpExceptions: true
  });
}
// Returns true if a new row was inserted, false if the message was already logged.
function logActivity_(entryId, kind, bodyText, msgId) {
  var resp = UrlFetchApp.fetch(P_('SUPABASE_URL') + '/rest/v1/activities?on_conflict=email_message_id', {
    method: 'post', contentType: 'application/json',
    headers: Object.assign({ Prefer: 'resolution=ignore-duplicates,return=representation' }, sbHeaders_()),
    payload: JSON.stringify({
      pipeline_entry_id: entryId, kind: kind, body: bodyText,
      source: 'email_sync', email_message_id: msgId
    }),
    muteHttpExceptions: true
  });
  try { var rows = JSON.parse(resp.getContentText()); return !!(rows && rows.length); }
  catch (e) { return false; }
}

function truncate_(s, n) { s = s || ''; return s.length > n ? s.slice(0, n) : s; }
