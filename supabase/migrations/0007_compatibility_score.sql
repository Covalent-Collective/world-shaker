-- ===========================================================================
-- World Shaker — match_candidates + structured_feature_score + atomic RPCs (US-005)
--
-- Source: .omc/plans/world-shaker-ux-v1-plan.md (v4) Step 1.4 + Step 2.7
--
-- Functions defined here:
--   * structured_feature_score(jsonb, jsonb) -> real
--       Penalty for contradictions on age-band/values/lifestyle keys.
--       Bonus for shared interests. Clamped to [0, 1].
--   * match_candidates(target_user uuid, k int, mode text) -> table
--       Reads weights from app_settings. mode-aware exclusion clause.
--       STABLE, SECURITY DEFINER, granted to service_role only.
--   * allocate_conversation_attempt(p_surface text, p_pair_key text,
--                                   p_agent_a uuid, p_agent_b uuid) -> uuid
--       Wraps pg_advisory_xact_lock + INSERT inside a single transaction.
--       Computes next attempt_number and returns the new conversation id.
--   * append_turn_with_ledger(p_conv_id, p_turn_index, p_speaker_agent_id,
--                             p_text, p_token_count, p_user_id,
--                             p_tokens_input, p_tokens_output,
--                             p_cost_usd, p_model) -> bool
--       Single transaction: INSERT conversation_turns ON CONFLICT DO NOTHING +
--       INSERT llm_budget_ledger ON CONFLICT (conversation_id, turn_index)
--       DO NOTHING. Returns true if turn inserted, false on duplicate retry
--       (caller skips double-charge accounting).
--   * increment_moderation_breaker_failures(p_provider text) -> jsonb
--       Atomic UPDATE on app_settings using FOR UPDATE row lock.
--   * reset_moderation_breaker(p_provider text) -> void
--       Clears the provider's breaker state on half-open success.
--
-- Unit-test plan (covered by US-009 vitest tests):
--   * structured_feature_score: identity pair -> 1; opposing age-band -> <0.5
--   * match_candidates(mode='system_generated'): pre-existing pending -> excluded
--   * match_candidates(mode='stroll_proactive'): incoming pending
--     user_initiated_proactive -> included; accepted -> still excluded
--   * allocate_conversation_attempt: concurrent callers serialize via
--     advisory lock; attempt_number monotonically increases per (surface,
--     pair_key)
--   * append_turn_with_ledger: idempotent duplicate retry returns false and
--     leaves both tables unchanged
-- ===========================================================================

-- ---------- structured_feature_score -----------------------------------
create or replace function public.structured_feature_score(
  a jsonb,
  b jsonb
)
returns real
language plpgsql
stable
as $$
declare
  age_a text := coalesce(a->>'age_band', '');
  age_b text := coalesce(b->>'age_band', '');
  values_a text := coalesce(a->>'values', '');
  values_b text := coalesce(b->>'values', '');
  lifestyle_a text := coalesce(a->>'lifestyle', '');
  lifestyle_b text := coalesce(b->>'lifestyle', '');
  interests_a jsonb := coalesce(a->'interests', '[]'::jsonb);
  interests_b jsonb := coalesce(b->'interests', '[]'::jsonb);
  shared_interests int := 0;
  union_interests int := 0;
  base real := 0.5;
  penalty real := 0.0;
  bonus real := 0.0;
  jaccard real := 0.0;
  result real;
begin
  -- Penalty: hard contradictions on structured keys.
  if age_a <> '' and age_b <> '' and age_a <> age_b then
    penalty := penalty + 0.15;
  end if;
  if values_a <> '' and values_b <> '' and values_a <> values_b then
    penalty := penalty + 0.20;
  end if;
  if lifestyle_a <> '' and lifestyle_b <> '' and lifestyle_a <> lifestyle_b then
    penalty := penalty + 0.10;
  end if;

  -- Bonus: Jaccard similarity over interests array.
  if jsonb_typeof(interests_a) = 'array'
     and jsonb_typeof(interests_b) = 'array' then
    select count(*)
      into shared_interests
      from (
        select x from jsonb_array_elements_text(interests_a) as x
        intersect
        select x from jsonb_array_elements_text(interests_b) as x
      ) s;

    select count(*)
      into union_interests
      from (
        select x from jsonb_array_elements_text(interests_a) as x
        union
        select x from jsonb_array_elements_text(interests_b) as x
      ) u;

    if union_interests > 0 then
      jaccard := shared_interests::real / union_interests::real;
      bonus := jaccard * 0.3;
    end if;
  end if;

  result := base + bonus - penalty;
  if result < 0 then
    result := 0;
  elsif result > 1 then
    result := 1;
  end if;

  return result;
