// Minimal zero-dependency static server for the Gig Collective app.
// Serves ./app, but generates /config.js from environment variables so the
// (public) Supabase keys live in Railway's env, not in git. Falls back to the
// on-disk app/config.js for local dev when the env vars aren't set.

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "app");
const PORT = process.env.PORT || 8000;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

function configJs() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (url && key) {
    return `window.GIG_CONFIG = ${JSON.stringify({ SUPABASE_URL: url, SUPABASE_ANON_KEY: key })};\n`;
  }
  // Local dev fallback: serve the git-ignored file if it exists.
  try {
    return fs.readFileSync(path.join(ROOT, "config.js"), "utf8");
  } catch {
    return "window.GIG_CONFIG = { SUPABASE_URL: '', SUPABASE_ANON_KEY: '' };\n";
  }
}

// Public landing at "/", the app at "/app", legal pages at "/terms" and "/privacy".
const ROUTES = {
  "/": "landing.html",
  "/app": "index.html",
  "/app/": "index.html",
  "/sw.js": "sw.js",
  "/terms": "terms.html",
  "/terms/": "terms.html",
  "/privacy": "privacy.html",
  "/privacy/": "privacy.html",
};

http
  .createServer((req, res) => {
    let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);

    if (urlPath === "/config.js") {
      res.writeHead(200, { "Content-Type": TYPES[".js"], "Cache-Control": "no-store" });
      res.end(configJs());
      return;
    }

    if (ROUTES[urlPath]) urlPath = "/" + ROUTES[urlPath];

    // Resolve safely inside ROOT (no path traversal).
    const filePath = path.join(ROOT, path.normalize(urlPath));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        // Unknown route -> public landing page.
        fs.readFile(path.join(ROOT, "landing.html"), (e2, idx) => {
          if (e2) {
            res.writeHead(404);
            res.end("Not found");
          } else {
            res.writeHead(200, { "Content-Type": TYPES[".html"] });
            res.end(idx);
          }
        });
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream" });
      res.end(data);
    });
  })
  .listen(PORT, () => console.log(`Gig Collective serving ./app on :${PORT}`));
