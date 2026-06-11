// Gig Collective — backend worker (Slice A.2)
//
// On a timer, for every artist who connected Google: refresh their access token,
// read recent Gmail threads with the booking contacts in their pipeline, log new
// replies as activities, and advance the stage (outreach -> waiting on a reply).
// Rule-based for now; Gemini summaries/extraction come in slice C.
//
// Zero dependencies — Node 18+ global fetch. Runs as its own Railway service.
//
// Env (set in the worker service's Railway variables):
//   SUPABASE_URL           https://fjqfqykytqtwqbzyihqq.supabase.co
//   SUPABASE_SERVICE_KEY   service_role key (bypasses RLS — worker only)
//   GOOGLE_CLIENT_ID       OAuth client id (to refresh Google tokens)
//   GOOGLE_CLIENT_SECRET   OAuth client secret
//   POLL_MINUTES           optional, default 10

const SUPA = process.env.SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;
const GCID = process.env.GOOGLE_CLIENT_ID;
const GCS = process.env.GOOGLE_CLIENT_SECRET;
const INTERVAL = (Number(process.env.POLL_MINUTES) || 10) * 60000;

if (!SUPA || !SVC || !GCID || !GCS) {
  console.error("Missing env: need SUPABASE_URL, SUPABASE_SERVICE_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET");
  process.exit(1);
}

// Self-check: the SUPABASE_SERVICE_KEY must be the service_role key (not anon),
// or RLS hides the token rows and we silently read 0 connections.
function keyClaim(jwt, c) {
  try { return JSON.parse(Buffer.from(jwt.split(".")[1], "base64").toString())[c]; } catch (e) { return "?"; }
}
console.log("Supabase key — role:", keyClaim(SVC, "role"), "ref:", keyClaim(SVC, "ref"), "len:", (SVC || "").length,
  "(role must be 'service_role'; ref must be 'fjqfqykytqtwqbzyihqq')");

const sHeaders = { apikey: SVC, Authorization: "Bearer " + SVC, "Content-Type": "application/json" };

async function sGet(path) {
  const r = await fetch(`${SUPA}/rest/v1/${path}`, { headers: sHeaders });
  if (!r.ok) { console.error("Supabase GET failed", path.split("?")[0], r.status, (await r.text()).slice(0, 200)); return []; }
  return r.json();
}
async function sPatch(path, body) {
  await fetch(`${SUPA}/rest/v1/${path}`, { method: "PATCH", headers: { ...sHeaders, Prefer: "return=minimal" }, body: JSON.stringify(body) });
}
async function sDelete(path) {
  await fetch(`${SUPA}/rest/v1/${path}`, { method: "DELETE", headers: sHeaders });
}
// Insert an activity; the unique index on email_message_id dedupes across runs.
// Returns true if a NEW row was written (so we only advance the stage once).
async function logActivity(row) {
  const r = await fetch(`${SUPA}/rest/v1/activities?on_conflict=email_message_id`, {
    method: "POST",
    headers: { ...sHeaders, Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify(row),
  });
  const j = await r.json().catch(() => []);
  return Array.isArray(j) && j.length > 0;
}

async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({ client_id: GCID, client_secret: GCS, refresh_token: refreshToken, grant_type: "refresh_token" });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  if (!r.ok) throw new Error(`token ${r.status}: ${await r.text()}`);
  return (await r.json()).access_token;
}
async function gmailSearch(token, q) {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=20`, { headers: { Authorization: "Bearer " + token } });
  if (!r.ok) return [];
  return (await r.json()).messages || [];
}
async function gmailGet(token, id) {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`, { headers: { Authorization: "Bearer " + token } });
  return r.ok ? r.json() : null;
}
function header(msg, name) {
  const hs = (msg.payload && msg.payload.headers) || [];
  const h = hs.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : "";
}

async function syncArtist(conn) {
  let token;
  try {
    token = await refreshAccessToken(conn.refresh_token);
  } catch (e) {
    // Refresh token dead/expired (e.g. Testing-mode 7-day expiry) -> drop the
    // connection so the app shows "Connect" again and the artist re-grants.
    console.error("refresh failed", conn.artist_id, e.message);
    await sPatch(`artists?id=eq.${conn.artist_id}`, { gmail_connected: false });
    await sDelete(`google_connections?artist_id=eq.${conn.artist_id}`);
    return;
  }

  const entries = await sGet(`pipeline_entries?artist_id=eq.${conn.artist_id}&select=id,status,contact:contacts(email)`);
  for (const e of entries) {
    const email = e.contact && e.contact.email;
    if (!email) continue;
    const msgs = await gmailSearch(token, `(from:${email} OR to:${email}) newer_than:3d`);
    for (const m of msgs) {
      const full = await gmailGet(token, m.id);
      if (!full) continue;
      const from = (header(full, "From") || "").toLowerCase();
      const subject = header(full, "Subject") || "(no subject)";
      const inbound = from.includes(email.toLowerCase());
      if (inbound) {
        const isNew = await logActivity({ pipeline_entry_id: e.id, kind: "email_in", body: "Reply: " + subject, source: "email_sync", email_message_id: m.id });
        if (isNew) {
          const patch = { last_activity_at: new Date().toISOString() };
          if (e.status === "outreach") patch.status = "waiting";
          await sPatch(`pipeline_entries?id=eq.${e.id}`, patch);
        }
      } else {
        // Outbound (artist -> contact): captured for tone-learning later.
        await logActivity({ pipeline_entry_id: e.id, kind: "email_out", body: "Sent: " + subject, source: "email_sync", email_message_id: m.id });
      }
    }
  }
}

async function tick() {
  try {
    const conns = await sGet("google_connections?select=artist_id,refresh_token");
    console.log(new Date().toISOString(), "sync", conns.length, "connection(s)");
    for (const c of conns) {
      try { await syncArtist(c); } catch (e) { console.error("artist error", c.artist_id, e.message); }
    }
  } catch (e) {
    console.error("tick error", e.message);
  }
}

console.log("Gig worker up. Polling every", INTERVAL / 60000, "min");
tick();
setInterval(tick, INTERVAL);
