-- Signing packet tracking IDs (2026-11-10) — like Authentisign's packet ID:
-- every e-signature in CorvusPT gets a unique, permanent tracking ID
-- (CPT-XXXX-XXXX) and a register entry with who signed, when, from where, and
-- a SHA-256 fingerprint of the record exactly as signed. Anyone can check an ID
-- on the public /verify page (verify_signing_packet below), which shows only
-- what's needed to confirm it.
--
-- How it works: each signing table has a signing_tracking_id column and the
-- track_signing() trigger. When a row is signed (its signed-at column set or
-- changed), the trigger registers a packet and stamps the row's ID. A client
-- that prints the ID on the PDF before saving (protest forms, settlement) sends
-- its pre-made ID in signing_tracking_id; the trigger accepts it if it's a
-- well-formed, unused ID, and otherwise issues its own. The ID can't be changed
-- afterwards.
--
-- ADDING A NEW SIGNING TABLE (any future e-signature):
--   alter table public.<t> add column if not exists signing_tracking_id text;
--   create trigger <t>_track_signing before insert or update on public.<t>
--     for each row execute function public.track_signing(
--       '<kind>', '<title>', '<signed-at column>', '<user id column or empty>',
--       '<name column(s), comma-separated, or empty for the profile name>',
--       '<email column or empty>');
--   grant insert (signing_tracking_id), update (signing_tracking_id) on public.<t> to authenticated;
-- …then run the backfill block at the bottom for that table.

create table if not exists public.signing_packets (
  id uuid primary key default gen_random_uuid(),
  tracking_id text not null unique,
  kind text not null,
  title text not null,
  source_table text not null,
  source_id uuid,
  user_id uuid references auth.users (id) on delete set null,
  signer_name text,
  signer_email text,
  signed_at timestamptz not null,
  ip_address text,
  user_agent text,
  fingerprint text not null,
  created_at timestamptz not null default now()
);
create index if not exists signing_packets_user_idx on public.signing_packets (user_id, signed_at desc);
create index if not exists signing_packets_source_idx on public.signing_packets (source_table, source_id);

alter table public.signing_packets enable row level security;
drop policy if exists "signing packets: own or staff" on public.signing_packets;
create policy "signing packets: own or staff" on public.signing_packets
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
-- No insert/update/delete for clients: only track_signing() (security definer) writes.
revoke all on public.signing_packets from anon, authenticated;
grant select on public.signing_packets to authenticated;

-- CPT-XXXX-XXXX: 8 characters of Crockford base32 (no I, L, O, U), 40 random bits.
create or replace function public.new_signing_tracking_id(p_prefix text default 'CPT')
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  -- random bytes from a v4 UUID (skipping its fixed version/variant bytes 6 and 8)
  b bytea := uuid_send(gen_random_uuid());
  s text := '';
  i int;
begin
  foreach i in array array[0, 1, 2, 3, 4, 5, 10, 11] loop
    s := s || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
  end loop;
  return p_prefix || '-' || substr(s, 1, 4) || '-' || substr(s, 5, 4);
end;
$$;

create or replace function public.track_signing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p_kind text := tg_argv[0];
  p_title text := tg_argv[1];
  p_signed_col text := tg_argv[2];
  p_user_col text := nullif(tg_argv[3], '');
  p_name_cols text := nullif(tg_argv[4], '');
  p_email_col text := nullif(tg_argv[5], '');
  new_j jsonb := to_jsonb(new);
  old_j jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  signed_new text := new_j ->> p_signed_col;
  signed_old text := old_j ->> p_signed_col;
  wanted text := new_j ->> 'signing_tracking_id';
  tid text;
  uid uuid;
  who text;
  mail text;
  headers json;
  col text;
  attempt int := 0;
