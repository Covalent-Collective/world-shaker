import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { verifyWorldUserJwt, SESSION_COOKIE } from '@/lib/auth/jwt';
import { getServiceClient } from '@/lib/supabase/service';
import { inngest } from '@/lib/inngest/client';

export const runtime = 'nodejs';

/**
 * POST /api/encounter/[id]/handoff
 *
 * Demo handoff endpoint that closes the encounter loop end-to-end:
 *
 *   user taps "{partner}와 대화해보기" in EncounterEndPopup
 *      → POST here with the encounter's conversation id
 *      → server creates / upgrades matches rows on BOTH sides to 'mutual'
 *      → returns { match_id, world_chat_link } for the client to redirect
 *        the user to /match/{id}/success.
 *
 * This shortcut exists because the proper match-creation pipeline lives in
 * the generate-report Inngest function, which is upstream from where the
 * end-of-encounter popup currently sits in the demo. Once
 * generate-report reliably populates a `matches` row (with
 * compatibility_score, why_click, etc.) the popup CTA should switch to
 * /api/match/[id]/like with the existing match id, and this endpoint can
 * retire.
 *
 * The auto-mutual on both sides is a deliberate demo bypass — production
 * must require the partner to also like back before either side sees the
 * World Chat handoff. This is gated by the route name (`/encounter/...`)
 * rather than `/match/...` so the bypass surface stays explicit.
 */
const DEMO_COMPAT_SCORE = 0.85;

// Canonical World Chat MiniApp universal link. Per docs.world.org/mini-apps/
// sharing/world-chat-qa, the World Chat mini app's app_id is
// app_e293fcd0565f45ca296aa317212d8741, addressable via the World universal
// link router. Tapping this from inside the World App routes the user
// straight into the World Chat mini app; from a regular browser it falls
// back to the World Apps directory.
//
// Recipient pre-fill (`?recipient=<username>` in the path query) requires
// resolving the partner's World Chat username from their wallet address
// via MiniKit.getUserByAddress — we don't yet capture wallet addresses
// (wallet-auth POST is 501'd) so we hand off to a blank chat compose for
// now. Recipient pre-fill lands once wallet-auth ships.
const WORLD_CHAT_APP_ID = 'app_e293fcd0565f45ca296aa317212d8741';
const DEMO_WORLD_CHAT_LINK = `https://worldcoin.org/mini-app?app_id=${WORLD_CHAT_APP_ID}`;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let claims: Awaited<ReturnType<typeof verifyWorldUserJwt>>;
  try {
    claims = await verifyWorldUserJwt(token);
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { world_user_id } = claims;

  const { id: conversationId } = await params;
  const supabase = getServiceClient();

  // Resolve the conversation + the two participating agents → user_ids.
  const { data: conv, error: convError } = await supabase
    .from('conversations')
    .select('id, status, agent_a_id, agent_b_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (convError || !conv) {
    return NextResponse.json({ error: 'conversation_not_found' }, { status: 404 });
  }

  const { data: agents, error: agentsError } = await supabase
    .from('agents')
    .select('id, user_id')
    .in('id', [conv.agent_a_id, conv.agent_b_id]);
  if (agentsError || !agents || agents.length !== 2) {
    return NextResponse.json({ error: 'agents_lookup_failed' }, { status: 500 });
  }

  const me = agents.find((a) => a.user_id === world_user_id);
  if (!me) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const partner = agents.find((a) => a.user_id !== world_user_id);
  if (!partner) {
    return NextResponse.json({ error: 'partner_not_found' }, { status: 404 });
  }
  const partnerUserId = partner.user_id;

  // Insert (or fetch) matches rows in both directions. The unique index on
  // (user_id, candidate_user_id) WHERE status IN ('pending','accepted','mutual')
  // guarantees we don't double-create when the user reopens the popup.
  const upsertOne = async (userId: string, candidateUserId: string): Promise<string> => {
    const { data: existing } = await supabase
      .from('matches')
      .select('id')
      .eq('user_id', userId)
      .eq('candidate_user_id', candidateUserId)
      .in('status', ['pending', 'accepted', 'mutual'])
      .limit(1)
      .maybeSingle();

    if (existing) return existing.id as string;

    const { data: inserted, error } = await supabase
      .from('matches')
      .insert({
        user_id: userId,
        candidate_user_id: candidateUserId,
        conversation_id: conversationId,
        compatibility_score: DEMO_COMPAT_SCORE,
        status: 'accepted',
        accepted_at: new Date().toISOString(),
        world_chat_link: DEMO_WORLD_CHAT_LINK,
      })
      .select('id')
      .single();
    if (error || !inserted) {
      throw new Error(`match insert failed: ${error?.message ?? 'unknown'}`);
    }
    return inserted.id as string;
  };

  let myMatchId: string;
  let theirMatchId: string;
  try {
    [myMatchId, theirMatchId] = await Promise.all([
      upsertOne(world_user_id, partnerUserId),
      upsertOne(partnerUserId, world_user_id),
    ]);
  } catch (err) {
    console.error('[encounter/handoff] match upsert error', err);
    return NextResponse.json({ error: 'match_create_failed' }, { status: 500 });
  }

  // Force mutual on both sides + ensure world_chat_link is set.
  await Promise.all([
    supabase
      .from('matches')
      .update({ status: 'mutual', world_chat_link: DEMO_WORLD_CHAT_LINK })
      .eq('id', myMatchId),
    supabase
      .from('matches')
      .update({ status: 'mutual', world_chat_link: DEMO_WORLD_CHAT_LINK })
      .eq('id', theirMatchId),
  ]);

  // Best-effort match.mutual event for downstream jobs (chat creation, push,
  // etc.). Failure is non-fatal — the handoff page renders from the matches
  // row, not the event.
  try {
    await inngest.send({
      name: 'match.mutual',
      data: {
        match_id_a: myMatchId,
        match_id_b: theirMatchId,
        user_a: world_user_id,
        user_b: partnerUserId,
      },
    });
  } catch (err) {
    console.error('[encounter/handoff] inngest send failed', err);
  }

  return NextResponse.json({
    match_id: myMatchId,
    world_chat_link: DEMO_WORLD_CHAT_LINK,
  });
}
