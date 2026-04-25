-- ===========================================================================
-- World Shaker — Initial schema (v0)
--
-- Per /Users/jyong/projects/.omc/specs/deep-interview-cupid-proxy-product-v3.md
-- and Codex review at .omc/artifacts/ask/codex-review-*.md (commit 22427c6).
--
-- Six core tables: users, agents, matches, conversations, outcome_events, reports
-- Plus auth_nonces for replay-safe wallet auth.
--
-- Design decisions baked in:
--   * nullifier as TEXT (not numeric — JS BigInt serialization risk per Codex)
--   * UNIQUE(nullifier, action) enforces 1-human-1-account
--   * verification_level as TEXT + CHECK (not enum — single-value enums are
--     painful to evolve, per Codex review)
--   * `surface` discriminator on agent activity tables — v2 will add 'agora'
--   * pgvector embedding for matching prefilter (partial index — active+dating only)
--   * outcome_events schema fixed Day 0 — moat data layer
--   * conversations have UNIQUE pair index — prevents A↔B duplication
--   * matches have partial UNIQUE — prevents duplicate cards for active states
-- ===========================================================================

create extension if not exists pgcrypto;
create extension if not exists vector;

-- ---------- enums ---------------------------------------------------------

create type agent_status as enum ('active', 'paused', 'suspended');
create type match_status as enum ('pending', 'accepted', 'skipped', 'mutual', 'expired');
create type ritual_surface as enum ('dating');  -- v2: alter type to add 'agora'
create type outcome_event_type as enum (
  'viewed',
  'accepted',
  'skipped',
  'mutual',
  'chat_opened',
  'replied_24h',
  'met_confirmed',
  'safety_yes',
  'safety_mixed',
  'safety_no',
  'wont_connect',
  'vouched',
  'report_filed'
);
create type report_reason as enum (
  'harassment',
  'hateful',
  'catfish',
  'underage',
  'nsfw',
  'spam',
  'other'
);

-- ---------- users --------------------------------------------------------

create table public.users (
  id uuid primary key default gen_random_uuid(),
  nullifier text not null,
  action text not null,
  wallet_address text,
  world_username text,
  -- TEXT + CHECK rather than enum: World ID v4 may evolve credential names,
  -- and altering single-value enums is costly. (Codex review)
  verification_level text not null default 'orb' check (verification_level = 'orb'),
  created_at timestamptz not null default now(),
  unique (nullifier, action),
  unique (wallet_address)
);

create index idx_users_username on public.users (world_username) where world_username is not null;

-- ---------- auth_nonces -------------------------------------------------
-- Replay-safe nonce store for wallet auth (SIWE-style).
-- Nonces issued by /api/wallet-auth?action=nonce, consumed on POST.

create table public.auth_nonces (
  nonce_hash text primary key,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create index idx_auth_nonces_expires on public.auth_nonces (expires_at)
  where consumed_at is null;

-- ---------- agents -------------------------------------------------------

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  interview_answers jsonb not null default '{}'::jsonb,
  extracted_features jsonb not null default '{}'::jsonb,
  embedding vector(1536),
  status agent_status not null default 'active',
  surface ritual_surface not null default 'dating',
  created_at timestamptz not null default now(),
  unique (user_id)  -- 1 user = 1 agent (v1)
);

create index idx_agents_status on public.agents (status) where status = 'active';
-- Partial HNSW: only active+dating agents with embedding present.
-- Per Codex: filtered ANN queries get the right recall when index already
-- excludes dead rows.
create index idx_agents_active_dating_embedding_hnsw on public.agents
  using hnsw (embedding vector_cosine_ops)
  where status = 'active' and surface = 'dating' and embedding is not null;

