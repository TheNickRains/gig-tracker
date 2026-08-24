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
const PLACES_KEY = (process.env.PLACES_API_KEY || "").trim();
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
// A message is "real mail" only when it isn't a draft, spam, or trash. Gmail
// search AND history include drafts, and every autosave is its OWN message id —
// without this guard, composing a pitch ingests as 3-4 phantom "sent" copies
// (each a snapshot of the draft mid-typing) that message-id dedup can't catch.
function isRealMail(full) {
  const l = full.labelIds || [];
  return !l.includes("DRAFT") && !l.includes("SPAM") && !l.includes("TRASH");
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
// Drafts speak one markdown-ism: [text](url) becomes a real link in the HTML
// part; the plain-text part degrades it to "text (url)". Bare URLs get
// linkified too — Gmail renders text/html verbatim and won't do it for us.
const MD_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
function mdToPlain(t) { return (t || "").replace(MD_LINK, "$1 ($2)"); }
function mdToHtml(t) {
  const linkify = (s) => escHtml(s).replace(/https?:\/\/[^\s<]+/g, (u) => {
    const clean = u.replace(/[.,;:!?]+$/, ""); // sentence punctuation isn't part of the URL
    return '<a href="' + clean + '">' + clean + "</a>" + u.slice(clean.length);
  });
  const parts = [];
  let last = 0, m;
  MD_LINK.lastIndex = 0;
  while ((m = MD_LINK.exec(t || ""))) {
    parts.push(linkify(t.slice(last, m.index)));
    parts.push('<a href="' + escHtml(m[2]) + '">' + escHtml(m[1]) + "</a>");
    last = m.index + m[0].length;
  }
  parts.push(linkify((t || "").slice(last)));
  return parts.join("").replace(/\r?\n/g, "<br>");
}
async function gmailSend(token, to, subject, body, thread, sig) {
  let headers = `To: ${to}\r\nSubject: ${mimeWord(subject)}\r\nMIME-Version: 1.0\r\n`;
  if (thread && thread.msgId) headers += `In-Reply-To: ${thread.msgId}\r\nReferences: ${thread.msgId}\r\n`;
  // Always multipart/alternative (even without a signature) so [text](url)
  // links render everywhere; plain-text readers get the degraded body.
  const hasSig = sig && (sig.logo || sig.name);
  const sigText = hasSig ? "\n\n--\n" + [sig.name, sig.phone, sig.site].filter(Boolean).join(" · ") : "";
  const sigHtml = hasSig
    ? '<br><br><div style="border-top:1px solid #ddd;padding-top:12px;margin-top:4px">'
      + (sig.logo ? '<img src="' + sig.logo + '" width="120" alt="' + escHtml(sig.name || "") + '" style="display:block;margin-bottom:8px"><br>' : "")
      + '<strong style="font:14px -apple-system,Segoe UI,Helvetica,Arial,sans-serif">' + escHtml(sig.name || "") + "</strong>"
      + '<div style="font:12px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#666">'
      + [sig.phone, sig.site].filter(Boolean).map(escHtml).join(" · ") + "</div></div>"
    : "";
  // literal <br> tags, not white-space CSS — several clients (Spark, Outlook) strip it
  const htmlBody = '<div style="font:14px/1.55 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#222">' + mdToHtml(body) + "</div>" + sigHtml;
  const bnd = "gigc_" + Date.now().toString(36);
  headers += `Content-Type: multipart/alternative; boundary="${bnd}"\r\n`;
  const raw =
    headers + "\r\n" +
    `--${bnd}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n` + mdToPlain(body) + sigText + `\r\n` +
    `--${bnd}\r\nContent-Type: text/html; charset="UTF-8"\r\n\r\n` + htmlBody + `\r\n--${bnd}--`;
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

// Unmatched inbound -> triage row on the war room (skip robots + self).
async function recordUnmatched(artistId, selfEmail, full) {
  if (!isRealMail(full)) return;
  const from = header(full, "From") || "";
  const fromEmail = ((from.match(/[\w.+-]+@[\w.-]+/) || [""])[0]).toLowerCase();
  if (!fromEmail) return;
  if (fromEmail === (selfEmail || "").toLowerCase()) return;
  if (/mailer-daemon|postmaster|no-?reply|notifications?@|calendar-notification|@google\.com$|@docs\./.test(fromEmail)) return;
  const text = cleanSnippet(extractPlainText(full.payload)) || cleanSnippet(full.snippet) || "";
  const row = {
    artist_id: artistId, gmail_id: full.id, thread_id: full.threadId || null,
    from_email: fromEmail,
    from_name: (from.replace(/<[^>]*>/, "").replace(/"/g, "").trim() || fromEmail),
    subject: (header(full, "Subject") || "(no subject)").slice(0, 200),
    body: text.slice(0, 1200),
  };
  if (full.internalDate) row.created_at = new Date(Number(full.internalDate)).toISOString();
  const r = await fetch(`${SUPA}/rest/v1/unmatched_mail`, { method: "POST", headers: { ...sHeaders, Prefer: "return=minimal" }, body: JSON.stringify(row) });
  if (r.ok) {
    console.log("unmatched parked:", fromEmail, row.subject.slice(0, 40));
    // Speed to lead: push for a brand-new lead too — but only genuinely fresh
    // arrivals, never the 2-day poll backfill (which would storm old mail). A
    // unique gmail_id means r.ok ⇒ this row is new, so we won't double-notify.
    const ageMs = full.internalDate ? Date.now() - Number(full.internalDate) : Infinity;
    if (ageMs < 15 * 60 * 1000) {
      notify(artistId, "New lead — " + row.from_name + " emailed", row.subject, "/app").catch(() => {});
    }
  }
}

// Quiet backfill: pull the FULL Gmail history with a deal's contact into the
// conversation (both directions, real dates, deduped). No notifications, no
// stage moves — this is archaeology, not news.
async function ingestContactHistory(artistId, token, entryId) {
  const rows = await sGet(`pipeline_entries?id=eq.${entryId}&artist_id=eq.${artistId}&select=id,last_activity_at,person:people!pipeline_entries_person_id_fkey(email),contact:contacts(email)`);
  if (!rows.length) return { added: 0, error: "deal not found" };
  const entry = rows[0];
  const email = (entry.person && entry.person.email) || (entry.contact && entry.contact.email);
  if (!email) return { added: 0, error: "no email on contact" };
  const msgs = await gmailSearch(token, `(from:${email} OR to:${email})`);
  let added = 0, newest = null;
  for (const m of msgs.slice(0, 25)) {
    const full = await gmailGet(token, m.id);
    if (!full || !isRealMail(full)) continue;
    const from = (header(full, "From") || "").toLowerCase();
    if (/mailer-daemon|postmaster/.test(from)) continue;
    const inbound = from.includes(email.toLowerCase());
    const text = cleanSnippet(extractPlainText(full.payload)) || cleanSnippet(full.snippet) || ("" + (header(full, "Subject") || ""));
    const row = { pipeline_entry_id: entry.id, kind: inbound ? "email_in" : "email_out", body: text.slice(0, 1200), source: "email_sync", email_message_id: full.id };
    if (full.internalDate) {
      row.created_at = new Date(Number(full.internalDate)).toISOString();
      if (!newest || row.created_at > newest) newest = row.created_at;
    }
    const isNew = await logActivity(row);
    if (isNew) added++;
  }
  if (newest && (!entry.last_activity_at || newest > entry.last_activity_at)) {
    await sPatch(`pipeline_entries?id=eq.${entry.id}`, { last_activity_at: newest });
  }
  // Purge phantom rows from past ingests: draft autosaves that were logged as
  // sent mail. Gmail deletes an autosave's message id when the draft changes or
  // sends, so a hard 404 (or a lingering DRAFT label) proves the row was never
  // real mail. Only email_sync rows with a message id are candidates — manual
  // notes and system markers are untouchable.
  let removed = 0;
  const logged = await sGet(`activities?pipeline_entry_id=eq.${entry.id}&source=eq.email_sync&kind=in.(email_in,email_out)&email_message_id=not.is.null&select=id,email_message_id&limit=100`);
  const liveIds = new Set(msgs.map((m) => m.id));
  for (const a of logged) {
    if (liveIds.has(a.email_message_id)) continue;
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${a.email_message_id}?format=minimal`, { headers: { Authorization: "Bearer " + token } });
    if (r.status === 404) { await sDelete(`activities?id=eq.${a.id}`); removed++; continue; }
    if (r.ok && !isRealMail(await r.json())) { await sDelete(`activities?id=eq.${a.id}`); removed++; }
  }
  console.log("history ingest:", email, "added", added, "of", msgs.length, removed ? `— purged ${removed} phantom draft(s)` : "");
  return { added, removed };
}

// Shared: given a pipeline entry + a Gmail message, log it and advance the stage.
async function applyMessage(entry, full, contactEmail, artistId) {
  if (!isRealMail(full)) return; // draft autosaves masquerade as sent mail
  const from = (header(full, "From") || "").toLowerCase();
  const subject = header(full, "Subject") || "(no subject)";
  const inbound = from.includes(contactEmail.toLowerCase());
  if (inbound) {
    const fullText = cleanSnippet(extractPlainText(full.payload));
    const snippet = cleanSnippet(full.snippet);
    const body = (fullText || snippet) ? (fullText || snippet).slice(0, 1200) : "Reply: " + subject;
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
    const outFull = cleanSnippet(extractPlainText(full.payload));
    const outSnippet = cleanSnippet(full.snippet);
    const outBody = (outFull || outSnippet) ? (outFull || outSnippet).slice(0, 1200) : "Sent: " + subject;
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
  // PEOPLE-first: the deal's person, then everyone linked to the deal's room.
  // Most-recently-active deal wins when one human (a buyer) spans several.
  const entries = await sGet(`pipeline_entries?artist_id=eq.${artistId}&order=last_activity_at.desc&select=id,status,venue_id,last_activity_at,person:people(email),contact:contacts(email)`);
  const map = {};
  const byVenue = {};
  entries.forEach((e) => {
    if (e.venue_id && !byVenue[e.venue_id]) byVenue[e.venue_id] = e;
    const em = (e.person && e.person.email) || (e.contact && e.contact.email);
    if (em && !map[em.toLowerCase()]) map[em.toLowerCase()] = e;
  });
  const venueIds = [...new Set(entries.map((e) => e.venue_id).filter(Boolean))];
  if (venueIds.length) {
    const links = await sGet(`venue_people?venue_id=in.(${venueIds.join(",")})&select=venue_id,person:people(email)`);
    links.forEach((l) => {
      const em = l.person && l.person.email;
      if (em && byVenue[l.venue_id] && !map[em.toLowerCase()]) map[em.toLowerCase()] = byVenue[l.venue_id];
    });
    // legacy contacts still answer during transition
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
      console.log("push msg from", fromAddr, entry ? ("-> matched entry " + entry.id) : "-> unmatched, parking");
      if (entry) await applyMessage(entry, full, cemail, artistId);
      else if (!(blob.includes((emailAddress || "").toLowerCase()) && fromAddr.toLowerCase() === (emailAddress || "").toLowerCase())) await recordUnmatched(artistId, emailAddress, full).catch(() => {});
    }
    console.log("push: processed", ids.length, "new msg(s) for", emailAddress);
  }
  await sPatch(`google_connections?artist_id=eq.${artistId}`, { history_id: String(notifHistoryId) });
}

// POLL path (fallback): scan each connection's pipeline contacts for recent mail.
async function sweepBounces(artistId, token, map) {
  const msgs = await gmailSearch(token, "from:(mailer-daemon OR postmaster) newer_than:3d");
  for (const m of msgs) {
    const full = await gmailGet(token, m.id);
    if (!full) continue;
    const failed = (header(full, "X-Failed-Recipients") || "").toLowerCase();
    const text = (extractPlainText(full.payload) || full.snippet || "").toLowerCase();
    for (const [email, entry] of Object.entries(map)) {
      if (failed.includes(email) || text.includes(email)) {
        const isNew = await logActivity({ pipeline_entry_id: entry.id, kind: "system", body: "⚠️ Email bounced — " + email + " doesn’t exist. Fix the contact’s address and re-send.", source: "email_sync", email_message_id: full.id });
        if (isNew) {
          await sPatch(`pipeline_entries?id=eq.${entry.id}`, { last_activity_at: new Date().toISOString() });
          notify(artistId, "Email bounced ⚠️", email + " doesn’t exist — fix the address", "/app#entry/" + entry.id).catch(() => {});
          console.log("bounce flagged", entry.id, email);
        }
        break;
      }
    }
  }
}

async function pollArtist(artistId, token) {
  const map = await venueContactMap(artistId);
  try { await sweepBounces(artistId, token, map); } catch (e) { console.error("bounce sweep", e.message); }
  // backfill: recent unmatched inbox mail (push may have skipped before this shipped)
  try {
    const selfRows = await sGet(`artists?id=eq.${artistId}&select=email`);
    const selfEmail = (selfRows[0] && selfRows[0].email) || "";
    const inbox = await gmailSearch(token, "in:inbox newer_than:2d");
    for (const m of inbox.slice(0, 20)) {
      const full = await gmailGet(token, m.id);
      if (!full) continue;
      const fromAddr = (((header(full, "From") || "").match(/[\w.+-]+@[\w.-]+/) || [""])[0]).toLowerCase();
      if (!fromAddr || map[fromAddr]) continue;
      const seen = await sGet(`activities?email_message_id=eq.${full.id}&select=id&limit=1`);
      if (seen.length) continue;
      await recordUnmatched(artistId, selfEmail, full).catch(() => {});
    }
  } catch (e) { console.error("unmatched backfill", e.message); }
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
// ── Artist tone matrix ──────────────────────────────────
// One BASE voice card (voice is constant) + per-context CALIBRATIONS learned
// from everything the artist actually sends, categorized by message intent
// (cold / followup / reply) × room class (bar / restaurant / winery /
// listening / festival). Samples come from the deal activity log — real
// booking mail, never the landlord — with raw Gmail sent-mail only as a
// bootstrap fallback for brand-new accounts.
function roomClass(venueType, ticketType) {
  const t = (venueType || "").toLowerCase();
  if (/listening|theater|theatre|concert|performing|club/.test(t)) return "listening";
  if (/winery|vineyard|brewery|distillery/.test(t)) return "winery";
  if (/restaurant|hotel|coffee|cafe/.test(t)) return "restaurant";
  if (/festival/.test(t)) return "festival";
  if (/promoter|agency|agent/.test(t)) return "promoter";
  if (/corporate|private|wedding/.test(t)) return "private";
  if (/bar|pub|casino/.test(t)) return "bar";
  return ticketType === "hard" ? "listening" : "bar";
}
// What a pitch ARGUES depends on the buyer's economics: soft rooms sell food
// & drink, hard rooms sell tickets, and festivals/agencies/private buyers are
// their own animals. Hard-ticket arguments are noise to a bar and vice versa.
function pitchPlaybook(cls, ticket) {
  if (cls === "festival") return "PLAYBOOK — FESTIVAL: talent buyers program months ahead. Argue programming fit (genre, stage vibe, set length) and draw evidence across markets (relevant here even for a soft-ticket fest). Lead with the EPK. Respect their booking cycle — ask about the next open season, not next weekend.\n";
  if (cls === "promoter") return "PLAYBOOK — PROMOTER/AGENCY: they place artists across many rooms. Argue roster fit, reliability, and ready-to-send materials (EPK). Draw evidence helps regardless of ticket type. The ask: what rooms/dates they're currently buying for.\n";
  if (cls === "private") return "PLAYBOOK — PRIVATE/CORPORATE: argue versatility (repertoire breadth, formats), self-sufficiency (own PA if true), and professionalism. Draw is IRRELEVANT — never mention it. These buyers expect to discuss budget; still follow the rate rule.\n";
  if (ticket === "hard") return "PLAYBOOK — HARD TICKET: the room sells tickets, so argue WHY THIS DATE SELLS: verified draw, audience fit with their calendar, the promo push you bring (list, socials). Bar-sales/vibe arguments are noise here — cut them.\n";
  return "PLAYBOOK — SOFT TICKET: the room sells food & drink, so argue what your set does for THEIR business: fits their clientele, keeps people seated and ordering, covers the hours (set-length stamina), zero-drama reliability. Ticket-sales and draw arguments are IRRELEVANT — never mention draw to a soft room.\n";
}
function cleanOutboundBody(body) {
  let b = (body || "").replace(/^Sent:\s*/, "").trim();
  if (/^[💬📞🤝📸📝✉️]/.test(b)) return null; // hand-logged one-liners aren't voice samples
  if (b.length < 60) return null;
  return b.slice(0, 600);
}
async function refreshToneProfile(artistId, token, force) {
  if (!GEMINI_KEY) return;
  const arts = await sGet(`artists?id=eq.${artistId}&select=tone_updated_at`);
  if (!arts.length) return;
  const last = arts[0].tone_updated_at ? new Date(arts[0].tone_updated_at).getTime() : 0;
  // Material-aware, not clock-based: retrain whenever there's a send the model
  // hasn't learned from yet (checked every poll + on Gmail push), so the
  // assistant grows with every interaction. Zero Gemini spend when nothing new.
  if (!force) {
    const newest = await sGet(
      `activities?select=created_at,entry:pipeline_entries!inner(artist_id)` +
      `&entry.artist_id=eq.${artistId}&kind=eq.email_out&order=created_at.desc&limit=1`);
    const newestTs = newest.length ? new Date(newest[0].created_at).getTime() : 0;
    if (newestTs <= last) return; // nothing sent since the last retrain
  }

  // Everything the artist has sent, WITH deal context, categorized into cells.
  const acts = await sGet(
    `activities?select=kind,body,created_at,pipeline_entry_id,` +
    `entry:pipeline_entries!inner(artist_id,ticket_type,venue:venues!pipeline_entries_venue_id_fkey(venue_type,ticket_type))` +
    `&entry.artist_id=eq.${artistId}&kind=in.(email_in,email_out)&order=created_at.asc&limit=600`);
  const byEntry = {};
  for (const a of acts) (byEntry[a.pipeline_entry_id] = byEntry[a.pipeline_entry_id] || []).push(a);
  const cells = {}; // "intent|class" -> [bodies], newest last
  const flat = [];  // all cleaned outbound, newest last (blanket samples)
  for (const entryId of Object.keys(byEntry)) {
    const thread = byEntry[entryId];
    let sawOut = false, prevKind = null;
    for (const a of thread) {
      if (a.kind === "email_out") {
        const body = cleanOutboundBody(a.body);
        if (body) {
          const intent = !sawOut ? "cold" : prevKind === "email_in" ? "reply" : "followup";
          const ent = a.entry || {}, ven = ent.venue || {};
          const cls = roomClass(ven.venue_type, ent.ticket_type || ven.ticket_type);
          (cells[intent + "|" + cls] = cells[intent + "|" + cls] || []).push(body);
          flat.push(body);
        }
        sawOut = true;
      }
      prevKind = a.kind;
    }
  }
  let samples = flat.slice(-8).reverse();
  // Bootstrap: no logged sends yet — sample Gmail, but ONLY mail sent to known
  // booking contacts. A day-job inbox must never become the artist's "voice"
  // (real incident: tone cards full of "align on project goals, scope, and
  // timelines" from artists whose Gmail is their work email).
  if (samples.length < 2 && token) {
    const ppl = await sGet(`pipeline_entries?artist_id=eq.${artistId}&select=person:people(email),contact:contacts(email)&limit=200`);
    const addrs = [...new Set(ppl.flatMap((r) => [r.person && r.person.email, r.contact && r.contact.email]).filter(Boolean))].slice(0, 10);
    for (const addr of addrs) {
      if (samples.length >= 8) break;
      const msgs = await gmailSearch(token, `in:sent to:${addr}`);
      for (const m of (msgs || []).slice(0, 3)) {
        const full = await gmailGet(token, m.id);
        if (!full) continue;
        const text = cleanSnippet(extractPlainText(full.payload).trim());
        if (text.length > 60) samples.push(text.slice(0, 600));
        if (samples.length >= 8) break;
      }
    }
  }
  // Fewer than 2 booking samples: leave tone_profile alone and DON'T stamp
  // tone_updated_at — no card beats a wrong card, and the material-aware gate
  // will try again as soon as they actually send something.
  if (samples.length < 2) return;

  // The explicit loop: AI generation vs what the artist ACTUALLY sent.
  const pairs = await sGet(`scheduled_messages?artist_id=eq.${artistId}&status=eq.sent&ai_draft=not.is.null&order=sent_at.desc&limit=8&select=ai_draft,body`);
  const diffSection = pairs.length
    ? `\n\nEDIT PAIRS — the AI suggested the first version; the artist edited it into the second before sending. LEARN THE EDITS (what they cut, add, reword — that delta IS their taste):\n` +
      pairs.map((pr, i) => `--- PAIR ${i + 1} ---\nAI SUGGESTED:\n${(pr.ai_draft || "").slice(0, 500)}\nARTIST SENT:\n${(pr.body || "").slice(0, 500)}`).join("\n\n")
    : "";
  try {
    const card = await gemini(
      `These are real booking emails a working musician sent (their authentic voice — including how they edit AI suggestions before sending):\n\n` +
      samples.map((s, i) => `--- EMAIL ${i + 1} ---\n${s}`).join("\n\n") +
      diffSection +
      `\n\nDistill a TONE CARD (max 180 words) a ghostwriter would use to write indistinguishably as this person: greeting + sign-off style, sentence rhythm/length, formality, warmth, characteristic phrases (quote 3-5 verbatim), what they never do — and, if edit pairs are present, the specific things they change about AI drafts. Plain text.`, false);
    if (!card) return;
    // Per-cell calibrations: only cells with real evidence (≥3 samples), one
    // JSON call for all of them. Notes are deltas FROM the base card, not
    // standalone voices — small, composable, honest about sample size.
    let matrix = null;
    const richCells = Object.keys(cells).filter((k) => cells[k].length >= 3);
    if (richCells.length) {
      const groups = richCells.map((k) =>
        `GROUP ${k} (${k.split("|")[0]} message to a ${k.split("|")[1]}-type room, ${cells[k].length} samples):\n` +
        cells[k].slice(-5).map((b, i) => `--- ${i + 1} ---\n${b.slice(0, 400)}`).join("\n")).join("\n\n");
      try {
        const raw = await gemini(
          `BASE VOICE CARD for a working musician:\n${card}\n\n` +
          `Below are their real sent messages grouped by context (intent × room type). For EACH group, write a calibration note (max 50 words): how their writing in THIS context differs from the base voice — length, formality, what they lead with, what they skip.\n\n` +
          groups +
          `\n\nOutput STRICT JSON: an object whose keys are exactly [${richCells.map((k) => `"${k}"`).join(", ")}] and whose values are the calibration strings.`, true);
        const parsed = JSON.parse(raw);
        matrix = { cells: {}, counts: {}, at: new Date().toISOString() };
        for (const k of richCells) {
          if (typeof parsed[k] === "string" && parsed[k].trim()) {
            matrix.cells[k] = parsed[k].trim().slice(0, 500);
            matrix.counts[k] = cells[k].length;
          }
        }
      } catch (e) { console.error("tone matrix", artistId, e.message); }
    }
    const patch = { tone_profile: card.slice(0, 2000), tone_updated_at: new Date().toISOString() };
    if (matrix && Object.keys(matrix.cells).length) patch.tone_matrix = matrix;
    await sPatch(`artists?id=eq.${artistId}`, patch);
    console.log("tone refreshed", artistId, "—", samples.length, "samples,", matrix ? Object.keys(matrix.cells).length : 0, "matrix cells");
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
    const entries = await sGet(`pipeline_entries?artist_id=eq.${artistId}&status=in.(hold,booked,played)&or=(gig_date.not.is.null,google_event_id.not.is.null)&select=id,status,gig_date,google_event_id,gig_date_dirty,gig_pay,gig_costs,venue:venues!pipeline_entries_venue_id_fkey(name)`);
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
        // No review gate: every scheduled message is human intention — it fires.
        // (allow_auto_send is reserved for future agent-initiated mail.)
      }
      const conns = await sGet(`google_connections?artist_id=eq.${m.artist_id}&select=refresh_token`);
      if (!conns.length) {
        await sPatch(`scheduled_messages?id=eq.${m.id}`, { status: "failed", cancel_reason: "Gmail not connected" });
        continue;
      }
      const token = await refreshAccessToken(conns[0].refresh_token);
      const thread = await findThread(token, m.to_email).catch(() => null);
      const sigRows = await sGet(`artists?id=eq.${m.artist_id}&select=display_name,phone,website,sig_logo_url,sig_enabled,sig_show_website,sig_show_phone`);
      const sa = sigRows[0] || {};
      // Artist-controlled signature: master toggle kills it entirely; the
      // website/phone toggles trim it. Columns default true (migration 034).
      const sig = sa.sig_enabled === false ? null : {
        name: sa.display_name,
        phone: sa.sig_show_phone === false ? "" : sa.phone,
        site: sa.sig_show_website === false ? "" : sa.website,
        logo: sa.sig_logo_url,
      };
      const gid = await gmailSend(token, m.to_email, (thread && thread.subject) || m.subject, m.body, thread, sig);
      await sPatch(`scheduled_messages?id=eq.${m.id}`, { status: "sent", sent_at: new Date().toISOString() });
      await logActivity({ pipeline_entry_id: m.pipeline_entry_id, kind: "email_out", body: m.body.slice(0, 600), source: "email_sync", email_message_id: gid });
      const entries = await sGet(`pipeline_entries?id=eq.${m.pipeline_entry_id}&select=status`);
      const patch = { last_activity_at: new Date().toISOString() };
      if (entries.length && ["lead", "outreach"].includes(entries[0].status)) patch.status = "pitched";
      await sPatch(`pipeline_entries?id=eq.${m.pipeline_entry_id}`, patch);
      notify(m.artist_id, "Sent ✓ " + m.to_email.split("@")[0], m.subject, "/app#entry/" + m.pipeline_entry_id).catch(() => {});
      console.log("scheduled: SENT", m.id, "->", m.to_email);
      // Incremental learning: this send carries a generation->sent diff — retrain now.
      if (m.ai_draft) refreshToneProfile(m.artist_id, token, true).then(() => console.log("tone: incremental retrain after diff-send")).catch(() => {});
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

// ── Intake link readers ─────────────────────────────────
// Spotify: full artist object (genres!) when client credentials are configured;
// otherwise the public page's meta tags still carry name + monthly listeners.
async function spotifyArtistInfo(url) {
  try {
    const m = (url || "").match(/artist\/([a-zA-Z0-9]+)/);
    if (!m) return null;
    const cid = process.env.SPOTIFY_CLIENT_ID, csec = process.env.SPOTIFY_CLIENT_SECRET;
    if (cid && csec) {
      const tok = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(cid + ":" + csec).toString("base64") },
        body: "grant_type=client_credentials",
      }).then((r) => r.json());
      if (tok.access_token) {
        const a = await fetch(`https://api.spotify.com/v1/artists/${m[1]}`, { headers: { Authorization: "Bearer " + tok.access_token } }).then((r) => r.json());
        if (a && a.name) return `SPOTIFY: ${a.name} — genres: ${(a.genres || []).join(", ") || "none listed"}; followers: ${(a.followers || {}).total || "?"}; popularity ${a.popularity || "?"}/100.`;
      }
    }
    const html = await fetch(`https://open.spotify.com/artist/${m[1]}`, { headers: { "User-Agent": "Mozilla/5.0" } }).then((r) => r.text());
    const og = (html.match(/<meta property="og:description" content="([^"]*)"/) || [])[1] || "";
    const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
    return (title || og) ? ("SPOTIFY PAGE: " + (title + " — " + og).slice(0, 400)) : null;
  } catch (e) { return null; }
}
async function fetchSiteText(url) {
  try {
    if (!url) return null;
    const full = /^https?:\/\//i.test(url) ? url : "https://" + url;
    const html = await fetch(full, { headers: { "User-Agent": "Mozilla/5.0" }, redirect: "follow" }).then((r) => r.text());
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z#0-9]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.length > 100 ? text.slice(0, 6000) : null;
  } catch (e) { return null; }
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
    const dmChannel = parsed.channel === "dm"; // Instagram DM: short, casual, copy-paste flow
    const enhance = parsed.mode === "enhance" && parsed.template_text;
    const templateKind = String(parsed.template_kind || "").slice(0, 20);
    const templateText = String(parsed.template_text || "").slice(0, 2000);
    if (!entryId) { res.writeHead(400, hdr); res.end(JSON.stringify({ error: "entry_id required" })); return; }
    const entries = await sGet(`pipeline_entries?id=eq.${entryId}&select=id,status,artist_id,gig_date,gig_pay,gig_costs,ticket_type,person_id,venue:venues!pipeline_entries_venue_id_fkey(name,city,state,venue_type,ticket_type,pay_range,clientele,notes,booking_form_url),person:people(name,title,org),contact:contacts(name,title)`);
    if (!entries.length || entries[0].artist_id !== uid) { res.writeHead(404, hdr); res.end(JSON.stringify({ error: "Entry not found" })); return; }
    const e = entries[0], v = e.venue || {}, c = e.person || e.contact || {};
    let otherRooms = "";
    if (e.person_id) {
      const links = await sGet(`venue_people?person_id=eq.${e.person_id}&select=venue:venues(name)&limit=5`);
      const names = links.map((l) => l.venue && l.venue.name).filter((n) => n && n !== v.name);
      if (names.length) otherRooms = " — also books " + names.join(", ");
    }
    const arts = await sGet(`artists?id=eq.${uid}&select=display_name,genre,oneliner,website,epk,spotify,draw_claim,typical_crowd,set_formats,notable,markets,phone,tone_profile,tone_matrix,rate_soft,rate_hard,home_market`);
    const a = arts[0] || {};
    const dealPay = (e.gig_pay || "").trim();
    const dealCosts = (e.gig_costs || "").trim();
    const ticket = e.ticket_type || v.ticket_type || "soft";
    // Rates GROUND the AI — they exist so it never invents or misquotes a
    // number, NOT so it volunteers one. Naming a rate in a pitch kills sales;
    // the artist's rule: never lead with money. Precedence when a number IS
    // called for: deal's own pay > a number in MY NOTE > standing rate.
    const rateWhen = `WHEN to name a number — ONLY if (a) their last message asks about price/rate/money, or (b) the deal is at hold/booked and you are confirming already-agreed terms. NEVER volunteer a rate in a pitch, intro, or follow-up — money talk unprompted kills the sale. If they ask and you have no grounded number, defer ("happy to talk numbers").\n`;
    const rateLine = dealPay
      ? rateWhen + `GROUNDED RATE for this deal (the artist set this exact number for this show — when a number is called for per the rule above, quote it VERBATIM; never round, multiply, discount, or swap in a generic rate): ${dealPay}${dealCosts ? ` · costs/notes: ${dealCosts}` : ""}.${(a.rate_soft || a.rate_hard) ? ` (Standing rates are reference only and must NOT override it: soft ${a.rate_soft || "—"} · hard ${a.rate_hard || "—"}.)` : ""}\n`
      : (a.rate_soft || a.rate_hard)
        ? rateWhen + `GROUNDED RATES (standing) — when a number is called for per the rule above, quote the one matching THIS deal's ${ticket} ticket EXACTLY (never invent, round, discount, or underbid): soft ticket ${a.rate_soft || "not set"} · hard ticket ${a.rate_hard || "not set"}. If MY NOTE on this deal names a specific number, THAT is authoritative — quote it instead.\n`
        : `RATES: not set — do NOT name any number under any circumstances; if they ask, defer ("happy to talk numbers").\n`;
    const acts = await sGet(`activities?pipeline_entry_id=eq.${entryId}&kind=in.(email_in,email_out,note)&order=created_at.desc&limit=8&select=kind,body`);
    const lastInbound = (acts.find((x) => x.kind === "email_in") || {}).body || "";
    const convo = acts.slice().reverse().map((x) => (x.kind === "email_in" ? "THEM: " : x.kind === "email_out" ? "ME: " : "MY NOTE: ") + x.body).join("\n");
    // The objective is DERIVED FROM EVIDENCE — conversation state, notes, stage,
    // dates — never assumed. Cold intro only when there is zero prior exchange.
    const hasOutbound = acts.some((x) => x.kind === "email_out");
    // Channel detection: contact without email whose thread is hand-logged
    // texts/calls => the draft must BE a text message, not an email.
    const persons = e.person_id ? await sGet(`people?id=eq.${e.person_id}&select=email,phone`) : [];
    const hasEmail = !!(persons[0] && persons[0].email);
    const textish = acts.filter((x) => /^[💬📞🤝📸]/.test(x.body || "")).length;
    const isTextThread = !hasEmail || (textish > 0 && textish >= acts.filter((x) => x.kind !== "note").length / 2);
    // rooms in play (multi-room opportunity)
    const dvs = await sGet(`deal_venues?entry_id=eq.${entryId}&select=venue:venues(name)`);
    const roomsInPlay = dvs.map((x) => x.venue && x.venue.name).filter(Boolean);
    if (enhance) {
      // ENHANCE: keep the template's purpose and shape; make it specific with
      // the full context (conversation, notes, venue, stage, person, rates).
      var enhanceObjective = "OBJECTIVE: ENHANCE the artist's chosen \"" + templateKind + "\" template (provided below). Keep its purpose and rough structure, but personalize it deeply with the context: this venue, this contact, the conversation so far, the deal stage, the artist's profile and rates. Cut anything generic. Do not change what KIND of message it is.\nTEMPLATE TO ENHANCE:\n\"\"\"" + templateText + "\"\"\"";
    }
    const gigWhen = e.gig_date ? new Date(e.gig_date).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;
    const firstTouch = !hasOutbound && !lastInbound;
    let objective;
    if (e.status === "hold" || e.status === "booked") objective = "OBJECTIVE: the deal is at " + e.status + (gigWhen ? " for " + gigWhen : "") + ". Confirm/advance the date and logistics (load-in, set length, rate as agreed). No self-promotion — they already want the artist.";
    else if (lastInbound) objective = "OBJECTIVE: live conversation — their message is the latest word. Reply DIRECTLY to it: answer every question they asked, propose or lock concrete specifics (dates, times, rate, logistics), move the booking one step closer. Do NOT re-introduce the artist, do NOT add credentials or sales language — they already know who they're talking to.";
    else if (hasOutbound) objective = "OBJECTIVE: they haven't replied to the earlier message(s) below. Write a brief, warm follow-up that adds ONE new angle or ask (a specific date works well) without repeating the original pitch. 2-4 sentences. Never re-introduce from scratch.";
    else if (e.status === "played") objective = "OBJECTIVE: friendly check-in with a room the artist already played — reference the relationship, float availability for another date. Light, no hard sell.";
    else if (v.booking_form_url) objective = "OBJECTIVE: this venue books via a WEB FORM. Write copy ready to paste into their booking form: who the artist is, why they fit this room, draw, one listen link. Skip the salutation and sign-off if it reads more natural for a form; keep the phone/site so they can respond.";
    else objective = "OBJECTIVE: first-touch cold outreach — concise intro, why the artist fits THIS room specifically (use the venue notes/clientele), one listen link, clear ask: are they the right person / can we get a date.";
    const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    const draftCls = roomClass(v.venue_type, ticket);
    const playbook = ["hold", "booked", "played"].includes(e.status) ? "" : pitchPlaybook(draftCls, ticket);
    const draft = await gemini(
      `TODAY IS ${today}. Never propose dates in the past; prefer concrete dates at least 5 days out (e.g. "Friday June 20"), and resolve phrases like "this weekend" against today.\n\n` +
      (dmChannel
        ? `CHANNEL: INSTAGRAM DM. Write 1-3 short sentences, UNDER 500 CHARACTERS total — casual but professional, like one music person DMing another. No greeting line, NO sign-off of any kind (the artist's profile carries identity), no "email" vocabulary, no formatting or placeholders. Links only if essential, as a bare URL (never [text](url) syntax). Warm, confident, zero sales-blast smell — a bot-sounding DM burns the artist with exactly the bookers who live in DMs.\n\n`
        : isTextThread
        ? `CHANNEL: TEXT MESSAGE (SMS). This thread lives in texts — NOT email. Write 1-3 short sentences, casual and direct: no greeting line, NO sign-off of any kind (no name, no phone — texts from the artist's own phone carry identity), no "email" vocabulary, links only if essential (and then as a bare URL, never [text](url) syntax). It should read like a text from a friend who's also a pro.\n\n`
        : `CHANNEL: EMAIL. Plain text only — no subject line, no formatting, no placeholders, under 160 words, direct and human (never marketing copy). ONE exception: a hyperlink may be written as [text](https://url) — it renders as clickable words, e.g. "[hear the live set](URL)" — use it for the listen/EPK link when one fits naturally, instead of pasting a raw URL. Do NOT add a signature, name, or phone number at the end — the artist's branded signature is appended automatically on send. End with the ask, or at most a short "Thanks," line.\n\n`) +
      (enhance ? enhanceObjective : objective) + "\n" + playbook + "\n" +
      `DEAL STAGE: ${e.status}${gigWhen ? " · TARGET DATE: " + gigWhen : ""}\n` +
      (lastInbound ? `THEIR LAST MESSAGE (answer this):\n"""${lastInbound.slice(0, 600)}"""\n` : "") +
      (convo ? `CONVERSATION SO FAR:\n${convo}\n` : "") +
      (roomsInPlay.length ? `ROOMS IN PLAY (one conversation, several of their rooms — speak to the set, push toward locking ONE): ${[v.name].concat(roomsInPlay).filter((x, i, arr) => x && arr.indexOf(x) === i).join(", ")}\n` : "") +
      `VENUE: ${v.name || ""} (${v.venue_type || ""}, ${e.ticket_type || v.ticket_type || "soft"} ticket — quote the matching rate) in ${v.city || ""}, ${v.state || ""}. ${v.clientele ? "Clientele: " + v.clientele + "." : ""} ${v.notes ? "My notes on this venue: " + v.notes : ""}\n` +
      `CONTACT: ${c.name || "the booker"}${c.title ? " (" + c.title + ")" : ""}${c.org ? " of " + c.org : ""}${otherRooms}\n` +
      rateLine +
      (firstTouch
        ? `ARTIST (use what's relevant — this is a first touch): ${a.display_name || ""} — ${a.genre || ""}. HOOK: ${a.oneliner || "n/a"}. Crowd: ${a.typical_crowd || "n/a"}. Formats: ${a.set_formats || "n/a"}. Notable rooms: ${a.notable || "n/a"}. Home market: ${a.home_market || "n/a"}. Site: ${a.website || ""} ${a.epk ? "EPK: " + a.epk : ""} ${a.spotify ? "Spotify: " + a.spotify : ""} Phone: ${a.phone || ""}\n` +
          `HOOK RULE: the message is written in FIRST PERSON as the artist — NEVER render the hook (or any profile praise) as first-person self-praise ("I have a voice that pulls people in" is cringe and gets deleted). Convert it to observable outcomes ("my sets tend to quiet the room"), attributed praise ("bookers keep telling me…"), or let the venue-fit argument carry it. If it can't be said naturally in first person, leave it out entirely.\n` +
          `DRAW (max tickets the artist has sold to ONE show — a verified fact, not a vibe): ${a.draw_claim || "unverified"}. Mention draw ONLY where the playbook says it matters (hard-ticket rooms, festivals, promoters — ${ticket === "hard" || ["festival", "promoter"].includes(draftCls) ? "which applies here" : "NOT this room: omit draw entirely"}), and ONLY if verified — "unverified" means say nothing about numbers, never say zero, never estimate.\n` +
          `LINK RULE: at most ONE link in the whole message. Hierarchy: EPK > website > Spotify/streaming > a social video. Label it as what it IS — "listen" is only honest for a streaming link; an EPK is called an EPK. Never offer two links: a booker given two options clicks neither.\n`
        : `ARTIST (background only — do NOT pitch credentials mid-conversation): ${a.display_name || ""}, ${a.genre || ""}. Phone: ${a.phone || ""}\n`) +
      (a.tone_profile ? `\nTONE CARD — write indistinguishably in THIS voice:\n${a.tone_profile}\n` : "") +
      (function () {
        // Tone matrix: this artist's learned calibration for THIS kind of
        // message to THIS kind of room, applied on top of the base voice.
        const intent = firstTouch ? "cold" : lastInbound ? "reply" : hasOutbound ? "followup" : "cold";
        const cls = roomClass(v.venue_type, e.ticket_type || v.ticket_type);
        const note = a.tone_matrix && a.tone_matrix.cells && a.tone_matrix.cells[intent + "|" + cls];
        return note ? `\nCONTEXT CALIBRATION — how this artist writes ${intent} messages to ${cls}-type rooms (apply on top of the tone card):\n${note}\n` : "";
      })() +
      `\nWrite only the ${dmChannel ? "DM text" : isTextThread ? "message text" : "email body"}.`, false);
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
  if (req.method === "POST" && u.pathname === "/places/search") {
    // Venue lookup: one search fills name/address/city/state (+phone/site).
    let body = "";
    req.on("data", (dd) => (body += dd));
    req.on("end", async () => {
      const hdr = corsHeaders(req);
      try {
        if (!PLACES_KEY) { res.writeHead(503, hdr); res.end(JSON.stringify({ error: "Place search isn’t configured yet (PLACES_API_KEY missing)" })); return; }
        const uid = await verifyUser(req);
        if (!uid) { res.writeHead(401, hdr); res.end(JSON.stringify({ error: "Not signed in" })); return; }
        const q = String(JSON.parse(body || "{}").q || "").slice(0, 120);
        if (q.length < 3) { res.writeHead(200, hdr); res.end(JSON.stringify({ results: [] })); return; }
        const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": PLACES_KEY,
            "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.addressComponents,places.nationalPhoneNumber,places.websiteUri",
          },
          body: JSON.stringify({ textQuery: q, maxResultCount: 5 }),
        });
        if (!r.ok) { const t = (await r.text()).slice(0, 200); console.error("places", r.status, t); res.writeHead(502, hdr); res.end(JSON.stringify({ error: "Place search failed (" + r.status + ")" })); return; }
        const j = await r.json();
        const results = (j.places || []).map((pl) => {
          const comps = pl.addressComponents || [];
          const get = (type, short) => { const cmpo = comps.find((cc) => (cc.types || []).includes(type)); return cmpo ? (short ? cmpo.shortText : cmpo.longText) : ""; };
          return {
            name: (pl.displayName && pl.displayName.text) || "",
            address: pl.formattedAddress || "",
            city: get("locality") || get("postal_town") || get("sublocality") || "",
            state: get("administrative_area_level_1", true) || "",
            phone: pl.nationalPhoneNumber || "",
            website: pl.websiteUri || "",
          };
        });
        res.writeHead(200, hdr); res.end(JSON.stringify({ results }));
      } catch (err) { res.writeHead(500, hdr); res.end(JSON.stringify({ error: err.message.slice(0, 120) })); }
    });
    return;
  }
  if (req.method === "GET" && u.pathname === "/push/pubkey") {
    res.writeHead(200, corsHeaders(req));
    res.end(JSON.stringify({ key: VAPID_PUB || "" }));
    return;
  }
  // ── Intake: derive the artist profile from their links; they only correct it.
  // Artists hate self-describing (genre especially) — so the AI reads Spotify /
  // site / EPK and proposes; the human edits. Never asks for marketing copy.
  if (req.method === "POST" && u.pathname === "/intake") {
    (async () => {
      const hdr = corsHeaders(req);
      const uid = await verifyUser(req);
      if (!uid) { res.writeHead(401, hdr); res.end(JSON.stringify({ error: "Not signed in" })); return; }
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", async () => {
        try {
          if (!GEMINI_KEY) { res.writeHead(503, hdr); res.end(JSON.stringify({ error: "AI isn’t configured yet" })); return; }
          const { spotify, website, epk } = JSON.parse(body || "{}");
          const sources = [];
          const sp = await spotifyArtistInfo(spotify);
          if (sp) sources.push(sp);
          for (const [label, url] of [["WEBSITE", website], ["EPK", epk]]) {
            const text = await fetchSiteText(url);
            if (text) sources.push(`${label} (${url}):\n${text}`);
          }
          if (!sources.length) { res.writeHead(400, hdr); res.end(JSON.stringify({ error: "Couldn’t read any of those links — check the URLs" })); return; }
          const raw = await gemini(
            `You are building a booking profile for a working musician from their own public materials. Sources:\n\n` +
            sources.join("\n\n---\n\n").slice(0, 12000) +
            `\n\nDistill STRICT JSON with exactly these keys:\n` +
            `"genre": how a venue booker would file them, max 4 plain words (e.g. "Americana / roots rock") — never a paragraph, never hedged;\n` +
            `"oneliner": ONE sentence a booker skims — the artist's HOOK. CRITICAL: it will be dropped into emails the artist writes about THEMSELVES, so it must survive first person without becoming self-praise. Write it as an observable effect on the room or a concrete fact — never a self-assessment. GOOD: "plays originals that quiet a room", "keeps a winery patio planted for three hours". BAD (cringe in first person, gets deleted): "has an unforgettable voice", "is a captivating performer". Concrete verbs, zero self-adjectives (ban: "unforgettable", "one-of-a-kind", "captivating");\n` +
            `"notable": their single best concrete brag — rooms played, press quote, streaming/draw numbers — or "" if the sources show none. Never invent.`, true);
          const parsed = JSON.parse(raw);
          res.writeHead(200, hdr);
          res.end(JSON.stringify({
            genre: String(parsed.genre || "").slice(0, 80),
            oneliner: String(parsed.oneliner || "").slice(0, 300),
            notable: String(parsed.notable || "").slice(0, 300),
            read: sources.length,
          }));
        } catch (e) { res.writeHead(500, hdr); res.end(JSON.stringify({ error: "Intake failed: " + e.message.slice(0, 120) })); }
      });
    })();
    return;
  }
  // Voice seed: a pasted booking email becomes a starter tone card — but only
  // when no learned card exists yet (never clobber real learning with a paste).
  if (req.method === "POST" && u.pathname === "/intake/tone") {
    (async () => {
      const hdr = corsHeaders(req);
      const uid = await verifyUser(req);
      if (!uid) { res.writeHead(401, hdr); res.end(JSON.stringify({ error: "Not signed in" })); return; }
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", async () => {
        try {
          if (!GEMINI_KEY) { res.writeHead(503, hdr); res.end(JSON.stringify({ error: "AI isn’t configured yet" })); return; }
          const { sample } = JSON.parse(body || "{}");
          const text = String(sample || "").trim();
          if (text.length < 80) { res.writeHead(400, hdr); res.end(JSON.stringify({ error: "Sample too short to learn from" })); return; }
          const arts = await sGet(`artists?id=eq.${uid}&select=tone_profile`);
          if (arts.length && arts[0].tone_profile) { res.writeHead(200, hdr); res.end(JSON.stringify({ ok: true, kept: "existing" })); return; }
          const card = await gemini(
            `This is a real booking email a working musician sent (their authentic voice):\n\n${text.slice(0, 2000)}\n\n` +
            `Distill a TONE CARD (max 120 words) a ghostwriter would use to write as this person: greeting + sign-off style, sentence rhythm, formality, warmth, characteristic phrases (quote 2-3 verbatim), what they never do. Plain text.`, false);
          if (card) await sPatch(`artists?id=eq.${uid}`, { tone_profile: card.slice(0, 2000), tone_updated_at: new Date().toISOString() });
          res.writeHead(200, hdr); res.end(JSON.stringify({ ok: true }));
        } catch (e) { res.writeHead(500, hdr); res.end(JSON.stringify({ error: e.message.slice(0, 120) })); }
      });
    })();
    return;
  }
  if (req.method === "POST" && u.pathname === "/thread/ingest") {
    (async () => {
      const hdr = corsHeaders(req);
      const uid = await verifyUser(req);
      if (!uid) { res.writeHead(401, hdr); res.end(JSON.stringify({ error: "Not signed in" })); return; }
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", async () => {
        try {
          const { entry_id } = JSON.parse(body || "{}");
          const conns = await sGet(`google_connections?artist_id=eq.${uid}&select=refresh_token`);
          if (!conns.length) { res.writeHead(400, hdr); res.end(JSON.stringify({ error: "Gmail not connected" })); return; }
          const token = await refreshAccessToken(conns[0].refresh_token);
          const out = await ingestContactHistory(uid, token, entry_id);
          res.writeHead(200, hdr); res.end(JSON.stringify(out));
        } catch (e) { res.writeHead(500, hdr); res.end(JSON.stringify({ error: e.message })); }
      });
    })();
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
      console.log("poke received from", uid.slice(0, 8));
      try {
        await processScheduled();
        const conns = await sGet(`google_connections?artist_id=eq.${uid}&select=refresh_token`);
        if (conns.length) {
          const token = await refreshAccessToken(conns[0].refresh_token);
          await syncCalendar(uid, token);
          await pollArtist(uid, token); // full sweep: replies, bounces, unmatched backfill
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
