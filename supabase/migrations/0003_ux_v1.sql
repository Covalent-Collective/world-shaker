-- ===========================================================================
-- World Shaker — UX v1 schema additions (US-001)
--
-- Source: .omc/plans/world-shaker-ux-v1-plan.md (v4) Step 1.1
-- Companion rollback: 0003_rollback.sql (manual recovery only)
--
-- Additive only. Backfills + state-machine + attempt-aware uniqueness.
-- v4 residual fixes applied:
--   * conversations.status backfill = 'completed' for existing rows; new rows
--     default to 'live' (two-step ALTER pattern)
--   * matches partial UNIQUE keyed on origin to allow dual-track parallelism
--   * conversations pair_key uniqueness split: per-attempt full UNIQUE +
--     partial UNIQUE on (surface, pair_key) WHERE status='live'
--   * status transition trigger BEFORE UPDATE enforces:
--       live -> {completed, abandoned, failed}; terminal states immutable
--   * matches.first_encounter marks rows produced by the first-encounter
--     pipeline (consumed by AC-21 recovery check in Step 3.5)
-- ===========================================================================

-- ---------- agents additions --------------------------------------------

alter table public.agents
  add column if not exists avatar_url text,
  add column if not exists avatar_generated_at timestamptz,
  add column if not exists language_pref text check (language_pref in ('ko', 'en')),
  add column if not exists is_seed boolean not null default false,
  add column if not exists growth_log jsonb not null default '[]'::jsonb;

-- ---------- users additions ---------------------------------------------

alter table public.users
  add column if not exists language_pref text not null default 'ko',
  add column if not exists timezone text not null default 'Asia/Seoul',
  add column if not exists posthog_cohort text;

-- Enforce language_pref domain via CHECK to mirror agents.language_pref.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_language_pref_check'
  ) then
    alter table public.users
      add constraint users_language_pref_check check (language_pref in ('ko', 'en'));
  end if;
end$$;

-- ---------- matches additions -------------------------------------------

alter table public.matches
  add column if not exists origin text not null default 'system_generated'
    check (origin in ('system_generated', 'user_initiated_proactive', 'encounter_spawned')),
  add column if not exists starters jsonb,
  add column if not exists first_encounter boolean not null default false;

-- ---------- conversations: status state machine + attempt model --------
-- Step 1: add status with default 'completed' so existing rows backfill cleanly.
alter table public.conversations
  add column if not exists status text not null default 'completed'
    check (status in ('live', 'completed', 'abandoned', 'failed'));

-- Step 2: flip default for new rows to 'live'.
alter table public.conversations
  alter column status set default 'live';

alter table public.conversations
  add column if not exists attempt_number int not null default 1,
  add column if not exists last_turn_emitted_at timestamptz;

-- ---------- transition guard trigger ------------------------------------
-- Enforces:
--   * live -> {completed, abandoned, failed}
--   * terminal states (completed/abandoned/failed) are immutable for status
create or replace function public.conversations_status_transition_guard()
returns trigger
language plpgsql
as $$
begin
  if old.status = new.status then
    return new;
  end if;

  if old.status = 'live'
     and new.status in ('completed', 'abandoned', 'failed') then
    return new;
  end if;

  raise exception
    'invalid conversation status transition: % -> %', old.status, new.status
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists conversations_status_transition_guard on public.conversations;
create trigger conversations_status_transition_guard
  before update of status on public.conversations
  for each row execute function public.conversations_status_transition_guard();

-- ---------- conversations uniqueness: replace v0 pair_key UNIQUE -------
-- Old contract: at most one row per (surface, pair_key). Blocks retries.
-- New contract:
--   * full UNIQUE per attempt: (surface, pair_key, attempt_number)
--   * partial UNIQUE on live rows: (surface, pair_key) WHERE status='live'
--     guarantees at most one live conversation per pair on a surface;
--     historic terminal rows preserved per attempt for retry analytics.
drop index if exists public.conversations_pair_key_surface_unique;

create unique index if not exists conversations_pair_key_surface_attempt_unique
  on public.conversations (surface, pair_key, attempt_number);

create unique index if not exists conversations_pair_key_surface_live_unique
  on public.conversations (surface, pair_key)
  where status = 'live';

-- ---------- matches uniqueness: origin-aware partial UNIQUE ------------
-- Old contract: (user_id, candidate_user_id) WHERE status IN
-- ('pending','accepted','mutual'). Blocks dual-track (system_generated +
-- user_initiated_proactive) collisions.
-- New contract: same predicate, key includes origin so two tracks may
-- coexist for the same pair simultaneously.
drop index if exists public.matches_user_candidate_active_unique;

create unique index if not exists matches_user_candidate_origin_active_unique
  on public.matches (user_id, candidate_user_id, origin)
  where status in ('pending', 'accepted', 'mutual');
