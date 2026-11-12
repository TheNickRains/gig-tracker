// All external operations are injected so send races/failures can be tested
// without Gmail. The database claim is the authority across worker instances.
function createMailProcessor(api) {
  let running = null;
  const errorText = e => String(e.message || e).slice(0, 180);
  const versionFilter = m => `id=eq.${m.id}&status=eq.scheduled&updated_at=eq.${encodeURIComponent(m.updated_at)}`;
  async function setBeforeSend(m, status, reason) {
    return api.patch('scheduled_messages?' + versionFilter(m), { status, cancel_reason: reason });
  }
  async function tokenFor(artist) {
    const [conn] = await api.get(`google_connections?artist_id=eq.${artist}&select=refresh_token`);
    if (!conn) { const e = new Error('Gmail not connected — reconnect to send this saved draft'); e.definitive = true; throw e; }
    try { return await api.refresh(conn.refresh_token); }
    catch (e) {
      if (e.oauthCode === 'invalid_grant') {
        await api.patch(`artists?id=eq.${artist}`, { gmail_connected: false });
        e.definitive = true;
      }
      throw e;
    }
  }
  async function receivedReply(token, m) {
    const rows = await api.get(`activities?pipeline_entry_id=eq.${m.pipeline_entry_id}&kind=eq.email_in&created_at=gte.${encodeURIComponent(m.created_at)}&select=id&limit=1`);
    if (rows.length) return true;
    const messages = await api.search(token, `from:${m.to_email} after:${Math.floor(Date.parse(m.created_at) / 1000)}`);
    for (const item of messages) {
      const full = await api.message(token, item.id);
      if (full && !['SENT','DRAFT','TRASH','SPAM'].some(label => (full.labelIds || []).includes(label)) && Number(full.internalDate) >= Date.parse(m.created_at)) return true;
    }
    return false;
  }
  async function receipt(m, gid) {
    // Retrying this write is safe; retrying the Gmail send is not.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await api.patch(`scheduled_messages?id=eq.${m.id}&status=in.(sending,uncertain)`, {
          status: 'sent', gmail_message_id: gid, sent_at: new Date().toISOString(), sent_via: 'gmail', cancel_reason: null
        });
        return;
      } catch (e) { if (attempt === 2) throw e; }
    }
  }
  async function dispatch(candidate) {
    let token, thread, sig;
    try {
      if(!candidate.human){const [artist]=await api.get(`artists?id=eq.${candidate.artist_id}&select=allow_auto_send`);if(!artist?.allow_auto_send){await setBeforeSend(candidate,'ready','Assistant sending is off — review and send when ready');return;}}
      token = await tokenFor(candidate.artist_id);
      if (!candidate.human && await receivedReply(token, candidate)) {
        await setBeforeSend(candidate, 'canceled', 'They replied before the follow-up was sent'); return;
      }
      thread = await api.thread(token, candidate.to_email);
      sig = await api.signature(candidate.artist_id);
    } catch (e) {
      // A temporary lookup error leaves the original scheduled intention intact.
      await setBeforeSend(candidate, e.definitive ? 'failed' : 'scheduled', errorText(e));
      return;
    }
    const [m] = await api.rpc('claim_scheduled_message', { p_id: candidate.id, p_version: candidate.updated_at });
    if (!m) return; // another worker, edit, cancellation, closed deal, or changed recipient won
    let gid;
    if(thread?.subject && thread.subject.replace(/^(re:\s*)+/i,'').trim().toLowerCase()!==m.subject.replace(/^(re:\s*)+/i,'').trim().toLowerCase())thread=null;
    try { gid = await api.send(token, m.to_email, m.subject, m.body, thread, sig, m.rfc_message_id); }
    catch (e) {
      await api.patch(`scheduled_messages?id=eq.${m.id}&status=eq.sending`, {
        status: e.definitive ? 'failed' : 'uncertain', cancel_reason: errorText(e)
      });
      return;
    }
    if (!gid) {
      await api.patch(`scheduled_messages?id=eq.${m.id}&status=eq.sending`, { status: 'uncertain', cancel_reason: 'Gmail response did not include a receipt. Checking Sent before any retry.' });
      return;
    }
    // If persistence fails after acceptance, leave the claimed row alone. Its
    // stable RFC Message-ID lets reconciliation recover the Gmail receipt later.
    await receipt(m, gid);
  }
  async function reconcile() {
    const stale = encodeURIComponent(new Date(Date.now() - 10 * 60000).toISOString());
    const rows = await api.get(`scheduled_messages?or=(status.eq.uncertain,and(status.eq.sending,attempt_started_at.lt.${stale}))&select=*`);
    for (const m of rows) {
      try {
        if (!m.rfc_message_id) continue;
        const token = await tokenFor(m.artist_id);
        const found = await api.search(token, `in:sent rfc822msgid:${m.rfc_message_id}`);
        if (found.length) await receipt(m, found[0].id);
        else if (m.status === 'sending') await api.patch(`scheduled_messages?id=eq.${m.id}&status=eq.sending`, { status: 'uncertain', cancel_reason: 'No Gmail receipt yet. Check Sent; this message will not be resent automatically.' });
      } catch (e) { api.error('send reconciliation', m.id, errorText(e)); }
    }
  }
  async function recordAccepted() {
    const rows = await api.get('scheduled_messages?status=eq.sent&gmail_message_id=not.is.null&activity_recorded=eq.false&select=*');
    for (const m of rows) {
      try {
        await api.log({ pipeline_entry_id: m.pipeline_entry_id, kind: 'email_out', body: m.body, source: 'email_sync', email_message_id: m.gmail_message_id, created_at: m.sent_at });
        await api.patch(`pipeline_entries?id=eq.${m.pipeline_entry_id}&status=in.(lead,outreach)`, { status: 'pitched' });
        await api.patch(`pipeline_entries?id=eq.${m.pipeline_entry_id}&or=(last_activity_at.is.null,last_activity_at.lt.${encodeURIComponent(m.sent_at)})`, { last_activity_at: m.sent_at });
        await api.patch(`scheduled_messages?id=eq.${m.id}`, { activity_recorded: true });
      } catch (e) { api.error('sent mail bookkeeping', m.id, errorText(e)); }
    }
  }
  async function run() {
    await reconcile();
    const due = await api.get(`scheduled_messages?status=eq.scheduled&send_at=lte.${encodeURIComponent(new Date().toISOString())}&order=send_at.asc&select=*`);
    for (const m of due) {
      try { await dispatch(m); } catch (e) { api.error('send processing', m.id, errorText(e)); }
    }
    await recordAccepted();
  }
  return { process() { if (!running) running = run().finally(() => { running = null; }); return running; }, receivedReply };
}
module.exports = { createMailProcessor };