end;
$$;

revoke all on function public.structured_feature_score(jsonb, jsonb) from public;
grant execute on function public.structured_feature_score(jsonb, jsonb) to service_role;

-- ---------- match_candidates -------------------------------------------
create or replace function public.match_candidates(
  target_user uuid,
  k int,
  mode text default 'system_generated'
)
returns table (candidate_user uuid, score real)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  w_cosine numeric;
  w_struct numeric;
begin
  select match_weight_cosine, match_weight_struct
    into w_cosine, w_struct
    from public.app_settings
   where id = 1;

  if w_cosine is null then
    w_cosine := 0.60;
    w_struct := 0.40;
  end if;

  if mode = 'stroll_proactive' then
    return query
      select
        c.user_id as candidate_user,
        (
          (w_cosine::real) * (1 - (target_a.embedding <=> c.embedding))
          + (w_struct::real)
            * public.structured_feature_score(target_a.extracted_features,
                                              c.extracted_features)
        )::real as score
      from public.agents c
      join public.agents target_a on target_a.user_id = target_user
      where c.user_id <> target_user
        and c.status = 'active'
        and c.embedding is not null
        and target_a.embedding is not null
        -- stroll_proactive: exclude self, inactive, accepted/mutual either direction,
        -- AND outgoing pending; admit incoming pending ONLY when
        -- origin='user_initiated_proactive'.
        --
        -- Asymmetry rationale: a user-initiated proactive match (origin=
        -- 'user_initiated_proactive') coming IN means another user already chose
        -- this candidate — surfacing them again is desirable so target_user can
        -- accept. By contrast, system-generated incoming pending rows represent
        -- background algorithmic queuing; re-surfacing those would duplicate the
        -- system pipeline, so they are excluded via the origin filter.
        and not exists (
          select 1 from public.matches m
          where (
            (m.user_id = target_user and m.candidate_user_id = c.user_id and m.status in ('accepted','mutual'))
            or (m.user_id = c.user_id and m.candidate_user_id = target_user and m.status in ('accepted','mutual'))
            or (m.user_id = target_user and m.candidate_user_id = c.user_id and m.status = 'pending')
            or (m.user_id = c.user_id and m.candidate_user_id = target_user and m.status = 'pending' and m.origin <> 'user_initiated_proactive')
          )
        )
      order by score desc
      limit k;
  else
    -- 'system_generated' (default) — strict exclusion: no pending in either
    -- direction, no accepted/mutual.
    return query
      select
        c.user_id as candidate_user,
        (
          (w_cosine::real) * (1 - (target_a.embedding <=> c.embedding))
          + (w_struct::real)
            * public.structured_feature_score(target_a.extracted_features,
                                              c.extracted_features)
        )::real as score
      from public.agents c
      join public.agents target_a on target_a.user_id = target_user
      where c.user_id <> target_user
        and c.status = 'active'
        and c.embedding is not null
        and target_a.embedding is not null
        and not exists (
          select 1
            from public.matches m
           where (
                  (m.user_id = target_user and m.candidate_user_id = c.user_id)
               or (m.user_id = c.user_id and m.candidate_user_id = target_user)
             )
             and m.status in ('pending', 'accepted', 'mutual')
        )
      order by score desc
      limit k;
  end if;
end;
$$;

revoke all on function public.match_candidates(uuid, int, text) from public;
grant execute on function public.match_candidates(uuid, int, text) to service_role;

