// Gig Collective — backend worker (Slice A.2): Gmail push + poll fallback.
//
// Two paths to the same processing:
//  • PUSH (primary): Gmail watch -> Pub/Sub -> POST /gmail/push -> history API ->
//    process only the new messages. Near-instant.
//  • POLL (fallback, every POLL_MINUTES): scans pipeline contacts' recent mail,
//    catches anything push missed and re-arms the watch (which expires ~7 days).
//
// Zero dependencies — Node 18+ global fetch. Runs as its own Railway service.
// Env (worker service Variables): SUPABASE_URL, SUPABASE_SERVICE_KEY (service_role),
// GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_TOPIC, PUSH_TOKEN, POLL_MINUTES.

const http = require("http");
const webpush = require("web-push");

const SUPA = (process.env.SUPABASE_URL || "").trim();
const SVC = (process.env.SUPABASE_SERVICE_KEY || "").trim();
const GCID = (process.env.GOOGLE_CLIENT_ID || "").trim();
const GCS = (process.env.GOOGLE_CLIENT_SECRET || "").trim();
const GMAIL_TOPIC = (process.env.GMAIL_TOPIC || "").trim();
const PUSH_TOKEN = (process.env.PUSH_TOKEN || "").trim();
const GEMINI_KEY = (process.env.GEMINI_API_KEY || "").trim();
const GEMINI_MODEL = (process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
const INTERVAL = (Number(process.env.POLL_MINUTES) || 10) * 60000;
const PORT = process.env.PORT || 8080;

if (!SUPA || !SVC || !GCID || !GCS) {
  console.error("Missing env: need SUPABASE_URL, SUPABASE_SERVICE_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET");
  process.exit(1);
}
function keyClaim(jwt, c) { try { return JSON.parse(Buffer.from(jwt.split(".")[1], "base64").toString())[c]; } catch (e) { return "?"; } }
console.log("Supabase key — role:", keyClaim(SVC, "role"), "ref:", keyClaim(SVC, "ref"), "| GMAIL_TOPIC:", GMAIL_TOPIC || "(none)", "| Gemini:", GEMINI_KEY ? GEMINI_MODEL : "OFF (no GEMINI_API_KEY)");

const sHeaders = { apikey: SVC, Authorization: "Bearer " + SVC, "Content-Type": "application/json" };
async function sGet(path) {
  const r = await fetch(`${SUPA}/rest/v1/${path}`, { headers: sHeaders });
  if (!r.ok) { console.error("Supabase GET failed", path.split("?")[0], r.status, (await r.text()).slice(0, 200)); return []; }
  return r.json();
}
async function sPatch(path, body) {
  const r = await fetch(`${SUPA}/rest/v1/${path}`, { method: "PATCH", headers: { ...sHeaders, Prefer: "return=minimal" }, body: JSON.stringify(body) });
  if (!r.ok) console.error("Supabase PATCH failed", path.split("?")[0], r.status, (await r.text()).slice(0, 200));
}
async function sDelete(path) { await fetch(`${SUPA}/rest/v1/${path}`, { method: "DELETE", headers: sHeaders }); }
// Insert activity; unique index on email_message_id dedupes. Returns true if new.
async function logActivity(row) {
  // Dedup with a plain lookup instead of ON CONFLICT — avoids the partial-index
  // incompatibility entirely, works regardless of the index state.
  if (row.email_message_id) {
    const existing = await sGet(`activities?select=id&email_message_id=eq.${encodeURIComponent(row.email_message_id)}&limit=1`);
    if (existing.length) return null;
  }
  const r = await fetch(`${SUPA}/rest/v1/activities`, {
    method: "POST", headers: { ...sHeaders, Prefer: "return=representation" }, body: JSON.stringify(row),
  });
  if (!r.ok) { console.error("activity insert failed", r.status, (await r.text()).slice(0, 200)); return null; }
  const j = await r.json().catch(() => []);
  return Array.isArray(j) && j.length ? j[0] : null; // row when new, null when duplicate
}

// ── Gemini (Slice C) ──
async function geminiOnce(prompt, asJson) {
  // maxOutputTokens generous + thinking budget 0: on 2.5 models internal
  // "thinking" tokens count AGAINST maxOutputTokens and silently truncate the
  // visible text (the cut-off-mid-sentence bug). We want fast, full output.
  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: asJson ? 0.2 : 0.7, maxOutputTokens: 4096 } };
  if (/2\.5/.test(GEMINI_MODEL)) body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
  if (asJson) body.generationConfig.responseMimeType = "application/json";
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return (((j.candidates || [])[0] || {}).content?.parts || []).map((p) => p.text || "").join("").trim();
}
// Free-tier RPM limits 429 readily — wait out the suggested delay once, then give up gracefully.
async function gemini(prompt, asJson) {
  try { return await geminiOnce(prompt, asJson); }
  catch (e) {
    if (!/429/.test(e.message)) throw e;
    const m = e.message.match(/retryDelay[^0-9]*(\d+)/);
    const wait = Math.min((m ? Number(m[1]) : 12), 25) * 1000;
    console.log("gemini 429 — retrying in", wait / 1000, "s");
    await new Promise((res) => setTimeout(res, wait));
    return await geminiOnce(prompt, asJson);
  }
}

