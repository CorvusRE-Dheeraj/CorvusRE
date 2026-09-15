# CorvusDP — agent notes

CorvusDP ("Corvus Design & Permit") is one of the five CorvusRE doors. It helps
owners, developers and engineering teams run permitting & entitlement and design
for ground-up or expansion projects across US jurisdictions.

## Stack

- TanStack Start (React 19) — file-based routing under `src/routes/`
- Tailwind CSS v4 + shadcn/ui (`src/components/ui/`)
- Supabase (auth + Postgres, `supabase/schema.sql`)
- Static build: every route is prerendered to HTML (`nitro: false`,
  `tanstackStart.prerender`) so it can be hosted on GitHub Pages under the
  CorvusRE hub at `/corvusdp/`.

## Conventions

- Domain logic (pure, unit-tested) lives in `src/lib/*.ts`; routes stay thin.
- Supabase table columns are `snake_case`; the `src/lib` layer maps them to
  `camelCase` types at the boundary.
- Run `npm run dev` (port 8082), `npm run test`, `npm run build`.

## Branches

`main` (stable) ← `qa` ← `dev` ← `feature-dev-dheeraj` (working branch).
Deploy runs on push to `dev`.
