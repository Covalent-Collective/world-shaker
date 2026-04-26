import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { verifyWorldUserJwt, SESSION_COOKIE } from '@/lib/auth/jwt';
import { getServiceClient } from '@/lib/supabase/service';
import { getDailyQuota } from '@/lib/quota/daily';
import { rateLimit } from '@/lib/auth/rate-limit';
import { inngest } from '@/lib/inngest/client';

export const runtime = 'nodejs';

const Body = z.object({
  candidate_user_id: z.string().uuid(),
});

/**
 * POST /api/stroll/spawn
 *
 * Validates auth + quota + streaming state, then fires the
 * 'conversation/start' Inngest event and records an outcome_event of type
 * 'viewed' (counts toward daily quota).
 *
 * Returns 200 { conversation_id_pending: true } — the client navigates to
 * /conversation/pending and polls for the live conversation row.
 *
 * Auth: ws_session JWT (custom JWT — not Supabase Auth).
 * Rate-limit: 10 calls per 60 s per user (bucket 'stroll_spawn').
 */
export async function POST(req: Request): Promise<Response> {
  // ── Auth ──────────────────────────────────────────────────────────────────
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

  // ── Rate limit ────────────────────────────────────────────────────────────
  const rl = await rateLimit({
    world_user_id: worldUserId,
    bucket_key: 'stroll_spawn',
    max: 10,
    windowSeconds: 60,
  });

  if (!rl.ok) {
    return NextResponse.json(
      { error: 'rate_limited', retryAfterSeconds: rl.retryAfterSeconds },
      { status: 429 },
    );
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  const body = Body.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const { candidate_user_id } = body.data;
  const supabase = getServiceClient();

  // ── Pre-checks ────────────────────────────────────────────────────────────

  // 1. Daily quota
  const quota = await getDailyQuota(worldUserId);
  if (quota.used >= quota.max) {
    return NextResponse.json(
      { error: 'quota_exceeded', reason: 'quota_exceeded' },
      { status: 429 },
    );
  }

  // 2. streaming_paused
  const { data: settingsRow } = await supabase
    .from('app_settings')
    .select('streaming_paused')
    .limit(1)
    .single();

  if (settingsRow?.streaming_paused === true) {
    return NextResponse.json(
      { error: 'streaming_paused', reason: 'streaming_paused' },
      { status: 503 },
    );
  }

  // 3. Defense-in-depth: verify candidate is in match_candidates results
  const { data: candidates } = await supabase.rpc('match_candidates', {
    target_user: worldUserId,
    k: 10,
    mode: 'stroll_proactive',
  });

  const candidateList = Array.isArray(candidates) ? candidates : [];
  const isValidCandidate = candidateList.some(
    (c: { candidate_user: string }) => c.candidate_user === candidate_user_id,
  );

  if (!isValidCandidate) {
    return NextResponse.json({ error: 'candidate_not_found' }, { status: 404 });
  }

  // ── Look up own active agent ──────────────────────────────────────────────
  const { data: agentRow, error: agentErr } = await supabase
    .from('agents')
    .select('id')
    .eq('user_id', worldUserId)
    .eq('status', 'active')
    .limit(1)
    .single();

  if (agentErr || !agentRow) {
    return NextResponse.json({ error: 'agent_not_found' }, { status: 404 });
  }

  const ownAgentId: string = agentRow.id;

  // ── Look up candidate's active agent ─────────────────────────────────────
  const { data: candidateAgentRow, error: candidateAgentErr } = await supabase
    .from('agents')
    .select('id')
    .eq('user_id', candidate_user_id)
    .eq('status', 'active')
    .limit(1)
    .single();

  if (candidateAgentErr || !candidateAgentRow) {
    return NextResponse.json({ error: 'candidate_agent_not_found' }, { status: 404 });
  }

  const candidateAgentId: string = candidateAgentRow.id;

  // ── Compute canonical pair key (smaller UUID first) ───────────────────────
  const pairKey =
    ownAgentId < candidateAgentId
      ? `${ownAgentId}|${candidateAgentId}`
      : `${candidateAgentId}|${ownAgentId}`;

  // ── Send Inngest event ────────────────────────────────────────────────────
  await inngest.send({
    name: 'conversation/start',
    data: {
      user_id: worldUserId,
      surface: 'dating',
      agent_a_id: ownAgentId,
      agent_b_id: candidateAgentId,
      pair_key: pairKey,
      language: languagePref,
    },
  });

  // ── Record outcome_event (counts toward quota) ────────────────────────────
  await supabase.from('outcome_events').insert({
    user_id: worldUserId,
    event_type: 'viewed',
    source_screen: 'stroll',
    metadata: { candidate_user_id: candidate_user_id, agent_b_id: candidateAgentId },
  });

  return NextResponse.json({ conversation_id_pending: true });
}
