import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { verifyWorldUserJwt, SESSION_COOKIE } from '@/lib/auth/jwt';
import { getServiceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';

/**
 * POST /api/match/[id]/world-chat-replied
 *
 * Placeholder endpoint that records a `replied_24h` outcome event,
 * signalling that the authenticated user replied within 24 h in World Chat.
 *
 * Real v1 triggering: World Chat webhook → this endpoint.
 * Body: {} (no params — the event is signal-only).
 *
 * Auth: ws_session JWT (custom JWT — not Supabase Auth).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  // ── Auth ──────────────────────────────────────────────────────────────────
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

  const { id: matchId } = await params;
  const { world_user_id } = claims;

  const supabase = getServiceClient();

  // ── Record outcome event ──────────────────────────────────────────────────
  const { error: insertError } = await supabase.from('outcome_events').insert({
    event_type: 'replied_24h',
    user_id: world_user_id,
    match_id: matchId,
    source_screen: 'world_chat',
  });

  if (insertError) {
    console.error('[world-chat-replied] outcome_events insert failed:', insertError);
  }

  return NextResponse.json({ recorded: true });
}
