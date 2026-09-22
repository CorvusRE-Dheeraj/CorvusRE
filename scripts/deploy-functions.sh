#!/usr/bin/env bash
# Deploys changed Supabase edge functions for one project.
#   scripts/deploy-functions.sh <supabase-pt|supabase-dp> <project-ref> [base-sha]
# Needs SUPABASE_ACCESS_TOKEN. DRY_RUN=1 only prints what it would deploy.
#
# A function is redeployed when its own folder changed since base-sha, or when
# anything in functions/_shared changed (then every function is, since any of
# them may import it). With no base-sha (manual run), everything is deployed.
#
# JWT verification is PRESERVED from what's live: an existing function keeps
# whatever verify_jwt it has now (a dozen functions, e.g. stripe-webhook, run
# with it off without saying so in their header, so guessing from comments
# would silently break them). Only a brand-new function falls back to its
# header's documented "--no-verify-jwt" line.
set -euo pipefail

dir="${1:?project folder, e.g. supabase-pt}"
ref="${2:?project ref}"
base="${3:-}"
src="$dir/functions"
token="${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is required}"

if [ -n "$base" ] && git cat-file -e "$base^{commit}" 2>/dev/null; then
  changed="$(git diff --name-only "$base" HEAD -- "$src")"
else
  changed="ALL"
fi

if [ "$changed" = "ALL" ] || echo "$changed" | grep -q "^$src/_shared/"; then
  names="$(ls -1 "$src" | grep -v '^_shared$')"
else
  # `|| true`: grep -v exits 1 when nothing is left (no function changed), which
  # pipefail would turn into a silent script failure instead of "nothing to do".
  names="$(echo "$changed" | sed -n "s|^$src/\([^/]*\)/.*|\1|p" | { grep -v '^_shared$' || true; } | sort -u)"
fi

if [ -z "$names" ]; then
  echo "No $dir functions changed — nothing to deploy."
  exit 0
fi

# "<slug> <verify_jwt>" per live function
live_verify="$(curl -fsS -H "Authorization: Bearer $token" \
  "https://api.supabase.com/v1/projects/$ref/functions" |
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>JSON.parse(d).forEach(f=>console.log(f.slug,f.verify_jwt)))")"

work="$(mktemp -d)"
mkdir -p "$work/supabase"
cp -r "$src" "$work/supabase/functions"

failed=0
for name in $names; do
  [ -f "$src/$name/index.ts" ] || { echo "skip $name (deleted or no index.ts)"; continue; }
  flags=""
  live="$(printf '%s\n' "$live_verify" | awk -v n="$name" '$1==n {print $2}')"
  if [ -n "$live" ]; then
    if [ "$live" = "false" ]; then flags="--no-verify-jwt"; fi
  elif head -n 12 "$src/$name/index.ts" | grep -q -- "--no-verify-jwt"; then
    flags="--no-verify-jwt"
  fi
  echo "→ deploying $dir/$name $flags"
  if [ "${DRY_RUN:-}" = "1" ]; then continue; fi
  (cd "$work" && npx --yes supabase functions deploy "$name" --project-ref "$ref" $flags) || {
    echo "::error::deploy failed for $name"
    failed=1
  }
done
rm -rf "$work"
exit $failed
