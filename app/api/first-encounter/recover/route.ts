import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyWorldUserJwt, SESSION_COOKIE } from '@/lib/auth/jwt';
import { getServiceClient } from '@/lib/supabase/service';
import { inngest } from '@/lib/inngest/client';

export const runtime = 'nodejs';

/**
 * POST /api/first-encounter/recover
 *
 * Plan source: .omc/plans/world-shaker-ux-v1-plan.md Step 3.5 + AC-21.
 *
 * Recovery condition (matches AC-21 exactly):
 *   active agent for $world_user_id AND no completed first-encounter match
 *   (i.e. no matches row with first_encounter=true AND status IN
 *   ('accepted','mutual')).
 *
 * If recovery condition is met, re-emit `agent.activated` with idempotency key
 * = `<agent_id>:first_encounter:<next_attempt>`. The next_attempt is computed
 * by counting prior `first_encounter_recovery_<agent_id>` outcome events. We
 * rely on Inngest's `id` deduplication (events sharing the same `id` within
 * the dedup window are treated as a single event), so a refresh that hits
 * this endpoint multiple times in the same attempt-window will not multi-spawn.
 *
 * Returns:
 *   { recovered: true, attempt: N }   — re-emission fired
 *   { recovered: false }              — no recovery needed
 */
export async function POST() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let claims;
  try {
    claims = await verifyWorldUserJwt(token);
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = getServiceClient();

  // Look up the user's active agent.
  const { data: agent, error: agentError } = await supabase
    .from('agents')
    .select('id')
    .eq('user_id', claims.world_user_id)
    .eq('status', 'active')
    .maybeSingle();
  if (agentError) {
    console.error('[first-encounter/recover] agent lookup error', agentError);
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 });
  }
  if (!agent) {
    // No active agent → nothing to recover.
    return NextResponse.json({ recovered: false });
  }

  // Check for an already-completed first-encounter match.
  const { data: completed, error: matchError } = await supabase
    .from('matches')
    .select('id')
    .eq('user_id', claims.world_user_id)
    .eq('first_encounter', true)
    .in('status', ['accepted', 'mutual'])
    .limit(1)
    .maybeSingle();
  if (matchError) {
    console.error('[first-encounter/recover] match lookup error', matchError);
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 });
  }
  if (completed) {
    return NextResponse.json({ recovered: false });
  }

  // Recovery condition met. Compute next attempt by counting prior
  // conversations that already involve this agent on the dating surface —
  // each first-encounter spawn produces one conversation row, so the next
  // attempt number is (existing count + 1). The idempotency key embeds this
  // attempt so Inngest's event-id deduplication blocks duplicate spawns
  // within the same attempt window (e.g. rapid app refreshes).
  const { count: priorAttempts, error: countError } = await supabase
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .or(`agent_a_id.eq.${agent.id},agent_b_id.eq.${agent.id}`)
    .eq('surface', 'dating');
  if (countError) {
    console.error('[first-encounter/recover] count error', countError);
    // Continue with attempt=1 fallback rather than failing — best-effort.
  }
  const nextAttempt = (priorAttempts ?? 0) + 1;
  const idempotencyId = `${agent.id}:first_encounter:${nextAttempt}`;

  await inngest.send({
    id: idempotencyId,
    name: 'agent.activated',
    data: {
      user_id: claims.world_user_id,
      agent_id: agent.id,
      attempt: nextAttempt,
      recovered: true,
    },
  });

  return NextResponse.json({ recovered: true, attempt: nextAttempt });
}
