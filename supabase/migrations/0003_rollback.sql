-- ===========================================================================
-- World Shaker — UX v1 ROLLBACK companion (US-006)
--
-- DO NOT auto-run. Manual recovery only. Run with explicit operator approval
-- after taking a DB snapshot.
--
-- Reverses migrations 0003 / 0003b / 0004 / 0005 / 0006.
--
-- Notes:
--   * Idempotent via IF EXISTS / IF NOT EXISTS guards.
--   * conversation_turns is dropped destructively. To restore the legacy
--     conversations.turns JSONB structure, run the optional restore block
--     at the bottom of this file BEFORE dropping the conversation_turns
--     table. (Block is commented out by default for safety.)
--   * Recreates the v0 unique indexes that 0003 replaced
--     (conversations_pair_key_surface_unique,
--      matches_user_candidate_active_unique).
-- ===========================================================================

-- ---------- 0006: drop functions ---------------------------------------
drop function if exists public.reset_moderation_breaker(text);
drop function if exists public.increment_moderation_breaker_failures(text);
drop function if exists public.append_turn_with_ledger(
  uuid, int, uuid, text, int, uuid, int, int, numeric, text
);
drop function if exists public.allocate_conversation_attempt(
  text, text, uuid, uuid
);
drop function if exists public.match_candidates(uuid, int, text);
drop function if exists public.structured_feature_score(jsonb, jsonb);

-- ---------- 0005: drop app_settings + ledger + rate_limit_buckets ------
drop table if exists public.rate_limit_buckets;
drop table if exists public.llm_budget_ledger;
drop table if exists public.app_settings;

-- ---------- 0004: revert RLS additions ---------------------------------
drop policy if exists agents_update_own_growth on public.agents;
drop policy if exists users_update_own_language on public.users;

-- Restore broad UPDATE grants that 0004 narrowed.
revoke update on public.agents from authenticated;
grant  update on public.agents to authenticated;

revoke update on public.users from authenticated;
grant  update on public.users to authenticated;

-- ---------- 0003b: drop normalized turns table -------------------------
-- OPTIONAL restore-to-JSONB block (uncomment BEFORE dropping table if you
-- need to preserve transcript content in the legacy column shape):
--
-- alter table public.conversations
--   add column if not exists turns jsonb not null default '[]'::jsonb;
--
-- update public.conversations c
--    set turns = sub.turns
--    from (
--      select ct.conversation_id,
--             jsonb_agg(
--               jsonb_build_object(
--                 'speaker', case
--                              when ct.speaker_agent_id = c2.agent_a_id then 'A'
--                              when ct.speaker_agent_id = c2.agent_b_id then 'B'
--                              else null
--                            end,
--                 'text', ct.text
--               )
--               order by ct.turn_index
--             ) as turns
--        from public.conversation_turns ct
--        join public.conversations c2 on c2.id = ct.conversation_id
--       group by ct.conversation_id
--    ) sub
--   where c.id = sub.conversation_id;

-- Remove from realtime publication first (best-effort).
do $$
begin
  if exists (
    select 1
      from pg_publication_tables
     where pubname    = 'supabase_realtime'
       and schemaname = 'public'
       and tablename  = 'conversation_turns'
  ) then
    alter publication supabase_realtime drop table public.conversation_turns;
  end if;
end$$;

drop table if exists public.conversation_turns;

-- ---------- 0003: drop additive columns / triggers / indexes -----------

-- conversations: remove transition trigger, attempt model, status column,
-- and uniqueness changes.
drop trigger  if exists conversations_status_transition_guard on public.conversations;
drop function if exists public.conversations_status_transition_guard();

drop index if exists public.conversations_pair_key_surface_live_unique;
drop index if exists public.conversations_pair_key_surface_attempt_unique;

-- Restore v0 UNIQUE.
create unique index if not exists conversations_pair_key_surface_unique
  on public.conversations (surface, pair_key);

alter table public.conversations
  drop column if exists last_turn_emitted_at,
  drop column if exists attempt_number,
  drop column if exists status;

-- matches: revert origin-aware UNIQUE.
drop index if exists public.matches_user_candidate_origin_active_unique;

create unique index if not exists matches_user_candidate_active_unique
  on public.matches (user_id, candidate_user_id)
  where status in ('pending', 'accepted', 'mutual');

alter table public.matches
  drop column if exists first_encounter,
  drop column if exists starters,
  drop column if exists origin;

-- users: drop additive columns + check.
do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'users_language_pref_check'
  ) then
    alter table public.users drop constraint users_language_pref_check;
  end if;
end$$;

alter table public.users
  drop column if exists posthog_cohort,
  drop column if exists timezone,
  drop column if exists language_pref;

-- agents: drop additive columns.
alter table public.agents
  drop column if exists growth_log,
  drop column if exists is_seed,
  drop column if exists language_pref,
  drop column if exists avatar_generated_at,
  drop column if exists avatar_url;
