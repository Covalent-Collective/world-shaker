import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { SESSION_COOKIE, verifyWorldUserJwt } from '@/lib/auth/jwt';
import { inngest } from '@/lib/inngest/client';
import { assertQuotaAvailable, getDailyQuota } from '@/lib/quota/daily';
import { getServiceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';

/**
 * POST /api/conversation/[id]/restart
 *
 * Lightweight restart route (US-307 / Step 3.6 + Step 4.5 / AC-16).
 *
 * Auth: ws_session JWT (custom auth — same pattern as /api/user/language).
 *
 * Looks up the failed conversation row (status='failed'), confirms ownership
 * (the requester must own one of the two participating agents), then sends
 * the Inngest `conversation/start` event with the same agent pair. The
 * downstream `live-conversation` Inngest function calls
 * `allocate_conversation_attempt` which serializes via advisory lock and
 * increments `attempt_number` (Step 2.7).
 *
 * The new conversation_id is determined async by the Inngest function, so
 * this route does NOT return it. The client navigates to the home page where
 * the recovery placeholder polls for the new live row (AC-21 path).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let worldUserId: string;
  let languagePref: 'ko' | 'en';
  try {
    const claims = await verifyWorldUserJwt(token);
    worldUserId = claims.world_user_id;
    languagePref = claims.language_pref;
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }

  const supabase = getServiceClient();
  const { data: conv, error } = await supabase
    .from('conversations')
    .select('id, status, surface, pair_key, agent_a_id, agent_b_id')
    .eq('id', id)
    .maybeSingle();

  if (error || !conv) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const { data: agents, error: agentsError } = await supabase
    .from('agents')
    .select('id, user_id')
    .in('id', [conv.agent_a_id, conv.agent_b_id]);

  if (agentsError || !agents || !agents.some((a) => a.user_id === worldUserId)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  if (conv.status !== 'failed') {
    return NextResponse.json({ error: 'not_failed' }, { status: 409 });
  }

  const quotaCheck = await assertQuotaAvailable(worldUserId);
  if (!quotaCheck.ok) {
    // Record wont_connect outcome so the client can surface feedback.
    await supabase.from('outcome_events').insert({
      user_id: worldUserId,
      event_type: 'wont_connect',
      source_screen: 'restart',
      metadata: { reason: 'quota_exceeded', conversation_id: id },
    });
    const { nextResetAt } = await getDailyQuota(worldUserId);
    return NextResponse.json(
      { error: 'quota_exceeded', retry_at: nextResetAt.toISOString() },
      { status: 429 },
    );
  }

  await inngest.send({
    name: 'conversation/start',
    data: {
      user_id: worldUserId,
      surface: conv.surface,
      agent_a_id: conv.agent_a_id,
      agent_b_id: conv.agent_b_id,
      language: languagePref,
    },
  });

  // The new conversation_id is allocated asynchronously by the Inngest
  // function (advisory-locked attempt allocation in Step 2.7). The client
  // polls home recovery for the new live row.
  return NextResponse.json({ restarted: true });
}
