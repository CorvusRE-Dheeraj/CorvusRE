-- LinkedIn follow prompt (2026-10-26): after the welcome tour (new users) or
-- on the next dashboard visit (existing users), a small popup asks the user to
-- follow https://www.linkedin.com/company/corvusre. Per account, so it doesn't
-- repeat on every device. LinkedIn can't tell us whether someone actually
-- followed, so "followed" = they clicked Follow.
alter table public.profiles add column if not exists linkedin_followed_at timestamptz;
alter table public.profiles add column if not exists linkedin_prompt_snoozed_until timestamptz;
grant update (linkedin_followed_at, linkedin_prompt_snoozed_until) on public.profiles to authenticated;