-- ---------- allocate_conversation_attempt -------------------------------
-- Wraps the BEGIN/pg_advisory_xact_lock/INSERT pattern from Step 2.7.
-- Caller must use service-role JWT to invoke via supabase-js .rpc().
create or replace function public.allocate_conversation_attempt(
  p_surface  text,
  p_pair_key text,
  p_agent_a  uuid,
  p_agent_b  uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt int;
  v_id      uuid;
  v_surface ritual_surface;
begin
  -- Cast surface text to enum; will raise if value is invalid.
  v_surface := p_surface::ritual_surface;

  perform pg_advisory_xact_lock(hashtext(p_surface || ':' || p_pair_key));

  select coalesce(max(attempt_number) + 1, 1)
    into v_attempt
    from public.conversations
   where surface  = v_surface
     and pair_key = p_pair_key;

  insert into public.conversations
    (agent_a_id, agent_b_id, surface, status, attempt_number)
  values
    (p_agent_a, p_agent_b, v_surface, 'live', v_attempt)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.allocate_conversation_attempt(text, text, uuid, uuid) from public;
grant execute on function public.allocate_conversation_attempt(text, text, uuid, uuid) to service_role;

-- ---------- append_turn_with_ledger -------------------------------------
-- Single transaction. Returns true if a new turn row was created;
-- false if the (conversation_id, turn_index) already existed (duplicate
-- Inngest retry — caller should NOT double-charge accounting elsewhere).
create or replace function public.append_turn_with_ledger(
  p_conv_id          uuid,
  p_turn_index       int,
  p_speaker_agent_id uuid,
  p_text             text,
  p_token_count      int,
  p_user_id          uuid,
  p_tokens_input     int,
  p_tokens_output    int,
  p_cost_usd         numeric,
  p_model            text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted_turn_id bigint;
begin
  insert into public.conversation_turns
    (conversation_id, turn_index, speaker_agent_id, text, token_count)
  values
    (p_conv_id, p_turn_index, p_speaker_agent_id, p_text, p_token_count)
  on conflict (conversation_id, turn_index) do nothing
  returning id into v_inserted_turn_id;

  -- Always attempt the ledger insert. ON CONFLICT DO NOTHING keeps it
  -- atomic with the turn insert: either both rows exist, or both already
  -- existed from a prior attempt. Never double-charges.
  insert into public.llm_budget_ledger
    (user_id, conversation_id, turn_index, tokens_input, tokens_output,
     cost_usd, model)
  values
    (p_user_id, p_conv_id, p_turn_index, p_tokens_input, p_tokens_output,
     p_cost_usd, p_model)
  on conflict (conversation_id, turn_index) do nothing;

  return v_inserted_turn_id is not null;
end;
$$;

revoke all on function public.append_turn_with_ledger(
  uuid, int, uuid, text, int, uuid, int, int, numeric, text
) from public;
grant execute on function public.append_turn_with_ledger(
  uuid, int, uuid, text, int, uuid, int, int, numeric, text
) to service_role;

-- ---------- increment_moderation_breaker_failures -----------------------
-- Atomic UPDATE on app_settings; uses FOR UPDATE row lock. Returns the
-- new breaker state for the provider as JSONB:
--   { "failures": <int>, "opened_at": <timestamptz> }
create or replace function public.increment_moderation_breaker_failures(
  p_provider text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state jsonb;
  v_failures int;
  v_new_state jsonb;
begin
  -- Lock the singleton row.
  perform 1 from public.app_settings where id = 1 for update;

  select coalesce(moderation_breaker_state -> p_provider, '{}'::jsonb)
    into v_state
    from public.app_settings
   where id = 1;

  v_failures := coalesce((v_state ->> 'failures')::int, 0) + 1;

  v_new_state := jsonb_build_object(
    'failures',  v_failures,
    'opened_at', to_jsonb(now())
  );

  update public.app_settings
     set moderation_breaker_state =
           jsonb_set(moderation_breaker_state, array[p_provider], v_new_state)
   where id = 1;

  return v_new_state;
end;
$$;

revoke all on function public.increment_moderation_breaker_failures(text) from public;
grant execute on function public.increment_moderation_breaker_failures(text) to service_role;

-- ---------- reset_moderation_breaker -----------------------------------
create or replace function public.reset_moderation_breaker(p_provider text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1 from public.app_settings where id = 1 for update;

  update public.app_settings
     set moderation_breaker_state =
           moderation_breaker_state - p_provider
   where id = 1;
end;
$$;

revoke all on function public.reset_moderation_breaker(text) from public;
grant execute on function public.reset_moderation_breaker(text) to service_role;
