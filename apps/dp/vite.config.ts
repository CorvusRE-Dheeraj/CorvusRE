// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Base path the app is served under. Defaults to "/" for local dev; the deploy
// workflow passes "/CorvusDP/" for the GitHub Pages project site. (Prerender
// works fine under a non-root base — the earlier "zero HTML" symptom was just a
// port clash from a strictPort `preview` server, now removed below.)
const base = process.env.SITE_BASE || "/";

// Opt-in only, dev-server-only (never touches `vite build`/production) — same
// as apps/pt: proxies /auth/* to apps/identity's own dev server so a local
// `npm run dev -w apps/dp` can reach the real shared sign-in screen instead of
// the 404 you'd otherwise get hitting /auth/ against a lone dp dev server.
//   1. In another terminal: SITE_BASE=/auth/ npm run dev -w apps/identity -- --port 8081
//   2. LOCAL_AUTH_PROXY=1 npm run dev -w apps/dp
const authProxy = process.env.LOCAL_AUTH_PROXY
  ? { proxy: { "/auth": "http://localhost:8081" } }
  : {};

export default defineConfig({
  // Local dev runs on 8082. `preview` is left on Vite's default port — the
  // build-time prerenderer spins up its own throwaway preview server and a
  // fixed strictPort there collides with a running dev server and aborts the
  // prerender (zero HTML emitted).
  vite: {
    base,
    server: { port: 8082, strictPort: true, ...authProxy },
  },
  tanstackStart: {
    server: { entry: "server" },
    // GitHub Pages only serves static files, so every route is prerendered to
    // HTML at build time instead of relying on a live SSR server.
    prerender: { enabled: true, crawlLinks: true },
    router: { basepath: base },
  },
  // GitHub Pages can't run server code; disable the Nitro server build entirely
  // so `vite build` emits a purely static site.
  nitro: false,
});
