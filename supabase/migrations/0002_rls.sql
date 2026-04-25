-- ===========================================================================
-- World Shaker — Row Level Security
--
-- Per Codex audit: conversations and agent extracted_features must NEVER
-- reach the client. Service-role only.
-- ===========================================================================

-- Enable RLS on every public table.
alter table public.users          enable row level security;
alter table public.agents         enable row level security;
alter table public.conversations  enable row level security;
alter table public.matches        enable row level security;
alter table public.outcome_events enable row level security;
alter table public.reports        enable row level security;

-- ---------- users --------------------------------------------------------
-- Each user can read their own row. Insert/update/delete via service role.

create policy users_select_own on public.users
  for select using (auth.uid() = id);

-- ---------- agents -------------------------------------------------------
-- A user reads their own agent. NOT the embedding or extracted_features
-- of others. Match candidate features stay server-side.

create policy agents_select_own on public.agents
  for select using (auth.uid() = user_id);

-- ---------- conversations ------------------------------------------------
-- HARD BLOCK from clients. Transcripts surface only via the matches table
-- (pre-rendered why_click / watch_out / highlight_quotes columns).
-- Service role only — no SELECT policy intentionally.

-- ---------- matches ------------------------------------------------------
-- A user reads matches where they are user_id (their own perspective).
-- They never directly query candidate_user_id direction.

create policy matches_select_own on public.matches
  for select using (auth.uid() = user_id);

-- A user can update their own match decision (status to accepted/skipped).
create policy matches_update_own_decision on public.matches
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id and status in ('accepted', 'skipped'));

-- ---------- outcome_events ----------------------------------------------
-- A user can insert events scoped to their own user_id (telemetry from app).
-- They can read their own events (e.g., "did I vouch for X yet?").
-- Aggregations across users are server-side only.

create policy outcome_insert_own on public.outcome_events
  for insert with check (auth.uid() = user_id);

create policy outcome_select_own on public.outcome_events
  for select using (auth.uid() = user_id);

-- ---------- reports ------------------------------------------------------
-- A user can file reports as themselves. Cannot read others' reports.

create policy reports_insert_own on public.reports
  for insert with check (auth.uid() = reporter_id);

create policy reports_select_own on public.reports
  for select using (auth.uid() = reporter_id);
