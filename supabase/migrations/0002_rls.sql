-- ===========================================================================
-- World Shaker — Row Level Security
--
-- Per Codex audit (commit 22427c6 review):
--   * conversations and agents.extracted_features must NEVER reach the client.
--   * Identity comes from the `world_user_id` JWT claim, NOT auth.uid().
--     The app issues a JWT signed with SUPABASE_JWT_SECRET after orb verify.
--   * Matches: only `status` and `accepted_at` are user-mutable. Other columns
--     are server-managed.
--   * outcome_events INSERT must verify match_id ownership too.
-- ===========================================================================

-- Enable RLS on every public table.
alter table public.users          enable row level security;
alter table public.auth_nonces    enable row level security;
alter table public.agents         enable row level security;
alter table public.conversations  enable row level security;
alter table public.matches        enable row level security;
alter table public.outcome_events enable row level security;
alter table public.reports        enable row level security;

-- ---------- users --------------------------------------------------------

create policy users_select_own on public.users
  for select to authenticated
  using (public.current_world_user_id() = id);

-- ---------- auth_nonces -------------------------------------------------
-- Service-role only. No client access ever.

-- ---------- agents -------------------------------------------------------
-- Each user reads their own agent. Other users' embedding/features stay server-side.

create policy agents_select_own on public.agents
  for select to authenticated
  using (public.current_world_user_id() = user_id);

-- ---------- conversations ------------------------------------------------
-- HARD BLOCK from clients. Transcripts surface only via the matches table
-- (rendered_transcript / why_click / watch_out / highlight_quotes columns).
-- Service role only — no SELECT/INSERT/UPDATE/DELETE policy intentionally.

-- ---------- matches ------------------------------------------------------

create policy matches_select_own on public.matches
  for select to authenticated
  using (public.current_world_user_id() = user_id);

-- Codex HIGH-3: revoke broad UPDATE, grant only the columns a user can
-- legitimately set when accepting/skipping. score, why_click, etc. stay
-- service-role-managed.
revoke update on public.matches from authenticated;
grant update (status, accepted_at) on public.matches to authenticated;

create policy matches_update_own_decision on public.matches
  for update to authenticated
  using (public.current_world_user_id() = user_id)
  with check (
    public.current_world_user_id() = user_id
    and status in ('accepted', 'skipped')
  );

-- ---------- outcome_events ----------------------------------------------
-- A user can insert events scoped to their own user_id (telemetry from app).
-- Codex MEDIUM: verify match_id ownership too — otherwise clients can
-- poison telemetry by referencing other users' matches.

create policy outcome_insert_own on public.outcome_events
  for insert to authenticated
  with check (
    public.current_world_user_id() = user_id
    and (
      match_id is null
      or exists (
        select 1 from public.matches m
        where m.id = outcome_events.match_id
          and m.user_id = public.current_world_user_id()
      )
    )
  );

create policy outcome_select_own on public.outcome_events
  for select to authenticated
  using (public.current_world_user_id() = user_id);

-- ---------- reports ------------------------------------------------------
-- A user files reports as themselves. Cannot read others' reports.
-- Relationship validation (must have an existing match with reported user)
-- is enforced in the route handler — RLS only validates identity here.

create policy reports_insert_own on public.reports
  for insert to authenticated
  with check (public.current_world_user_id() = reporter_id);

create policy reports_select_own on public.reports
  for select to authenticated
  using (public.current_world_user_id() = reporter_id);
