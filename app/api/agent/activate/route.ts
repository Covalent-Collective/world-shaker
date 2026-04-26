import 'server-only';

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { verifyWorldUserJwt, SESSION_COOKIE } from '@/lib/auth/jwt';
import { getServiceClient } from '@/lib/supabase/service';
import { inngest } from '@/lib/inngest/client';

export const runtime = 'nodejs';

/**
 * POST /api/agent/activate
 *
 * Called by InterviewClient after the user completes all interview questions.
 * Looks up the user's active agent and emits the `agent.activated` Inngest
 * event so downstream functions (first-encounter match, etc.) can trigger.
 *
 * Auth: ws_session cookie verified via verifyWorldUserJwt.
 * Returns 401 if cookie is missing or invalid.
 * Returns 404 if the user has no active agent.
 * Returns 200 { activated: true, agent_id } on success.
 */
export async function POST() {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (!token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let world_user_id: string;
  try {
    const claims = await verifyWorldUserJwt(token);
    world_user_id = claims.world_user_id;
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // ── Look up active agent ──────────────────────────────────────────────────
  const db = getServiceClient();

  const { data: agent, error: agentError } = await db
    .from('agents')
    .select('id')
    .eq('user_id', world_user_id)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (agentError) {
    console.error('[agent/activate] agent lookup error', agentError);
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 });
  }

  if (!agent) {
    return NextResponse.json({ error: 'no_active_agent' }, { status: 404 });
  }

  // ── Emit Inngest event ────────────────────────────────────────────────────
  await inngest.send({
    name: 'agent.activated',
    data: {
      user_id: world_user_id,
      agent_id: agent.id,
    },
  });

  return NextResponse.json({ activated: true, agent_id: agent.id });
}