// Summarize + classify a fresh inbound reply. Proposals only — never moves the stage.
async function aiEnrich(entry, activityId, replyText) {
  if (!GEMINI_KEY || !replyText) return;
  try {
    const out = await gemini(
      `You assist a musician who books their own gigs. A venue contact replied to a booking thread.\n` +
      `Reply text:\n"""${replyText.slice(0, 1500)}"""\n` +
      `Current deal stage: ${entry.status}\n` +
      `Return strict JSON: {"summary": "<=14 words, the gist that matters to the musician", ` +
      `"intent": "interested"|"date_offer"|"decline"|"question"|"other"}`, true);
    const j = JSON.parse(out);
    const patch = {};
    if (j.summary) patch.summary = String(j.summary).slice(0, 200);
    if (j.intent) patch.ai_intent = String(j.intent).slice(0, 30);
    if (Object.keys(patch).length) await sPatch(`activities?id=eq.${activityId}`, patch);
    // Don't stack the same proposal — once per entry per week is plenty.
    const proposal = j.intent === "decline" ? "AI: reads like a pass — consider Mark passed"
      : j.intent === "date_offer" ? "AI: they're talking dates — possible hold" : null;
    if (proposal) {
      const recent = await sGet(`activities?pipeline_entry_id=eq.${entry.id}&kind=eq.system&body=eq.${encodeURIComponent(proposal)}&created_at=gte.${encodeURIComponent(new Date(Date.now() - 7 * 86400000).toISOString())}&select=id&limit=1`);
      if (!recent.length) await logActivity({ pipeline_entry_id: entry.id, kind: "system", body: proposal, source: "email_sync" });
    }
  } catch (e) { console.error("aiEnrich", e.message); }
}

async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({ client_id: GCID, client_secret: GCS, refresh_token: refreshToken, grant_type: "refresh_token" });
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!r.ok) throw new Error(`token ${r.status}: ${(await r.text()).slice(0, 150)}`);
  return (await r.json()).access_token;
}
async function gmailSearch(token, q) {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=20`, { headers: { Authorization: "Bearer " + token } });
  return r.ok ? (await r.json()).messages || [] : [];
}
async function gmailGet(token, id) {
  // format=full gives the snippet (the reply's content preview) + body, which we
  // surface as activity context now and will summarize with Gemini in slice C.
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers: { Authorization: "Bearer " + token } });
  return r.ok ? r.json() : null;
}
function decodeEntities(s) {
  return (s || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}
// Gmail snippets drag the quoted thread along ("... On Jun 11, Nick wrote: ...").
// Keep only the fresh words — cut at the first quote marker.
function cleanSnippet(s) {
  s = decodeEntities((s || "").trim());
  const m = s.search(/\b(On (Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d).{0,140}?wrote:|-+\s*Original Message\s*-+|-+\s*Forwarded message\s*-+|From:\s.{3,80}@|Sent from my )/);
  if (m > 0) s = s.slice(0, m);
  return s.trim().replace(/[\s>-]+$/, "");
}
async function gmailHistory(token, startHistoryId) {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${startHistoryId}&historyTypes=messageAdded&maxResults=100`, { headers: { Authorization: "Bearer " + token } });
  if (!r.ok) { console.error("history failed", r.status, (await r.text()).slice(0, 150)); return []; }
  const j = await r.json();
  const ids = [];
  (j.history || []).forEach((h) => (h.messagesAdded || []).forEach((m) => { if (m.message && m.message.id) ids.push(m.message.id); }));
  return Array.from(new Set(ids));
}
function header(msg, name) {
  const hs = (msg.payload && msg.payload.headers) || [];
  const h = hs.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : "";
}
function b64url(s) { return Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function mimeWord(s) { return /[^\x20-\x7E]/.test(s) ? "=?UTF-8?B?" + Buffer.from(s).toString("base64") + "?=" : s; }
function escHtml(t) { return (t || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
async function gmailSend(token, to, subject, body, thread, sig) {
  let headers = `To: ${to}\r\nSubject: ${mimeWord(subject)}\r\nMIME-Version: 1.0\r\n`;
  if (thread && thread.msgId) headers += `In-Reply-To: ${thread.msgId}\r\nReferences: ${thread.msgId}\r\n`;
  let raw;
  if (sig && (sig.logo || sig.name)) {
    // multipart/alternative: plain text + HTML with the branded signature
    const sigText = "\n\n--\n" + [sig.name, sig.phone, sig.site].filter(Boolean).join(" · ");
    const sigHtml = '<br><br><div style="border-top:1px solid #ddd;padding-top:12px;margin-top:4px">'
      + (sig.logo ? '<img src="' + sig.logo + '" width="120" alt="' + escHtml(sig.name || "") + '" style="display:block;margin-bottom:8px"><br>' : "")
      + '<strong style="font:14px -apple-system,Segoe UI,Helvetica,Arial,sans-serif">' + escHtml(sig.name || "") + "</strong>"
      + '<div style="font:12px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#666">'
      + [sig.phone, sig.site].filter(Boolean).map(escHtml).join(" · ") + "</div></div>";
    const htmlBody = '<div style="font:14px/1.55 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#222;white-space:pre-wrap">' + escHtml(body) + "</div>" + sigHtml;
    const bnd = "gigc_" + Date.now().toString(36);
    headers += `Content-Type: multipart/alternative; boundary="${bnd}"\r\n`;
    raw =
      headers + "\r\n" +
      `--${bnd}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n` + body + sigText + `\r\n` +
      `--${bnd}\r\nContent-Type: text/html; charset="UTF-8"\r\n\r\n` + htmlBody + `\r\n--${bnd}--`;
  } else {
    headers += `Content-Type: text/plain; charset="UTF-8"\r\n`;
    raw = headers + "\r\n" + body;
  }
  const payload = { raw: b64url(raw) };
  if (thread && thread.threadId) payload.threadId = thread.threadId;
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`send ${r.status}: ${(await r.text()).slice(0, 150)}`);
  return (await r.json()).id;
}
// We always reply IN THREAD: find the latest exchange with this contact and
// continue it (threadId + In-Reply-To + "Re:" subject). New thread only if none.
async function findThread(token, email) {
  const msgs = await gmailSearch(token, `(from:${email} OR to:${email})`);
  if (!msgs.length) return null;
  const full = await gmailGet(token, msgs[0].id);
  if (!full) return null;
  let subject = header(full, "Subject") || "";
  if (subject && !/^re:/i.test(subject)) subject = "Re: " + subject;
  return { threadId: full.threadId, msgId: header(full, "Message-ID") || null, subject };
}

// Shared: given a pipeline entry + a Gmail message, log it and advance the stage.
async function applyMessage(entry, full, contactEmail, artistId) {
  const from = (header(full, "From") || "").toLowerCase();
  const subject = header(full, "Subject") || "(no subject)";
  const inbound = from.includes(contactEmail.toLowerCase());
  if (inbound) {
    const snippet = cleanSnippet(full.snippet);
    const body = snippet ? snippet.slice(0, 600) : "Reply: " + subject;
    const isNew = await logActivity({ pipeline_entry_id: entry.id, kind: "email_in", body: body, source: "email_sync", email_message_id: full.id });
    console.log("  inbound reply on entry", entry.id, "newly logged:", !!isNew);
    if (isNew) {
      const patch = { last_activity_at: new Date().toISOString() };
      // A reply = engagement -> In talks. Also resurrects "passed" (they wrote back!).
      // Never auto-moves hold/booked/played (conversation continues, deal state doesn't regress) or dead (terminal).
      if (["lead", "pitched", "passed", "outreach", "waiting", "followup"].includes(entry.status)) patch.status = "talks";
      await sPatch(`pipeline_entries?id=eq.${entry.id}`, patch);
      if (artistId) notify(artistId, "You've got mail — " + contactEmail.split("@")[0] + " replied", body, "/app#entry/" + entry.id).catch(() => {});
      await aiEnrich(entry, isNew.id, body);
    }
  } else {
    // Store YOUR actual words (not just the subject) — the conversation view and
    // the AI both need real two-way context to avoid repeating what you've said.
    const outSnippet = cleanSnippet(full.snippet);
    const outBody = outSnippet ? outSnippet.slice(0, 600) : "Sent: " + subject;
    const isNew = await logActivity({ pipeline_entry_id: entry.id, kind: "email_out", body: outBody, source: "email_sync", email_message_id: full.id });
    // You pitched from Gmail like a human -> the card moves itself: Lead -> Pitched.
    if (isNew && ["lead", "outreach"].includes(entry.status)) {
      await sPatch(`pipeline_entries?id=eq.${entry.id}`, { status: "pitched", last_activity_at: new Date().toISOString() });
    }
  }
}

// Keep a Gmail watch armed for this account (re-arm when <2 days from expiry).
async function ensureWatch(artistId, conn, token) {
  if (!GMAIL_TOPIC) return;
  const fresh = conn.watch_expiry && new Date(conn.watch_expiry).getTime() - Date.now() > 2 * 86400000;
  if (fresh) return;
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/watch", {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ topicName: GMAIL_TOPIC, labelIds: ["INBOX"] }),
  });
  if (!r.ok) { console.error("watch failed", artistId, r.status, (await r.text()).slice(0, 150)); return; }
  const j = await r.json();
  const patch = { watch_expiry: new Date(Number(j.expiration)).toISOString() };
  if (!conn.history_id && j.historyId) patch.history_id = String(j.historyId);
  await sPatch(`google_connections?artist_id=eq.${artistId}`, patch);
  console.log("watch armed", artistId, "exp", patch.watch_expiry);
}

