import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { verifyWorldUserJwt, SESSION_COOKIE } from '@/lib/auth/jwt';
import { getServiceClient } from '@/lib/supabase/service';
import { inngest } from '@/lib/inngest/client';

export const runtime = 'nodejs';

const Body = z.object({
  decision: z.enum(['accepted', 'skipped']),
});

/**
 * POST /api/match/[id]/like
 *
 * Records the authenticated user's like/skip decision on a match card.
 * When both parties accept, upgrades both rows to 'mutual' and emits
 * a 'match.mutual' Inngest event so downstream jobs can create the chat.
 *
 * Auth: ws_session JWT (custom JWT — not Supabase Auth).
 * Uses service client scoped by explicit .eq(id) + .eq(user_id) filters.
 */
export async function POST(
  req: Request,
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

  // ── Parse body ────────────────────────────────────────────────────────────
  const body = Body.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const { decision } = body.data;
  const { id: matchId } = await params;
  const { world_user_id } = claims;

  const supabase = getServiceClient();

  // ── Update own match row ──────────────────────────────────────────────────
  const { data: updatedMatch, error: updateError } = await supabase
    .from('matches')
    .update({
      status: decision,
      ...(decision === 'accepted' ? { accepted_at: new Date().toISOString() } : {}),
    })
    .eq('id', matchId)
    .eq('user_id', world_user_id)
    .select('id, candidate_user_id, world_chat_link')
    .single();

  if (updateError || !updatedMatch) {
    console.error('match like update error:', updateError);
    return NextResponse.json({ error: 'match_not_found' }, { status: 404 });
  }

  // ── Skip path ─────────────────────────────────────────────────────────────
  if (decision === 'skipped') {
    return NextResponse.json({ status: 'skipped', mutual: false, match_id: matchId });
  }

  // ── Accept: check for reciprocal accepted match ───────────────────────────
  const { data: reciprocal } = await supabase
    .from('matches')
    .select('id')
    .eq('user_id', updatedMatch.candidate_user_id)
    .eq('candidate_user_id', world_user_id)
    .eq('status', 'accepted')
    .limit(1)
    .single();

  if (!reciprocal) {
    return NextResponse.json({ status: 'accepted', mutual: false, match_id: matchId });
  }

  // ── Mutual: upgrade both rows ─────────────────────────────────────────────
  await Promise.all([
    supabase.from('matches').update({ status: 'mutual' }).eq('id', matchId),
    supabase.from('matches').update({ status: 'mutual' }).eq('id', reciprocal.id),
  ]);

  // Emit event for downstream jobs (chat creation, push notification, etc.)
  await inngest.send({
    name: 'match.mutual',
    data: {
      match_id_a: matchId,
      match_id_b: reciprocal.id,
    },
  });

  return NextResponse.json({
    status: 'mutual',
    mutual: true,
    match_id: matchId,
    world_chat_link: updatedMatch.world_chat_link ?? null,
  });
}
