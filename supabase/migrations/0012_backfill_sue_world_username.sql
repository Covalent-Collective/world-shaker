-- ===========================================================================
-- World Shaker — backfill: Sue's q0_world_username = 'staykeen'
--
-- WorldProfileCapture (PR #27) writes MiniKit.user.username onto the user's
-- active agent (interview_answers.q0_world_username) when the user opens the
-- app inside World App. The demo's Sue persona was seeded before that flow
-- existed, so her agent has no q0_world_username and the World Chat
-- recipient picker on /match/[id]/success can't pre-fill her real handle.
--
-- This is a one-shot demo backfill: set q0_world_username = 'staykeen' on
-- every active agent whose q0_name starts with "Sue" (case-insensitive).
-- Idempotent: only writes when the field is missing or empty.
-- ===========================================================================

begin;

update public.agents
set interview_answers = jsonb_set(
  coalesce(interview_answers, '{}'::jsonb),
  '{q0_world_username}',
  '"staykeen"'::jsonb,
  true
)
where status = 'active'
  and interview_answers->>'q0_name' ilike 'sue%'
  and coalesce(interview_answers->>'q0_world_username', '') = '';

commit;