// Any contact at the venue speaks for the deal: map every venue-contact email
// to the artist's entry there (Yeti-card case: two emails, one room, one deal).
async function venueContactMap(artistId) {
  // Most-recently-active first: when one email (a multi-room talent buyer)
  // maps to several deals, the live conversation wins.
  const entries = await sGet(`pipeline_entries?artist_id=eq.${artistId}&order=last_activity_at.desc&select=id,status,venue_id,last_activity_at,contact:contacts(email)`);
  const map = {};
  const byVenue = {};
  entries.forEach((e) => {
    if (e.venue_id && !byVenue[e.venue_id]) byVenue[e.venue_id] = e;
    const em = e.contact && e.contact.email;
    if (em && !map[em.toLowerCase()]) map[em.toLowerCase()] = e;
  });
  const venueIds = [...new Set(entries.map((e) => e.venue_id).filter(Boolean))];
  if (venueIds.length) {
    const extra = await sGet(`contacts?venue_id=in.(${venueIds.join(",")})&select=email,venue_id`);
    extra.forEach((c) => {
      if (c.email && byVenue[c.venue_id] && !map[c.email.toLowerCase()]) map[c.email.toLowerCase()] = byVenue[c.venue_id];
    });
  }
  return map;
}

// PUSH path: a Pub/Sub notification arrived for emailAddress.
async function handlePush(emailAddress, notifHistoryId) {
  const arts = await sGet(`artists?email=eq.${encodeURIComponent(emailAddress)}&select=id`);
  if (!arts.length) { console.log("push: no artist for", emailAddress); return; }
  const artistId = arts[0].id;
  const conns = await sGet(`google_connections?artist_id=eq.${artistId}&select=refresh_token,history_id`);
  if (!conns.length) return;
  const conn = conns[0];
  let token;
  try { token = await refreshAccessToken(conn.refresh_token); } catch (e) { console.error("push refresh failed", e.message); return; }
  if (!conn.history_id) { await sPatch(`google_connections?artist_id=eq.${artistId}`, { history_id: String(notifHistoryId) }); return; }
  const ids = await gmailHistory(token, conn.history_id);
  if (ids.length) {
    const map = await venueContactMap(artistId);
    for (const id of ids) {
      const full = await gmailGet(token, id);
      if (!full) continue;
      const blob = ((header(full, "From") || "") + " " + (header(full, "To") || "")).toLowerCase();
      let entry = null, cemail = null;
      for (const em in map) { if (blob.includes(em)) { entry = map[em]; cemail = em; break; } }
      var fromAddr = ((header(full, "From") || "").match(/[\w.+-]+@[\w.-]+/) || ["?"])[0];
      console.log("push msg from", fromAddr, entry ? ("-> matched entry " + entry.id + " (status " + entry.status + ")") : ("-> NO MATCH; pipeline contacts=[" + Object.keys(map).join(", ") + "]"));
      if (entry) await applyMessage(entry, full, cemail, artistId);
    }
    console.log("push: processed", ids.length, "new msg(s) for", emailAddress);
  }
  await sPatch(`google_connections?artist_id=eq.${artistId}`, { history_id: String(notifHistoryId) });
}

