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

## Test accounts

Test and probe scripts use **only** these fixed addresses — they're on the
Resend suppression list, so no email is ever really sent to them. Don't create
random or timestamped test emails; they can't be suppressed.

| Role | Email |
|---|---|
| customer | qa-customer@corvustest.dev |
| customer2 | qa-customer2@corvustest.dev |
| superadmin | qa-superadmin@corvustest.dev |
| operations | qa-operations@corvustest.dev |
| support | qa-support@corvustest.dev |
| marketing | qa-marketing@corvustest.dev |
| member | qa-member@corvustest.dev |
| invitee | qa-invitee@corvustest.dev |
| lead | qa-lead@corvustest.dev |
| dp | qa-dp@corvustest.dev |

`scripts/test-users.mjs` has the list plus helpers: `testEmail(role)`, and
`freeTestEmail()` to delete an account left over from an earlier run before
creating it again. Delete test accounts when a run ends. Adding a role means
adding it to that file, this table and the Resend suppression list.

The CI end-to-end suites use their own permanent account,
`crf-ci-e2e-test@example.com`.
