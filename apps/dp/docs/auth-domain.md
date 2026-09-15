# Getting rid of the `xzhilwwlfajxhklkiteb.supabase.co` string on the Google screen

That host is CorvusDP's Supabase project URL. It shows up on Google's consent
screen ("to continue to …") and in Google's "you signed in" email because it's
the host of the OAuth **callback URL**
(`https://xzhilwwlfajxhklkiteb.supabase.co/auth/v1/callback`).

There are two ways to change what the user sees. Neither is a code change in
this repo — both are console / DNS / billing tasks.

---

## Option A — free: brand + publish the Google OAuth consent screen

For a **published** OAuth app Google shows the **app name** ("Continue to
CorvusDP") instead of the raw redirect host. For an app still in _Testing_ it
shows the host.

1. Google Cloud Console → the project that owns client
   `494714971823-lg0fb37ifi3h7257sj5cor1l7efpgfgp.apps.googleusercontent.com`.
2. **APIs & Services → OAuth consent screen**:
   - **App name**: `CorvusDP` (or `Corvus`)
   - **User support email**, **App logo**
   - **App domain**: `corvusre.com`; **Homepage**: `https://corvusre.com/corvusdp/`
   - **Privacy policy**: `https://corvusre.com/corvusdp/privacy`
   - **Terms of service**: `https://corvusre.com/corvusdp/terms`
   - **Authorized domains**: `corvusre.com`, `supabase.co`
3. **Publish app** (Publishing status → _In production_). Basic scopes
   (email, profile, openid) don't need Google's verification review, so this
   takes effect immediately.

This does **not** remove the `supabase.co` host from the "received this profile
info" email — only Option B does that.

---

## Option B — paid: a Supabase custom auth domain (`auth.corvusre.com`)

Replaces the callback host entirely, so Google shows `auth.corvusre.com`
everywhere.

Requires the **Supabase Pro plan** on the CorvusRE org + the **Custom Domain
add-on** on the CorvusDP project (`xzhilwwlfajxhklkiteb`). ~US$25/mo Pro +
~US$10/mo add-on.

1. Upgrade: <https://supabase.com/dashboard/org/agqsufzizkaadtvbvgox/billing>
2. CorvusDP project → **Settings → Custom Domains** → enter `auth.corvusre.com`.
   Supabase gives you a CNAME target and a TXT verification record.
3. Add both records to `corvusre.com` DNS. Wait for propagation, then
   **Activate** in Supabase.
4. Google Cloud Console → that OAuth client → **Authorized redirect URIs**:
   add `https://auth.corvusre.com/auth/v1/callback` (keep the old one until the
   switch is verified).
5. Then the app + Supabase side (someone with the Supabase management token can
   do this part):
   - Supabase Auth → `site_url` / `additional redirect URLs` already use
     `corvusre.com/corvusdp` — no change needed.
   - `src/routes/sign-in.tsx` computes the OAuth `redirectTo` from
     `window.location`, so it needs no change either.
   - Verify a Google sign-in end to end; then remove the old
     `…supabase.co/auth/v1/callback` from the Google client.

## Current state

- Google provider: **enabled** on CorvusDP's Supabase, real client id + secret set.
- Callback URL in use: `https://xzhilwwlfajxhklkiteb.supabase.co/auth/v1/callback`
  (registered on the shared Google client).
- `site_url`: `https://corvusre.com/corvusdp/`;
  redirect allow-list covers `corvusre.com/corvusdp/**` and `localhost:8082/**`.