// POLL path (fallback): scan each connection's pipeline contacts for recent mail.
async function pollArtist(artistId, token) {
  const map = await venueContactMap(artistId);
  for (const [email, entry] of Object.entries(map)) {
    const msgs = await gmailSearch(token, `(from:${email} OR to:${email}) newer_than:3d`);
    for (const m of msgs) {
      const full = await gmailGet(token, m.id);
      if (full) await applyMessage(entry, full, email, artistId);
    }
  }
}

// ── Tone-learning (Slice C): distill the artist's voice from their real sent mail ──
function extractPlainText(payload) {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body && payload.body.data) {
    try { return Buffer.from(payload.body.data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"); } catch (e) { return ""; }
  }
  for (const part of payload.parts || []) {
    const t = extractPlainText(part);
    if (t) return t;
  }
  return "";
}
async function refreshToneProfile(artistId, token) {
  if (!GEMINI_KEY) return;
  const arts = await sGet(`artists?id=eq.${artistId}&select=tone_updated_at`);
  if (!arts.length) return;
  const last = arts[0].tone_updated_at ? new Date(arts[0].tone_updated_at).getTime() : 0;
  if (Date.now() - last < 24 * 3600000) return; // refresh daily
  const msgs = await gmailSearch(token, "in:sent newer_than:90d");
  const samples = [];
  for (const m of msgs.slice(0, 12)) {
    const full = await gmailGet(token, m.id);
    if (!full) continue;
    let text = extractPlainText(full.payload).trim();
    text = cleanSnippet(text); // strip quoted tails
    if (text.length > 60) samples.push(text.slice(0, 600));
    if (samples.length >= 8) break;
  }
  if (samples.length < 2) { await sPatch(`artists?id=eq.${artistId}`, { tone_updated_at: new Date().toISOString() }); return; }
  try {
    const card = await gemini(
      `These are real emails a working musician sent (their authentic voice — including how they edit AI suggestions before sending):\n\n` +
      samples.map((s, i) => `--- EMAIL ${i + 1} ---\n${s}`).join("\n\n") +
      `\n\nDistill a TONE CARD (max 160 words) a ghostwriter would use to write indistinguishably as this person: greeting + sign-off style, sentence rhythm/length, formality, warmth, characteristic phrases (quote 3-5 verbatim), what they never do. Plain text.`, false);
    if (card) {
      await sPatch(`artists?id=eq.${artistId}`, { tone_profile: card.slice(0, 2000), tone_updated_at: new Date().toISOString() });
      console.log("tone profile refreshed", artistId, "from", samples.length, "sent emails");
    }
  } catch (e) { console.error("tone profile", artistId, e.message); }
}

// ── Web push: VAPID keys self-manage in app_secrets; notify() fans out ──
let VAPID_PUB = null;
async function ensureVapid() {
  const rows = await sGet("app_secrets?id=eq.vapid&select=value");
  let keys = rows.length ? rows[0].value : null;
  if (!keys || !keys.publicKey) {
    keys = webpush.generateVAPIDKeys();
    const r = await fetch(`${SUPA}/rest/v1/app_secrets`, { method: "POST", headers: { ...sHeaders, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ id: "vapid", value: keys }) });
    console.log("vapid: generated new keypair —", r.ok ? "persisted" : "PERSIST FAILED " + r.status);
  } else {
    console.log("vapid: loaded persisted keypair");
  }
  VAPID_PUB = keys.publicKey;
  webpush.setVapidDetails("mailto:thenickrains@gmail.com", keys.publicKey, keys.privateKey);
}
async function notify(artistId, title, body, url) {
  if (!VAPID_PUB) return;
  const subs = await sGet(`push_subscriptions?artist_id=eq.${artistId}&select=endpoint,p256dh,auth`);
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title, body: (body || "").slice(0, 140), url }));
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await sDelete(`push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`);
      else console.error("push send", e.statusCode || e.message);
    }
  }
}

