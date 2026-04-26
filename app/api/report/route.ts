import { NextResponse } from 'next/server';
import { z } from 'zod';
import { cookies } from 'next/headers';
import { verifyWorldUserJwt, SESSION_COOKIE } from '@/lib/auth/jwt';
import { rateLimit } from '@/lib/auth/rate-limit';
import { getServiceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';

const Body = z
  .object({
    match_id: z.string().uuid().optional(),
    conversation_id: z.string().uuid().optional(),
    reason: z.enum(['harassment', 'hateful', 'catfish', 'underage', 'nsfw', 'spam', 'other']),
    detail: z.string().max(500).optional(),
  })
  .refine((d) => d.match_id || d.conversation_id, {
    message: 'must provide match_id or conversation_id',
  });

/**
 * POST /api/report
 *
 * Submits a user report. Auth via ws_session JWT cookie.
 * reported_user_id is derived server-side from match_id or conversation_id —
 * never accepted from the request body — to prevent authorization bypass.
 * Duplicate reports (same reporter + reported pair) return 409.
 */
export async function POST(req: Request) {
  // Auth
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let claims;
  try {
    claims = await verifyWorldUserJwt(token);
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Rate limit
  const rl = await rateLimit({
    world_user_id: claims.world_user_id,
    bucket_key: 'report',
    max: 10,
    windowSeconds: 60,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'rate_limit_exceeded' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  // Validate body
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const { match_id, conversation_id, reason, detail } = parsed.data;
  const supabase = getServiceClient();

  // Derive reported_user_id server-side — verifies reporter is a participant.
  let reported_user_id: string;

  if (match_id) {
    // Reporter must own this match row; candidate_user_id is the reported party.
    const { data, error } = await supabase
      .from('matches')
      .select('candidate_user_id')
      .eq('id', match_id)
      .eq('user_id', claims.world_user_id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    reported_user_id = data.candidate_user_id as string;
  } else {
    // conversation_id path: reporter must be one of the agents in the conversation.
    // agents.user_id links agent → user. The other agent's user is the reported party.
    const { data, error } = await supabase
      .from('conversations')
      .select(
        `
        agent_a:agents!conversations_agent_a_id_fkey(user_id),
        agent_b:agents!conversations_agent_b_id_fkey(user_id)
      `,
      )
      .eq('id', conversation_id!)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const agentA = data.agent_a as unknown as { user_id: string } | null;
    const agentB = data.agent_b as unknown as { user_id: string } | null;
    const userIdA = agentA?.user_id ?? null;
    const userIdB = agentB?.user_id ?? null;

    if (userIdA === claims.world_user_id) {
      reported_user_id = userIdB!;
    } else if (userIdB === claims.world_user_id) {
      reported_user_id = userIdA!;
    } else {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    if (!reported_user_id) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
  }

  // Cannot self-report.
  if (reported_user_id === claims.world_user_id) {
    return NextResponse.json({ error: 'cannot_self_report' }, { status: 400 });
  }

  const { error } = await supabase.from('reports').insert({
    reporter_id: claims.world_user_id,
    reported_user_id,
    reason,
    detail: detail ?? null,
  });

  if (error) {
    // Postgres unique constraint violation — already reported
    if (error.code === '23505') {
      return NextResponse.json({ error: 'already_reported' }, { status: 409 });
    }
    console.error('report insert error:', error);
    return NextResponse.json({ error: 'report_failed' }, { status: 500 });
  }

  // ── Record outcome_event ──────────────────────────────────────────────────
  const { error: eventError } = await supabase.from('outcome_events').insert({
    user_id: claims.world_user_id,
    event_type: 'report_filed',
    source_screen: 'safety_menu',
    metadata: { reported_user_id, reason },
  });
  if (eventError) {
    console.error('[report] outcome_events insert failed:', eventError);
  }

  return NextResponse.json({ reported: true });
}
