-- ===========================================================================
-- World Shaker — Normalized conversation_turns table (US-002)
--
-- Source: .omc/plans/world-shaker-ux-v1-plan.md (v4) Step 1.1b
-- Replaces conversations.turns JSONB column.
--
-- v4 design notes:
--   * UNIQUE (conversation_id, turn_index) is the DB-level idempotency key
--     for AC-6 and Step 2.7 atomic INSERT ... ON CONFLICT DO NOTHING.
--   * Backfill uses explicit speaker mapping: t->>'speaker' = 'A' -> agent_a_id,
--     'B' -> agent_b_id. NULL speaker_agent_id rows are rejected via assertion.
--   * No pg_notify trigger. Supabase Realtime is the broadcast layer
--     (postgres_changes via logical replication). Works on Vercel serverless
--     because subscription is one WebSocket per Node process, not one pg
--     connection per stream.
--   * Service-role-only: no RLS policies. Parent conversations table is
--     already service-role-only per 0002_rls.sql:38-41; SSE relay route
--     (Step 2.8) is whitelisted in getServiceClient() per AC-20.
-- ===========================================================================

create table if not exists public.conversation_turns (
  id              bigserial primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  turn_index      int not null check (turn_index >= 0),
  speaker_agent_id uuid not null references public.agents(id),
  text            text not null,
  moderation_status text not null default 'pending'
    check (moderation_status in ('pending', 'clean', 'flagged', 'dropped')),
  token_count     int,
  created_at      timestamptz not null default now(),
  unique (conversation_id, turn_index)
);

create index if not exists idx_conversation_turns_conv_turn
  on public.conversation_turns (conversation_id, turn_index);

-- ---------- backfill from conversations.turns JSONB --------------------
-- Wrap in DO block so we can short-circuit cleanly when the JSONB column
-- has already been dropped in an earlier run (idempotent re-apply).
do $$
declare
  has_turns_col boolean;
  bad_speaker_count int;
  conv_count int;
  turn_total int;
begin
  select exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'conversations'
       and column_name  = 'turns'
  ) into has_turns_col;

  if not has_turns_col then
    raise notice 'conversations.turns column already dropped; backfill skipped';
    return;
  end if;

  -- Insert backfill rows. ON CONFLICT DO NOTHING makes re-runs idempotent.
  insert into public.conversation_turns
    (conversation_id, turn_index, speaker_agent_id, text)
  select
    c.id,
    (idx - 1)::int as turn_index,
    case t->>'speaker'
      when 'A' then c.agent_a_id
      when 'B' then c.agent_b_id
      else null
    end as speaker_agent_id,
    coalesce(t->>'text', '') as text
  from public.conversations c,
       jsonb_array_elements(c.turns) with ordinality as arr(t, idx)
  where c.turns is not null
    and jsonb_array_length(c.turns) > 0
  on conflict (conversation_id, turn_index) do nothing;

  -- Assertion: reject any rows where mapping produced NULL speaker.
  select count(*) into bad_speaker_count
    from public.conversation_turns
   where speaker_agent_id is null;

  if bad_speaker_count > 0 then
    raise exception
      'backfill produced % conversation_turns with NULL speaker_agent_id; '
      'inspect source conversations.turns for invalid speaker tokens',
      bad_speaker_count;
  end if;

  -- Verification: per-conversation row count must match jsonb_array_length.
  select count(*) into conv_count
    from public.conversations c
   where c.turns is not null
     and jsonb_array_length(c.turns) <> (
       select count(*) from public.conversation_turns ct
        where ct.conversation_id = c.id
     );

  if conv_count > 0 then
    raise exception
      'backfill verification failed: % conversations have row-count mismatch '
      'between conversations.turns and conversation_turns',
      conv_count;
  end if;

  select coalesce(sum(jsonb_array_length(turns)), 0) into turn_total
    from public.conversations
   where turns is not null;

  raise notice 'conversation_turns backfill verified: % source turns reconciled', turn_total;
end$$;

-- ---------- drop legacy JSONB column AFTER verification ----------------
alter table public.conversations drop column if exists turns;

-- ---------- RLS: service-role-only --------------------------------------
alter table public.conversation_turns enable row level security;
-- No policies created. Server reads via getServiceClient() in the SSE relay
-- route (AC-20 whitelist). Mirrors conversations parent contract.

-- ---------- Supabase Realtime publication -------------------------------
-- Use logical replication for INSERT broadcasts to subscribers in
-- /api/conversation/[id]/stream/route.ts (Step 2.8). The publication may
-- already exist on the project; create if missing then add the table.
do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;
end$$;

-- ALTER PUBLICATION ... ADD TABLE has no IF NOT EXISTS form; guard manually.
do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname    = 'supabase_realtime'
       and schemaname = 'public'
       and tablename  = 'conversation_turns'
  ) then
    alter publication supabase_realtime add table public.conversation_turns;
  end if;
end$$;
