# CorvusRE

## Running locally (with working sign-in)

```
npm install
cp apps/pt/.env.example apps/pt/.env   # then fill in the Supabase values
npm run local
```

Open http://localhost:8080/. `npm run local` builds CorvusPT and the shared
sign-in app (`apps/identity`, served at `/auth/`) and serves both together, so
"Sign In" works. Sign in with email + password — Google sign-in only works on
the deployed domain. It's a static build: re-run after changing code
(`npm run local -- --no-build` reuses the last build; `PORT=9000` changes the port).

Don't use `vite preview` on `apps/pt` alone for anything that needs a login —
it doesn't serve `/auth/`, so sign-in 404s.