begin
  -- The one-time backfill below writes IDs itself.
  if current_setting('corvus.signing_backfill', true) = 'on' then
    return new;
  end if;
  -- Not a new signing: keep the existing ID (it can't be edited).
  if signed_new is null or (tg_op = 'UPDATE' and signed_new is not distinct from signed_old) then
    if tg_op = 'UPDATE' then
      new := jsonb_populate_record(new, jsonb_build_object('signing_tracking_id', old_j ->> 'signing_tracking_id'));
    else
      new := jsonb_populate_record(new, jsonb_build_object('signing_tracking_id', null));
    end if;
    return new;
  end if;

  -- The client's pre-made ID (printed on its PDF) if it's well formed and
  -- unused; otherwise a fresh one.
  if wanted is not null
     and wanted ~ '^CPT-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$'
     and wanted is distinct from (old_j ->> 'signing_tracking_id')
     and not exists (select 1 from signing_packets where tracking_id = wanted) then
    tid := wanted;
  else
    loop
      tid := new_signing_tracking_id('CPT');
      exit when not exists (select 1 from signing_packets where tracking_id = tid);
      attempt := attempt + 1;
      if attempt > 5 then raise exception 'could not issue a signing tracking id'; end if;
    end loop;
  end if;
  new := jsonb_populate_record(new, jsonb_build_object('signing_tracking_id', tid));
  new_j := to_jsonb(new);

  uid := case when p_user_col is null then null else (new_j ->> p_user_col)::uuid end;
  if p_name_cols is not null then
    who := '';
    foreach col in array string_to_array(p_name_cols, ',') loop
      who := trim(who || ' ' || coalesce(new_j ->> trim(col), ''));
    end loop;
    who := nullif(who, '');
  end if;
  if who is null and uid is not null then
    select nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')
      into who from profiles where id = uid;
  end if;
  mail := case when p_email_col is null then null else new_j ->> p_email_col end;
  if mail is null and uid is not null then
    select email into mail from profiles where id = uid;
  end if;
  begin
    headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    headers := null;
  end;

  insert into signing_packets (
    tracking_id, kind, title, source_table, source_id, user_id, signer_name, signer_email,
    signed_at, ip_address, user_agent, fingerprint
  ) values (
    tid,
    p_kind,
    case
      when p_title <> '' then p_title
      when new_j ->> 'form_type' = 'notice_of_protest' then 'Notice of Protest (Form 50-132)'
      when new_j ->> 'form_type' = 'appointment_of_agent' then 'Appointment of Agent (Form 50-162)'
      when new_j ->> 'form_type' = 'evidence_declaration' then 'Evidence declaration'
      else initcap(replace(coalesce(new_j ->> 'form_type', p_kind), '_', ' '))
    end,
    tg_table_name,
    (new_j ->> 'id')::uuid,
    uid,
    who,
    mail,
    (signed_new)::timestamptz,
    coalesce(new_j ->> 'ip_address', split_part(headers ->> 'x-forwarded-for', ',', 1)),
    coalesce(new_j ->> 'user_agent', headers ->> 'user-agent'),
    -- the record exactly as signed (bookkeeping timestamps left out)
    encode(sha256(convert_to((new_j - 'updated_at')::text, 'UTF8')), 'hex')
  );
  return new;
end;
$$;
revoke all on function public.track_signing() from public, anon, authenticated;

-- Public check of a tracking ID: confirms the packet exists and what was
-- signed, when, and by whom (first name + last initial only).
create or replace function public.verify_signing_packet(p_tracking_id text)
returns table (
  tracking_id text,
  title text,
  kind text,
  signed_at timestamptz,
  signer text,
  fingerprint text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    sp.tracking_id,
    sp.title,
    sp.kind,
    sp.signed_at,
    nullif(trim(
      split_part(coalesce(sp.signer_name, ''), ' ', 1) || ' ' ||
      coalesce(left(nullif(regexp_replace(coalesce(sp.signer_name, ''), '^\S+\s*', ''), ''), 1) || '.', '')
    ), ''),
    sp.fingerprint
  from signing_packets sp
  where sp.tracking_id = upper(trim(p_tracking_id));
$$;
revoke all on function public.verify_signing_packet(text) from public;
grant execute on function public.verify_signing_packet(text) to anon, authenticated;

-- ── The signing tables ──────────────────────────────────────────────────────

alter table public.engagement_packets add column if not exists signing_tracking_id text;
drop trigger if exists engagement_packets_track_signing on public.engagement_packets;
create trigger engagement_packets_track_signing before insert or update on public.engagement_packets
  for each row execute function public.track_signing(
    'engagement_packet', 'CorvusPT Engagement Packet', 'signed_at', 'user_id',
    'signee_first_name,signee_last_name', 'email');

alter table public.protest_authorizations add column if not exists signing_tracking_id text;
drop trigger if exists protest_authorizations_track_signing on public.protest_authorizations;
create trigger protest_authorizations_track_signing before insert or update on public.protest_authorizations
  for each row execute function public.track_signing(
    'protest_authorization', 'Protest authorization', 'signed_at', 'user_id',
    'first_name,last_name', 'email');

alter table public.protest_form_submissions add column if not exists signing_tracking_id text;
drop trigger if exists protest_form_submissions_track_signing on public.protest_form_submissions;
create trigger protest_form_submissions_track_signing before insert or update on public.protest_form_submissions
  for each row execute function public.track_signing(
    'protest_form', '', 'signed_at', 'user_id', '', '');

alter table public.settlement_agreements add column if not exists signing_tracking_id text;
drop trigger if exists settlement_agreements_track_signing on public.settlement_agreements;
create trigger settlement_agreements_track_signing before insert or update on public.settlement_agreements
  for each row execute function public.track_signing(
    'settlement_agreement', 'Settlement agreement', 'signed_at', 'user_id', '', '');

alter table public.bpp_accounts add column if not exists signing_tracking_id text;
drop trigger if exists bpp_accounts_track_signing on public.bpp_accounts;
create trigger bpp_accounts_track_signing before insert or update on public.bpp_accounts
  for each row execute function public.track_signing(
    'bpp_rendition', 'BPP rendition (Form 50-144)', 'rendition_signed_at', 'user_id', '', '');

alter table public.protests add column if not exists signing_tracking_id text;
drop trigger if exists protests_track_signing on public.protests;
create trigger protests_track_signing before insert or update on public.protests
  for each row execute function public.track_signing(
    'bpp_protest', 'BPP protest signature', 'bpp_signed_at', 'user_id', '', 'bpp_owner_email');

alter table public.bd_proposals add column if not exists signing_tracking_id text;
drop trigger if exists bd_proposals_track_signing on public.bd_proposals;
create trigger bd_proposals_track_signing before insert or update on public.bd_proposals
  for each row execute function public.track_signing(
    'partner_proposal', 'Partner proposal', 'signed_at', '', 'signer_name', 'sent_to');

-- Clients may send a pre-made ID with a signing (the trigger validates it).
grant insert (signing_tracking_id), update (signing_tracking_id) on public.engagement_packets to authenticated;
grant insert (signing_tracking_id), update (signing_tracking_id) on public.protest_authorizations to authenticated;
grant insert (signing_tracking_id), update (signing_tracking_id) on public.protest_form_submissions to authenticated;
grant insert (signing_tracking_id), update (signing_tracking_id) on public.settlement_agreements to authenticated;
grant insert (signing_tracking_id), update (signing_tracking_id) on public.bpp_accounts to authenticated;
grant insert (signing_tracking_id), update (signing_tracking_id) on public.protests to authenticated;

-- ── Backfill: IDs for everything signed before today ────────────────────────
-- Registers each already-signed row once (its original signed-at time). The
-- trigger skips these updates (the signed-at value doesn't change), so the
-- register entry is written here directly.
do $$
declare
  spec record;
  r record;
  j jsonb;
  tid text;
  who text;
  mail text;
  uid uuid;
  col text;
begin
  perform set_config('corvus.signing_backfill', 'on', true);
  for spec in
    select * from (values
      ('engagement_packets', 'engagement_packet', 'CorvusPT Engagement Packet', 'signed_at', 'user_id', 'signee_first_name,signee_last_name', 'email'),
      ('protest_authorizations', 'protest_authorization', 'Protest authorization', 'signed_at', 'user_id', 'first_name,last_name', 'email'),
      ('protest_form_submissions', 'protest_form', '', 'signed_at', 'user_id', '', ''),
      ('settlement_agreements', 'settlement_agreement', 'Settlement agreement', 'signed_at', 'user_id', '', ''),
      ('bpp_accounts', 'bpp_rendition', 'BPP rendition (Form 50-144)', 'rendition_signed_at', 'user_id', '', ''),
      ('protests', 'bpp_protest', 'BPP protest signature', 'bpp_signed_at', 'user_id', '', 'bpp_owner_email'),
      ('bd_proposals', 'partner_proposal', 'Partner proposal', 'signed_at', '', 'signer_name', 'sent_to')
    ) as t(tbl, kind, title, signed_col, user_col, name_cols, email_col)
  loop
    for r in execute format(
      'select to_jsonb(x) as j from public.%I x where %I is not null and signing_tracking_id is null',
      spec.tbl, spec.signed_col)
    loop
      j := r.j;
      loop
        tid := public.new_signing_tracking_id('CPT');
        exit when not exists (select 1 from public.signing_packets where tracking_id = tid);
      end loop;
      uid := case when spec.user_col = '' then null else (j ->> spec.user_col)::uuid end;
      who := null;
      if spec.name_cols <> '' then
        who := '';
        foreach col in array string_to_array(spec.name_cols, ',') loop
          who := trim(who || ' ' || coalesce(j ->> col, ''));
        end loop;
        who := nullif(who, '');
      end if;
      if who is null and uid is not null then
        select nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')
          into who from public.profiles where id = uid;
      end if;
      mail := case when spec.email_col = '' then null else j ->> spec.email_col end;
      if mail is null and uid is not null then
        select email into mail from public.profiles where id = uid;
      end if;
      insert into public.signing_packets (
        tracking_id, kind, title, source_table, source_id, user_id, signer_name, signer_email,
        signed_at, ip_address, user_agent, fingerprint
      ) values (
        tid, spec.kind,
        case
          when spec.title <> '' then spec.title
          when j ->> 'form_type' = 'notice_of_protest' then 'Notice of Protest (Form 50-132)'
          when j ->> 'form_type' = 'appointment_of_agent' then 'Appointment of Agent (Form 50-162)'
          when j ->> 'form_type' = 'evidence_declaration' then 'Evidence declaration'
          else initcap(replace(coalesce(j ->> 'form_type', spec.kind), '_', ' '))
        end,
        spec.tbl, (j ->> 'id')::uuid, uid, who, mail,
        (j ->> spec.signed_col)::timestamptz,
        j ->> 'ip_address', j ->> 'user_agent',
        encode(sha256(convert_to(((j || jsonb_build_object('signing_tracking_id', tid)) - 'updated_at')::text, 'UTF8')), 'hex')
      );
      execute format('update public.%I set signing_tracking_id = $1 where id = $2', spec.tbl)
        using tid, (j ->> 'id')::uuid;
    end loop;
  end loop;
  perform set_config('corvus.signing_backfill', 'off', true);
end $$;