// ── Calendar sync (Slice D): the artist's Google Calendar ⇄ the pipeline ──
// 1) IMPORT: days with events on their primary calendar -> availability 'busy'
//    (only where the artist hasn't painted the day manually — manual wins).
// 2) EXPORT: hold/booked entries with a gig_date become events (hold=tentative,
//    booked=confirmed); title/date changes update the same event.
// 3) LIFECYCLE: booked entries whose date has passed flip to 'played'.
async function syncCalendar(artistId, token) {
  try {
    const now = new Date();
    const max = new Date(now.getTime() + 60 * 86400000);
    // -- import busy days --
    const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&timeMin=${encodeURIComponent(now.toISOString())}&timeMax=${encodeURIComponent(max.toISOString())}&maxResults=250&fields=items(start,end,status,transparency,summary)`, { headers: { Authorization: "Bearer " + token } });
    if (r.ok) {
      const items = (await r.json()).items || [];
      const busyDays = new Set();
      items.forEach((ev) => {
        if (ev.status === "cancelled" || ev.transparency === "transparent") return;
        if ((ev.summary || "").includes("(Gig Collective)")) return; // our own export — not an external busy
        const d = (ev.start && (ev.start.date || (ev.start.dateTime || "").slice(0, 10))) || null;
        if (d) busyDays.add(d);
      });
      if (busyDays.size) {
        const existing = await sGet(`availability?artist_id=eq.${artistId}&select=day`);
        const have = new Set(existing.map((x) => x.day));
        const rows = [...busyDays].filter((d) => !have.has(d)).map((d) => ({ artist_id: artistId, day: d, status: "busy" }));
        if (rows.length) {
          await fetch(`${SUPA}/rest/v1/availability`, { method: "POST", headers: { ...sHeaders, Prefer: "return=minimal" }, body: JSON.stringify(rows) });
          console.log("calendar: imported", rows.length, "busy day(s)", artistId);
        }
      }
    } else console.error("calendar list failed", r.status, (await r.text()).slice(0, 120));
    // -- export holds/bookings + flip played --
    // Agent policy: the worker CREATES events on its own, but only EDITS or
    // DELETES one when the ARTIST changed the date in the app (gig_date_dirty).
    const entries = await sGet(`pipeline_entries?artist_id=eq.${artistId}&status=in.(hold,booked,played)&or=(gig_date.not.is.null,google_event_id.not.is.null)&select=id,status,gig_date,google_event_id,gig_date_dirty,gig_pay,gig_costs,venue:venues(name)`);
    for (const e of entries) {
      const evUrl = (idp) => `https://www.googleapis.com/calendar/v3/calendars/primary/events${idp ? "/" + idp : ""}`;
      // Date cleared by the artist -> remove the event.
      if (!e.gig_date) {
        if (e.google_event_id && e.gig_date_dirty) {
          await fetch(evUrl(e.google_event_id), { method: "DELETE", headers: { Authorization: "Bearer " + token } }).catch(() => {});
          await sPatch(`pipeline_entries?id=eq.${e.id}`, { google_event_id: null, gig_date_dirty: false });
          console.log("calendar: event removed (date cleared)", e.id);
        }
        continue;
      }
      const start = new Date(e.gig_date);
      if (e.status === "booked" && start.getTime() < Date.now() - 6 * 3600000) {
        await sPatch(`pipeline_entries?id=eq.${e.id}`, { status: "played", last_activity_at: new Date().toISOString() });
        await logActivity({ pipeline_entry_id: e.id, kind: "system", body: "Gig played — how did it go? (auto from calendar)", source: "email_sync" });
        console.log("calendar: booked -> played", e.id);
        continue;
      }
      if (e.status === "played") continue;
      const ev = {
        summary: (e.status === "hold" ? "HOLD: " : "Gig: ") + ((e.venue && e.venue.name) || "venue") + " (Gig Collective)",
        start: { dateTime: start.toISOString() },
        end: { dateTime: new Date(start.getTime() + 3 * 3600000).toISOString() },
        status: e.status === "hold" ? "tentative" : "confirmed",
        description: [e.gig_pay ? "Pay: " + e.gig_pay : null, e.gig_costs ? "Costs: " + e.gig_costs : null, "— Gig Collective"].filter(Boolean).join("\n"),
      };
      if (e.google_event_id) {
        if (!e.gig_date_dirty) continue; // never touch an existing event unprompted
        const er = await fetch(evUrl(e.google_event_id), { method: "PATCH", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(ev) });
        if (er.ok) { const ju = await er.json(); await sPatch(`pipeline_entries?id=eq.${e.id}`, { gig_date_dirty: false }); console.log("calendar: event updated (artist edit)", e.id, "start", ju.start && (ju.start.dateTime || ju.start.date), ju.htmlLink); }
        else console.error("calendar update failed", e.id, er.status, (await er.text()).slice(0, 120));
        continue;
      }
      const er = await fetch(evUrl(), { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(ev) });
      if (er.ok) {
        const j = await er.json();
        if (j.id) await sPatch(`pipeline_entries?id=eq.${e.id}`, { google_event_id: j.id, gig_date_dirty: false });
        console.log("calendar:", e.status, "event created", e.id, "start", j.start && (j.start.dateTime || j.start.date), j.htmlLink);
      } else console.error("calendar event failed", e.id, er.status, (await er.text()).slice(0, 120));
    }
  } catch (err) { console.error("syncCalendar", artistId, err.message); }
}

