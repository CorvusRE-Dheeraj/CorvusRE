// One-command local environment: `npm run local` (from the repo root).
//
// Sign-in for CorvusPT/CorvusDP happens on the shared /auth/ app (apps/identity),
// which `vite preview` for a single door never serves -- so a door's own
// "Sign In" 404s locally. This builds CorvusPT (base "/") and the identity app
// (base "/auth/"), then serves both from ONE server, the same shape as the
// deployed site. Sign in with email + password; "Continue with Google" only
// works on the real domain (Google's redirect allow-list).
//
//   npm run local                 build both, serve on http://localhost:8080
//   npm run local -- --no-build   skip the builds, just serve the last ones
//   PORT=9000 npm run local       different port
//
// Needs apps/pt/.env (copy apps/pt/.env.example). It's a static build, so
// re-run after changing code.
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT) || 8080;
const PT_DIST = path.join(root, "apps/pt/dist/client");
const AUTH_DIST = path.join(root, "apps/identity/dist/local");
// The not-yet-live door pages live at their own public URLs (apps/<dir> ->
// /<url>/), and share hub.css / door-page.* from the landing app -- serve
// them locally too so those links don't 404.
const HOME = path.join(root, "apps/home");
const STATIC_DOORS = {
  "/corvusbsl": path.join(root, "apps/sbl"),
  "/corvusco": path.join(root, "apps/co"),
  "/corvusrf": path.join(root, "apps/rf"),
};
const HOME_ASSETS = new Set(["/hub.css", "/door-page.css", "/door-page.js", "/favicon.svg", "/favicon.ico"]);

if (!existsSync(path.join(root, "apps/pt/.env"))) {
  console.warn("! apps/pt/.env is missing -- copy apps/pt/.env.example to apps/pt/.env first.");
}

function run(label, args, env = {}) {
  console.log(`\n> ${label}`);
  const r = spawnSync(`npm ${args.join(" ")}`, {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) {
    console.error(`\n${label} failed.`);
    process.exit(r.status ?? 1);
  }
}

if (!process.argv.includes("--no-build")) {
  run("Building CorvusPT", ["run", "build", "-w", "apps/pt"]);
  // Set through the child's env (not a shell arg) so Git Bash can't rewrite
  // "/auth/" into a Windows path.
  run(
    "Building the shared sign-in app (/auth/)",
    ["run", "build", "-w", "apps/identity", "--", "--outDir", "dist/local", "--emptyOutDir"],
    { SITE_BASE: "/auth/" },
  );
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
};

function fileIn(base, rel) {
  for (const candidate of [rel, path.join(rel, "index.html")]) {
    const f = path.resolve(base, "." + path.sep + candidate);
    if (f.startsWith(base + path.sep) && existsSync(f) && statSync(f).isFile()) return f;
  }
  return null;
}

createServer((req, res) => {
  const [rawPath, query] = req.url.split("?");
  const urlPath = decodeURIComponent(rawPath);

  if (urlPath === "/auth") {
    res.writeHead(302, { Location: "/auth/" + (query ? `?${query}` : "") });
    return res.end();
  }

  const doorPrefix = Object.keys(STATIC_DOORS).find(
    (p) => urlPath === p || urlPath.startsWith(p + "/"),
  );
  if (doorPrefix) {
    if (urlPath === doorPrefix) {
      res.writeHead(302, { Location: doorPrefix + "/" });
      return res.end();
    }
    const f = fileIn(STATIC_DOORS[doorPrefix], urlPath.slice(doorPrefix.length));
    if (f) {
      res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] ?? "application/octet-stream" });
      return createReadStream(f).pipe(res);
    }
  }
  if (HOME_ASSETS.has(urlPath)) {
    const f = fileIn(HOME, urlPath);
    if (f) {
      res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] ?? "application/octet-stream" });
      return createReadStream(f).pipe(res);
    }
  }

  const isAuth = urlPath.startsWith("/auth/");
  const base = isAuth ? AUTH_DIST : PT_DIST;
  const rel = isAuth ? urlPath.slice("/auth".length) : urlPath;
  // Unknown extension-less paths fall back to the SPA shell, like the real host.
  const file = fileIn(base, rel) ?? (path.extname(rel) ? null : fileIn(base, "/index.html"));

  if (!file) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Not found");
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(PORT, () => {
  console.log(`\nLocal site ready: http://localhost:${PORT}/`);
  console.log(`Sign-in page:     http://localhost:${PORT}/auth/`);
});
