-- ===========================================================================
-- World Shaker — RLS additions for UX v1 columns (US-003)
--
-- Source: .omc/plans/world-shaker-ux-v1-plan.md (v4) Step 1.2
--
-- Scope:
--   * users may UPDATE only language_pref + timezone on their own row.
--   * agents owners may UPDATE avatar_url, growth_log, language_pref on
--     their own agent row.
--   * conversations + conversation_turns remain service-role-only. The
--     SSE relay route (app/api/conversation/[id]/stream/route.ts) is
--     whitelisted to use getServiceClient() per AC-20 — see header
--     comment in lib/supabase/server.ts and the allowlist file
--     .omc/plans/service-client-allowlist.txt.
-- ===========================================================================

-- ---------- users: scoped UPDATE on language_pref + timezone -----------
revoke update on public.users from authenticated;
grant update (language_pref, timezone) on public.users to authenticated;

drop policy if exists users_update_own_language on public.users;
create policy users_update_own_language on public.users
  for update to authenticated
  using (public.current_world_user_id() = id)
  with check (public.current_world_user_id() = id);

-- ---------- agents: scoped UPDATE on avatar_url, growth_log, language_pref
revoke update on public.agents from authenticated;
grant update (avatar_url, growth_log, language_pref) on public.agents to authenticated;

drop policy if exists agents_update_own_growth on public.agents;
create policy agents_update_own_growth on public.agents
  for update to authenticated
  using (public.current_world_user_id() = user_id)
  with check (public.current_world_user_id() = user_id);

-- ---------- conversations + conversation_turns: NO client policies -----
-- Both tables stay service-role-only. SSE relay (Node runtime) reads via
-- getServiceClient() and shapes turns for the client. See AC-20 whitelist
-- in lib/supabase/server.ts header and .omc/plans/service-client-allowlist.txt.