// Slice B: fire due scheduled messages.
// reply since scheduling -> cancel (intelligent disconnect); auto-send off -> 'ready'
// (the app surfaces "review & send"); auto-send on -> send from the artist's Gmail.
async function processScheduled() {
  const due = await sGet(`scheduled_messages?status=eq.scheduled&send_at=lte.${encodeURIComponent(new Date().toISOString())}&select=*`);
  for (const m of due) {
    try {
      // Human-initiated ("Send now") skips BOTH gates: the artist is the
      // authority, and they're often deliberately replying to a fresh message.
      if (!m.human) {
        const replies = await sGet(`activities?pipeline_entry_id=eq.${m.pipeline_entry_id}&kind=eq.email_in&created_at=gte.${encodeURIComponent(m.created_at)}&select=id&limit=1`);
        if (replies.length) {
          await sPatch(`scheduled_messages?id=eq.${m.id}`, { status: "canceled", cancel_reason: "They replied first" });
          await logActivity({ pipeline_entry_id: m.pipeline_entry_id, kind: "system", body: "Scheduled follow-up canceled — they replied first", source: "email_sync" });
          console.log("scheduled: canceled (reply arrived)", m.id);
          continue;
        }
        const arts = await sGet(`artists?id=eq.${m.artist_id}&select=allow_auto_send,display_name,phone,website,sig_logo_url`);
        if (!arts.length || !arts[0].allow_auto_send) {
          await sPatch(`scheduled_messages?id=eq.${m.id}`, { status: "ready" });
          notify(m.artist_id, "Send awaiting your review", m.subject, "/app#entry/" + m.pipeline_entry_id).catch(() => {});
          console.log("scheduled: ready for review (auto-send off)", m.id);
          continue;
        }
      }
      const conns = await sGet(`google_connections?artist_id=eq.${m.artist_id}&select=refresh_token`);
      if (!conns.length) {
        await sPatch(`scheduled_messages?id=eq.${m.id}`, { status: "failed", cancel_reason: "Gmail not connected" });
        continue;
      }
      const token = await refreshAccessToken(conns[0].refresh_token);
      const thread = await findThread(token, m.to_email).catch(() => null);
      const sigRows = await sGet(`artists?id=eq.${m.artist_id}&select=display_name,phone,website,sig_logo_url`);
      const sa = sigRows[0] || {};
      const sig = { name: sa.display_name, phone: sa.phone, site: sa.website, logo: sa.sig_logo_url };
      const gid = await gmailSend(token, m.to_email, (thread && thread.subject) || m.subject, m.body, thread, sig);
      await sPatch(`scheduled_messages?id=eq.${m.id}`, { status: "sent", sent_at: new Date().toISOString() });
      await logActivity({ pipeline_entry_id: m.pipeline_entry_id, kind: "email_out", body: m.body.slice(0, 600), source: "email_sync", email_message_id: gid });
      const entries = await sGet(`pipeline_entries?id=eq.${m.pipeline_entry_id}&select=status`);
      const patch = { last_activity_at: new Date().toISOString() };
      if (entries.length && ["lead", "outreach"].includes(entries[0].status)) patch.status = "pitched";
      await sPatch(`pipeline_entries?id=eq.${m.pipeline_entry_id}`, patch);
      notify(m.artist_id, "Sent ✓ " + m.to_email.split("@")[0], m.subject, "/app#entry/" + m.pipeline_entry_id).catch(() => {});
      console.log("scheduled: SENT", m.id, "->", m.to_email);
    } catch (e) {
      console.error("scheduled error", m.id, e.message);
      await sPatch(`scheduled_messages?id=eq.${m.id}`, { status: "failed", cancel_reason: (e.message || "error").slice(0, 180) });
    }
  }
}

async function tick() {
  try {
    await processScheduled();
    const conns = await sGet("google_connections?select=artist_id,refresh_token,history_id,watch_expiry");
    console.log(new Date().toISOString(), "poll", conns.length, "connection(s)");
    for (const c of conns) {
      try {
        let token;
        try { token = await refreshAccessToken(c.refresh_token); }
        catch (e) {
          console.error("refresh failed", c.artist_id, e.message);
          await sPatch(`artists?id=eq.${c.artist_id}`, { gmail_connected: false });
          await sDelete(`google_connections?artist_id=eq.${c.artist_id}`);
          continue;
        }
        try { await ensureWatch(c.artist_id, c, token); } catch (e) { console.error("watch error", c.artist_id, e.message); }
        try { await refreshToneProfile(c.artist_id, token); } catch (e) { console.error("tone error", c.artist_id, e.message); }
        await syncCalendar(c.artist_id, token);
        await pollArtist(c.artist_id, token);
      } catch (e) { console.error("artist error", c.artist_id, e.message); }
    }
  } catch (e) { console.error("tick error", e.message); }
}

