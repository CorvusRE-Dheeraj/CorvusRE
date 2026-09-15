// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Not hardcoded on purpose — this app has moved between two GitHub Pages
// targets that need different base paths: the custom domain
// (https://corvusre.com/) needs "/", the old project-site URL
// (https://dheeraj-corvusrf.github.io/CorvusRF/) needs "/CorvusRF/" since a
// project site serves everything under a subpath matching the repo name. Set
// SITE_BASE in the environment to switch which one a build targets;
// .github/workflows/deploy.yml's workflow_dispatch input does this for a
// manual deploy, and it defaults to "/" (corvusre.com) for the normal
// push-triggered deploy and for local `npm run dev`/`npm run build`.
const base = process.env.SITE_BASE || "/";

export default defineConfig({
  vite: { base },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    // GitHub Pages only serves static files, so every route is prerendered to HTML at
    // build time instead of relying on a live SSR server.
    prerender: { enabled: true, crawlLinks: true },
    // Vite's own `base` (above) only covers asset URLs — the prerender crawler reads
    // this separate router.basepath to know what path prefix to request pages under
    // (see @tanstack/start-plugin-core's prerender.js: `withBase(page.path, routerBasePath)`
    // where routerBasePath comes from here, not from vite.base). Without this, a
    // non-root SITE_BASE builds assets at the right path but prerendering itself 404s
    // on every route.
    router: { basepath: base },
  },
  // GitHub Pages can't run server code (Workers/Node); disable the Nitro server build
  // entirely so `vite build` emits a purely static site.
  nitro: false,
});