-- ---------- conversations -----------------------------------------------

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  agent_a_id uuid not null references public.agents(id) on delete cascade,
  agent_b_id uuid not null references public.agents(id) on delete cascade,
  turns jsonb not null default '[]'::jsonb,
  surface ritual_surface not null default 'dating',
  created_at timestamptz not null default now(),
  -- canonical pair key — Codex recommendation to prevent A-B / B-A duplication.
  pair_key text generated always as (
    case when agent_a_id < agent_b_id
      then agent_a_id::text || '|' || agent_b_id::text
      else agent_b_id::text || '|' || agent_a_id::text
    end
  ) stored,
  constraint conversations_not_self check (agent_a_id <> agent_b_id)
);

-- UNIQUE — Codex: the previous non-unique index allowed duplicate transcripts.
create unique index conversations_pair_key_surface_unique
  on public.conversations (surface, pair_key);
create index idx_conversations_agent_a on public.conversations (agent_a_id);
create index idx_conversations_agent_b on public.conversations (agent_b_id);

-- ---------- matches ------------------------------------------------------

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  candidate_user_id uuid not null references public.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  compatibility_score real not null check (compatibility_score between 0 and 1),
  why_click text,
  watch_out text,
  highlight_quotes jsonb not null default '[]'::jsonb,
  -- Pre-rendered full transcript surfaced to the user (per v3 spec —
  -- conversations.turns stays service-role only). Codex flagged the missing column.
  rendered_transcript jsonb not null default '[]'::jsonb,
  status match_status not null default 'pending',
  world_chat_link text,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '48 hours'),
  check (user_id <> candidate_user_id)
);

create index idx_matches_user_status on public.matches (user_id, status);
create index idx_matches_candidate_status on public.matches (candidate_user_id, status);
create index idx_matches_pending on public.matches (created_at desc) where status = 'pending';

-- Partial UNIQUE prevents duplicate active match cards from concurrent jobs.
-- Codex finding HIGH-5.
create unique index matches_user_candidate_active_unique
  on public.matches (user_id, candidate_user_id)
  where status in ('pending', 'accepted', 'mutual');

-- ---------- outcome_events (THE moat data layer) -----------------------

create table public.outcome_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  match_id uuid references public.matches(id) on delete set null,
  event_type outcome_event_type not null,
  source_screen text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_outcome_user_type on public.outcome_events (user_id, event_type, created_at desc);
create index idx_outcome_match on public.outcome_events (match_id) where match_id is not null;
create index idx_outcome_recent on public.outcome_events (created_at desc);

-- ---------- reports ------------------------------------------------------

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.users(id) on delete cascade,
  reported_user_id uuid not null references public.users(id) on delete cascade,
  reason report_reason not null,
  detail text,
  created_at timestamptz not null default now(),
  unique (reporter_id, reported_user_id),
  -- Codex MEDIUM: prevent users from reporting themselves.
  constraint reports_not_self check (reporter_id <> reported_user_id)
);

create index idx_reports_reported on public.reports (reported_user_id);

-- ---------- updated_at trigger (for future tables that need it) ---------

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---------- 2-strikes auto-suspend trigger -----------------------------

create or replace function public.suspend_on_two_reports()
returns trigger as $$
declare
  report_count int;
begin
  select count(*) into report_count
    from public.reports
   where reported_user_id = new.reported_user_id;

  if report_count >= 2 then
    update public.agents
       set status = 'suspended'
     where user_id = new.reported_user_id;
  end if;

  return new;
end;
$$ language plpgsql;

create trigger reports_auto_suspend
  after insert on public.reports
  for each row execute function public.suspend_on_two_reports();

-- ---------- auth helpers ------------------------------------------------
-- Custom-claim approach for RLS (Codex review HIGH-1).
-- The app issues a JWT signed with SUPABASE_JWT_SECRET after orb verify
-- succeeds, with `world_user_id` claim set to public.users.id. RLS reads
-- this claim instead of auth.uid().

create or replace function public.current_world_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select nullif(auth.jwt() ->> 'world_user_id', '')::uuid
$$;

comment on function public.current_world_user_id() is
  'Returns the world_user_id claim from the active JWT. NULL when no JWT or claim missing. Used by RLS policies — see migration 0002.';

-- Grant execute to anon/authenticated so RLS can call it.
grant execute on function public.current_world_user_id() to anon, authenticated;
