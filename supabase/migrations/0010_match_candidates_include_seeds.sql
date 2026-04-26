-- ===========================================================================
-- World Shaker — match_candidates v3: SQL-level seed filter
--
-- Adds `include_seeds boolean DEFAULT TRUE` parameter so callers can exclude
-- seed agents before the ORDER + LIMIT, fixing the LIMIT-K exhaustion bug
-- where all top-K slots could be seeds even if real users existed beyond K.
--
-- Signature change:
--   match_candidates(uuid, int, text)                 → dropped
--   match_candidates(uuid, int, text, boolean)        → new
--
-- Callers updated in this PR:
--   * lib/inngest/functions/first-encounter.ts
--   * app/api/stroll/spawn/route.ts
--   * app/(app)/stroll/page.tsx
-- ===========================================================================

begin;

drop function if exists public.match_candidates(uuid, int, text);

create or replace function public.match_candidates(
  target_user uuid,
  k int,
  mode text default 'system_generated',
  include_seeds boolean default true
)
returns table(candidate_user uuid, score real, is_seed boolean)
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
        )::real as score,
        c.is_seed
      from public.agents c
      join public.agents target_a on target_a.user_id = target_user
      where c.user_id <> target_user
        and c.status = 'active'
        and c.embedding is not null
        and target_a.embedding is not null
        and (include_seeds or not c.is_seed)
        -- stroll_proactive: exclude self, inactive, accepted/mutual either direction,
        -- AND outgoing pending; admit incoming pending ONLY when
        -- origin='user_initiated_proactive'.
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
        )::real as score,
        c.is_seed
      from public.agents c
      join public.agents target_a on target_a.user_id = target_user
      where c.user_id <> target_user
        and c.status = 'active'
        and c.embedding is not null
        and target_a.embedding is not null
        and (include_seeds or not c.is_seed)
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

revoke execute on function public.match_candidates(uuid, int, text, boolean) from public, anon, authenticated;
grant execute on function public.match_candidates(uuid, int, text, boolean) to service_role;

commit;
