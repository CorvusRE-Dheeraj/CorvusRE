# CorvusPT.ai

Texas property tax assistant, built with [Lovable](https://lovable.dev).

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS

## Development

You need Node.js 20+.

```sh
npm i
npm run dev
```

The AI document-scanning features (`/intake`, `/document-review`) call server functions
that need a `LOVABLE_API_KEY` environment variable. Create a `.env` file locally with:

```
LOVABLE_API_KEY=your-key-here
```

## Deployment

Hosted on **GitHub Pages** at https://dheeraj-corvusrf.github.io/CorvusRF/.

GitHub Pages only serves static files — it can't run server code. This app is built with
TanStack Start (normally server-rendered), so the Nitro server build is disabled
(`nitro: false`) and every route is prerendered to static HTML at build time instead
(`tanstackStart.prerender` in [vite.config.ts](vite.config.ts)).

**Trade-off:** the two features that call a live AI server function —
uploading an appraisal notice for AI OCR (`/intake`) and the "Ask AI" chat
(`/document-review`) — cannot work on this static build, since there's no server to
receive the request. Both fail with a friendly in-UI message rather than crashing. The
rest of the site, including the address-based intake flow, works fully since it's
client-side only.

If you need those AI features working live, deploy to a host that runs a real server
instead (e.g. Cloudflare Workers, Vercel, Netlify) and set a `LOVABLE_API_KEY` environment
variable there for `src/lib/document.functions.ts`.

### Automatic deploy (GitHub Actions)

Pushing to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml), which
builds the static site and publishes it via `actions/deploy-pages`. One-time setup in the
repo: **Settings → Pages → Build and deployment → Source → GitHub Actions**.

### Manual build

```sh
npm run build
# static output in dist/client
```
