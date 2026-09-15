# CorvusDP.ai — Design & Permit

AI-assisted permitting, entitlement and design for real estate development
projects. One of the five doors of [CorvusRE](https://corvusre.com).

## Built with

- TanStack Start · TypeScript · React 19
- Tailwind CSS v4 · shadcn/ui
- Supabase (auth + Postgres)

## Development

Requires Node.js 20+.

```sh
npm i
cp .env.example .env   # fill in your Supabase project URL + anon key
npm run dev            # http://localhost:8082
```

Without Supabase credentials the marketing pages and the anonymous
permitting/design analysis flow still work (results are held in the browser
session); sign-up, saved projects and the dashboard need a configured Supabase
project — run `supabase/schema.sql` once in the SQL editor of a fresh project.

## Tests

```sh
npm run test     # Vitest — pure permitting/zoning/fee/timeline logic
```

## Supabase

CorvusDP uses its **own** Supabase project — never share a database with another
CorvusRE app. Create a fresh project, run [supabase/schema.sql](supabase/schema.sql)
once in its SQL editor, then set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
(locally in `.env`, in CI as repo **Variables**). To grant yourself admin, set
`is_admin = true` on your row in `public.profiles`.

## Deployment

Hosted **only** at **https://corvusre.com/corvusdp/**. This repo does **not**
publish its own GitHub Pages site.

The `corvusre.com` custom domain belongs to the **CorvusPT** repo; its deploy
workflow checks out this repo's `dev` branch, runs
`SITE_BASE=/corvusdp/ npm run build`, and drops the output into `site/corvusdp/`
alongside the shared CorvusRE hub.

**Push to `dev` here → `corvusre.com/corvusdp/` redeploys automatically.**
[CI](.github/workflows/ci.yml) runs the tests + the production build, and on a
green `dev` push it dispatches the CorvusPT deploy. That cross-repo call uses the
`CORVUSPT_DEPLOY_TOKEN` repo secret (a token with **Actions: read+write** on the
CorvusPT repo — the default `GITHUB_TOKEN` can't reach another repo). If auto-deploy
stops, that secret has expired; replace it with a fresh fine-grained PAT.

## Branches

| Branch                | Purpose                                             |
| --------------------- | --------------------------------------------------- |
| `main`                | stable / release                                    |
| `qa`                  | pre-release verification                            |
| `dev`                 | integration; source the CorvusPT deploy builds from |
| `feature-dev-dheeraj` | working branch                                      |
