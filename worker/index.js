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

const SUPA = (process.env.SUPABASE_URL || "").trim();
const SVC = (process.env.SUPABASE_SERVICE_KEY || "").trim();
const GCID = (process.env.GOOGLE_CLIENT_ID || "").trim();
const GCS = (process.env.GOOGLE_CLIENT_SECRET || "").trim();
const GMAIL_TOPIC = (process.env.GMAIL_TOPIC || "").trim();
const PUSH_TOKEN = (process.env.PUSH_TOKEN || "").trim();
const INTERVAL = (Number(process.env.POLL_MINUTES) || 10) * 60000;
const PORT = process.env.PORT || 8080;

if (!SUPA || !SVC || !GCID || !GCS) {
  console.error("Missing env: need SUPABASE_URL, SUPABASE_SERVICE_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET");
  process.exit(1);
}
function keyClaim(jwt, c) { try { return JSON.parse(Buffer.from(jwt.split(".")[1], "base64").toString())[c]; } catch (e) { return "?"; } }
console.log("Supabase key — role:", keyClaim(SVC, "role"), "ref:", keyClaim(SVC, "ref"), "| GMAIL_TOPIC:", GMAIL_TOPIC || "(none)");

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
    if (existing.length) return false;
  }
  const r = await fetch(`${SUPA}/rest/v1/activities`, {
    method: "POST", headers: { ...sHeaders, Prefer: "return=representation" }, body: JSON.stringify(row),
  });
  if (!r.ok) { console.error("activity insert failed", r.status, (await r.text()).slice(0, 200)); return false; }
  const j = await r.json().catch(() => []);
  return Array.isArray(j) && j.length > 0;
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
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`, { headers: { Authorization: "Bearer " + token } });
  return r.ok ? r.json() : null;
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

// Shared: given a pipeline entry + a Gmail message, log it and advance the stage.
async function applyMessage(entry, full, contactEmail) {
  const from = (header(full, "From") || "").toLowerCase();
  const subject = header(full, "Subject") || "(no subject)";
  const inbound = from.includes(contactEmail.toLowerCase());
  if (inbound) {
    const isNew = await logActivity({ pipeline_entry_id: entry.id, kind: "email_in", body: "Reply: " + subject, source: "email_sync", email_message_id: full.id });
    console.log("  inbound reply on entry", entry.id, "newly logged:", isNew);
    if (isNew) {
      const patch = { last_activity_at: new Date().toISOString() };
      if (entry.status === "outreach") patch.status = "waiting";
      await sPatch(`pipeline_entries?id=eq.${entry.id}`, patch);
    }
  } else {
    await logActivity({ pipeline_entry_id: entry.id, kind: "email_out", body: "Sent: " + subject, source: "email_sync", email_message_id: full.id });
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
    const entries = await sGet(`pipeline_entries?artist_id=eq.${artistId}&select=id,status,contact:contacts(email)`);
    const map = {};
    entries.forEach((e) => { if (e.contact && e.contact.email) map[e.contact.email.toLowerCase()] = e; });
    for (const id of ids) {
      const full = await gmailGet(token, id);
      if (!full) continue;
      const blob = ((header(full, "From") || "") + " " + (header(full, "To") || "")).toLowerCase();
      let entry = null, cemail = null;
      for (const em in map) { if (blob.includes(em)) { entry = map[em]; cemail = em; break; } }
      var fromAddr = ((header(full, "From") || "").match(/[\w.+-]+@[\w.-]+/) || ["?"])[0];
      console.log("push msg from", fromAddr, entry ? ("-> matched entry " + entry.id + " (status " + entry.status + ")") : ("-> NO MATCH; pipeline contacts=[" + Object.keys(map).join(", ") + "]"));
      if (entry) await applyMessage(entry, full, cemail);
    }
    console.log("push: processed", ids.length, "new msg(s) for", emailAddress);
  }
  await sPatch(`google_connections?artist_id=eq.${artistId}`, { history_id: String(notifHistoryId) });
}

// POLL path (fallback): scan each connection's pipeline contacts for recent mail.
async function pollArtist(artistId, token) {
  const entries = await sGet(`pipeline_entries?artist_id=eq.${artistId}&select=id,status,contact:contacts(email)`);
  for (const e of entries) {
    const email = e.contact && e.contact.email;
    if (!email) continue;
    const msgs = await gmailSearch(token, `(from:${email} OR to:${email}) newer_than:3d`);
    for (const m of msgs) {
      const full = await gmailGet(token, m.id);
      if (full) await applyMessage(e, full, email);
    }
  }
}

async function tick() {
  try {
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
        await pollArtist(c.artist_id, token);
      } catch (e) { console.error("artist error", c.artist_id, e.message); }
    }
  } catch (e) { console.error("tick error", e.message); }
}

// HTTP: health + the Pub/Sub push webhook.
http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (req.method === "GET" && u.pathname === "/") { res.writeHead(200); res.end("ok"); return; }
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
tick();
setInterval(tick, INTERVAL);