// ── /ai/draft: the app asks Gemini to write the outreach (Slice C) ──
const pulseCache = new Map(); // venueId -> {summary, count, ts}
const ALLOWED_ORIGINS = ["https://gig.nicholasrains.com", "https://gig-tracker-production.up.railway.app"];
function corsHeaders(req) {
  const o = req.headers.origin || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Content-Type": "application/json",
  };
}
// Verify the caller's Supabase session token -> user id (so only the signed-in
// artist can draft against their own entries; service key never leaves here).
async function verifyUser(req) {
  const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!tok) return null;
  const r = await fetch(`${SUPA}/auth/v1/user`, { headers: { apikey: SVC, Authorization: "Bearer " + tok } });
  if (!r.ok) return null;
  return (await r.json()).id || null;
}
async function handleAiDraft(req, res, bodyStr) {
  const hdr = corsHeaders(req);
  try {
    if (!GEMINI_KEY) { res.writeHead(503, hdr); res.end(JSON.stringify({ error: "AI isn’t configured yet (GEMINI_API_KEY missing)" })); return; }
    const uid = await verifyUser(req);
    if (!uid) { res.writeHead(401, hdr); res.end(JSON.stringify({ error: "Not signed in" })); return; }
    const parsed = JSON.parse(bodyStr || "{}");
    const entryId = (parsed.entry_id || "").replace(/[^a-zA-Z0-9-]/g, "");
    if (!entryId) { res.writeHead(400, hdr); res.end(JSON.stringify({ error: "entry_id required" })); return; }
    const entries = await sGet(`pipeline_entries?id=eq.${entryId}&select=id,status,artist_id,gig_date,ticket_type,venue:venues(name,city,state,venue_type,ticket_type,pay_range,clientele,notes),contact:contacts(name,title)`);
    if (!entries.length || entries[0].artist_id !== uid) { res.writeHead(404, hdr); res.end(JSON.stringify({ error: "Entry not found" })); return; }
    const e = entries[0], v = e.venue || {}, c = e.contact || {};
    const arts = await sGet(`artists?id=eq.${uid}&select=display_name,genre,oneliner,website,epk,spotify,draw_claim,typical_crowd,set_formats,notable,markets,phone,tone_profile,rate_soft,rate_hard,home_market`);
    const a = arts[0] || {};
    const rateLine = (a.rate_soft || a.rate_hard)
      ? `RATES (the artist's own numbers — quote these EXACTLY when rate comes up; NEVER invent, discount, or underbid): soft ticket ${a.rate_soft || "not set"} · hard ticket ${a.rate_hard || "not set"}\n`
      : `RATES: not set — do NOT name any number; if they ask about rate, defer ("happy to talk numbers").\n`;
    const acts = await sGet(`activities?pipeline_entry_id=eq.${entryId}&kind=in.(email_in,email_out,note)&order=created_at.desc&limit=8&select=kind,body`);
    const lastInbound = (acts.find((x) => x.kind === "email_in") || {}).body || "";
    const convo = acts.slice().reverse().map((x) => (x.kind === "email_in" ? "THEM: " : x.kind === "email_out" ? "ME: " : "MY NOTE: ") + x.body).join("\n");
    // The objective is DERIVED FROM EVIDENCE — conversation state, notes, stage,
    // dates — never assumed. Cold intro only when there is zero prior exchange.
    const hasOutbound = acts.some((x) => x.kind === "email_out");
    const gigWhen = e.gig_date ? new Date(e.gig_date).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;
    const firstTouch = !hasOutbound && !lastInbound;
    let objective;
    if (e.status === "hold" || e.status === "booked") objective = "OBJECTIVE: the deal is at " + e.status + (gigWhen ? " for " + gigWhen : "") + ". Confirm/advance the date and logistics (load-in, set length, rate as agreed). No self-promotion — they already want the artist.";
    else if (lastInbound) objective = "OBJECTIVE: live conversation — their message is the latest word. Reply DIRECTLY to it: answer every question they asked, propose or lock concrete specifics (dates, times, rate, logistics), move the booking one step closer. Do NOT re-introduce the artist, do NOT add credentials or sales language — they already know who they're talking to.";
    else if (hasOutbound) objective = "OBJECTIVE: they haven't replied to the earlier email(s) below. Write a brief, warm follow-up that adds ONE new angle or ask (a specific date works well) without repeating the original pitch. 2-4 sentences. Never re-introduce from scratch.";
    else if (e.status === "played") objective = "OBJECTIVE: friendly check-in with a room the artist already played — reference the relationship, float availability for another date. Light, no hard sell.";
    else objective = "OBJECTIVE: first-touch cold outreach — concise intro, why the artist fits THIS room specifically (use the venue notes/clientele), one listen link, clear ask: are they the right person / can we get a date.";
    const draft = await gemini(
      `Write a booking email from a working musician to a venue contact. Plain text only — no subject line, no markdown, no placeholders/brackets, under 160 words, direct and human (never marketing copy). Sign off with the artist's first name and phone.\n\n` +
      objective + "\n\n" +
      `DEAL STAGE: ${e.status}${gigWhen ? " · TARGET DATE: " + gigWhen : ""}\n` +
      (lastInbound ? `THEIR LAST MESSAGE (answer this):\n"""${lastInbound.slice(0, 600)}"""\n` : "") +
      (convo ? `CONVERSATION SO FAR:\n${convo}\n` : "") +
      `VENUE: ${v.name || ""} (${v.venue_type || ""}, ${e.ticket_type || v.ticket_type || "soft"} ticket — quote the matching rate) in ${v.city || ""}, ${v.state || ""}. ${v.clientele ? "Clientele: " + v.clientele + "." : ""} ${v.notes ? "My notes on this venue: " + v.notes : ""}\n` +
      `CONTACT: ${c.name || "the booker"}${c.title ? " (" + c.title + ")" : ""}\n` +
      rateLine +
      (firstTouch
        ? `ARTIST (use what's relevant — this is a first touch): ${a.display_name || ""} — ${a.genre || ""}. ${a.oneliner || ""} Draw: ${a.draw_claim || "n/a"}. Crowd: ${a.typical_crowd || "n/a"}. Formats: ${a.set_formats || "n/a"}. Notable rooms: ${a.notable || "n/a"}. Home market: ${a.home_market || "n/a"}. Site: ${a.website || ""} ${a.epk ? "EPK: " + a.epk : ""} ${a.spotify ? "Spotify: " + a.spotify : ""} Phone: ${a.phone || ""}\n`
        : `ARTIST (background only — do NOT pitch credentials mid-conversation): ${a.display_name || ""}, ${a.genre || ""}. Phone: ${a.phone || ""}\n`) +
      (a.tone_profile ? `\nTONE CARD — write indistinguishably in THIS voice:\n${a.tone_profile}\n` : "") +
      `\nWrite only the email body.`, false);
    res.writeHead(200, hdr);
    res.end(JSON.stringify({ draft }));
  } catch (err) {
    console.error("ai/draft", err.message);
    const limited = /429/.test(err.message);
    res.writeHead(limited ? 429 : 500, hdr);
    res.end(JSON.stringify({ error: limited ? "AI is catching its breath (rate limit) — try again in a minute" : "Draft failed: " + err.message.slice(0, 120) }));
  }
}

