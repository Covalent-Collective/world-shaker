import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { verifyWorldUserJwt, SESSION_COOKIE } from '@/lib/auth/jwt';
import { getServiceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';

/**
 * POST /api/conversation/[id]/abandon
 *
 * Moves a conversation from 'live' to 'abandoned'.
 *
 * Auth: custom ws_session JWT (same pattern as /api/user/language).
 * The service client is used because the custom JWT is not a Supabase Auth
 * token — RLS would treat the request as unauthenticated. We verify the JWT
 * ourselves and enforce ownership via an explicit SQL filter.
 *
 * State machine: only 'live' conversations may be abandoned. The DB
 * BEFORE UPDATE trigger (0003_ux_v1.sql) also guards invalid transitions.
 * If the UPDATE matches 0 rows the conversation is already terminal → 409.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (!token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let claims: Awaited<ReturnType<typeof verifyWorldUserJwt>>;
  try {
    claims = await verifyWorldUserJwt(token);
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { id: conversationId } = await params;
  const worldUserId = claims.world_user_id;

  const supabase = getServiceClient();

  // ── Ownership check ─────────────────────────────────────────────────────────
  // Confirms the authenticated user owns at least one agent in the conversation.
  const { data: ownerRow, error: ownerError } = await supabase
    .from('conversations')
    .select(
      'id, agent_a:agents!conversations_agent_a_id_fkey(user_id), agent_b:agents!conversations_agent_b_id_fkey(user_id)',
    )
    .eq('id', conversationId)
    .limit(1)
    .maybeSingle();

  if (ownerError) {
    console.error('abandon ownership check error:', ownerError);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }

  // No row means conversation doesn't exist — also 403 to avoid enumeration.
  // Supabase returns joined relations as objects for to-one FK joins.
  const agentA = (ownerRow?.agent_a ?? null) as { user_id: string } | null;
  const agentB = (ownerRow?.agent_b ?? null) as { user_id: string } | null;
  const isOwner =
    ownerRow !== null && (agentA?.user_id === worldUserId || agentB?.user_id === worldUserId);

  if (!isOwner) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // ── Status update ───────────────────────────────────────────────────────────
  const { data: updated, error: updateError } = await supabase
    .from('conversations')
    .update({ status: 'abandoned' })
    .eq('id', conversationId)
    .eq('status', 'live')
    .select('id');

  if (updateError) {
    console.error('abandon update error:', updateError);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }

  if (!updated || updated.length === 0) {
    // Conversation exists but is not 'live' — already terminal.
    return NextResponse.json({ error: 'already_terminal' }, { status: 409 });
  }

  // ── Outcome event ───────────────────────────────────────────────────────────
  const { error: eventError } = await supabase.from('outcome_events').insert({
    event_type: 'wont_connect',
    user_id: worldUserId,
    source_screen: 'conversation_overlay',
    metadata: { conversation_id: conversationId },
  });

  if (eventError) {
    // Non-fatal: the abandon already succeeded. Log and continue.
    console.error('abandon outcome_event insert error:', eventError);
  }

  return NextResponse.json({ abandoned: true }, { status: 200 });
}