// HTTP: health + the Pub/Sub push webhook + AI drafting.
http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (req.method === "OPTIONS") { res.writeHead(204, corsHeaders(req)); res.end(); return; }
  if (req.method === "GET" && u.pathname === "/") { res.writeHead(200); res.end("ok"); return; }
  if (req.method === "POST" && u.pathname === "/ai/draft") {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => { handleAiDraft(req, res, body); });
    return;
  }
  if (req.method === "POST" && u.pathname === "/ai/venue-pulse") {
    // The collective's pulse on a venue: Gemini distills the comment thread.
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", async () => {
      const hdr = corsHeaders(req);
      try {
        if (!GEMINI_KEY) { res.writeHead(503, hdr); res.end(JSON.stringify({ summary: null })); return; }
        const uid = await verifyUser(req);
        if (!uid) { res.writeHead(401, hdr); res.end(JSON.stringify({ error: "Not signed in" })); return; }
        const vid = ((JSON.parse(body || "{}").venue_id) || "").replace(/[^a-zA-Z0-9-]/g, "");
        const comments = await sGet(`venue_comments?venue_id=eq.${vid}&order=created_at.desc&limit=20&select=author_name,body`);
        if (comments.length < 2) { res.writeHead(200, hdr); res.end(JSON.stringify({ summary: null })); return; }
        const cached = pulseCache.get(vid);
        if (cached && cached.count === comments.length && Date.now() - cached.ts < 6 * 3600000) {
          res.writeHead(200, hdr); res.end(JSON.stringify({ summary: cached.summary })); return;
        }
        const text = comments.map((c) => `${c.author_name}: ${c.body}`).join("\n");
        const summary = await gemini(
          `Working musicians shared experiences about playing one venue:\n${text.slice(0, 3000)}\n\n` +
          `Distill the collective's take in <=50 words — concrete and useful (pay, crowd, staff, logistics, gotchas). Plain text, neutral tone.`, false);
        pulseCache.set(vid, { summary: (summary || "").slice(0, 400), count: comments.length, ts: Date.now() });
        res.writeHead(200, hdr); res.end(JSON.stringify({ summary: (summary || "").slice(0, 400) }));
      } catch (err) { res.writeHead(500, hdr); res.end(JSON.stringify({ summary: null })); }
    });
    return;
  }
  if (req.method === "GET" && u.pathname === "/push/pubkey") {
    res.writeHead(200, corsHeaders(req));
    res.end(JSON.stringify({ key: VAPID_PUB || "" }));
    return;
  }
  if (req.method === "POST" && (u.pathname === "/poke" || u.pathname === "/scheduled/run")) {
    // App poke — run the due queue + this artist's calendar sync immediately
    // ("send now" in seconds; gig dates land on Google Calendar websocket-fast).
    (async () => {
      const hdr = corsHeaders(req);
      const uid = await verifyUser(req);
      if (!uid) { res.writeHead(401, hdr); res.end(JSON.stringify({ error: "Not signed in" })); return; }
      res.writeHead(202, hdr); res.end(JSON.stringify({ ok: true }));
      try {
        await processScheduled();
        const conns = await sGet(`google_connections?artist_id=eq.${uid}&select=refresh_token`);
        if (conns.length) {
          const token = await refreshAccessToken(conns[0].refresh_token);
          await syncCalendar(uid, token);
        }
      } catch (e) { console.error("poke", e.message); }
    })();
    return;
  }
  if (req.method === "POST" && u.pathname === "/gmail/push") {
    if (PUSH_TOKEN && u.searchParams.get("token") !== PUSH_TOKEN) { res.writeHead(403); res.end("forbidden"); return; }
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      res.writeHead(204); res.end(); // ack fast; process async (poll is the safety net)
      try {
        const env = JSON.parse(body || "{}");
        const data = env.message && env.message.data;
        if (!data) return;
        const decoded = JSON.parse(Buffer.from(data, "base64").toString());
        if (decoded.emailAddress) handlePush(decoded.emailAddress, decoded.historyId).catch((e) => console.error("push error", e.message));
      } catch (e) { console.error("push parse error", e.message); }
    });
    return;
  }
  res.writeHead(404); res.end("not found");
}).listen(PORT, () => console.log("Gig worker HTTP on :" + PORT));

console.log("Gig worker up. Poll fallback every", INTERVAL / 60000, "min");
ensureVapid().catch((e) => console.error("vapid", e.message)).finally(() => { tick(); });
setInterval(tick, INTERVAL);
