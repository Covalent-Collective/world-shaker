import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import { SESSION_COOKIE, verifyWorldUserJwt } from '@/lib/auth/jwt';
import { getServiceClient } from '@/lib/supabase/service';
import PokemonStage from '@/components/encounter/PokemonStage';
import type { ConversationStatus } from '@/types/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ConversationPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lastEventId?: string }>;
}

/**
 * Live conversation viewer (US-307 / Step 3.6).
 *
 * Server component:
 *   1. Authenticates the user via the `ws_session` JWT (custom auth path —
 *      same pattern as /api/user/language/route.ts).
 *   2. Loads the conversation row scoped by ownership: the requesting user
 *      must own one of the two participating agents. The `conversations`
 *      table is service-role-only (see 0002_rls.sql), so we use the service
 *      client and apply the ownership filter explicitly via the
 *      `agent_a_id/agent_b_id → agents.user_id` join.
 *   3. Hands the conversationId, initial status, and `lastEventId` (from
 *      `?lastEventId=` query param, default 0) to the client transcript.
 */
export default async function ConversationPage({
  params,
  searchParams,
}: ConversationPageProps): Promise<React.ReactElement> {
  const { id } = await params;
  const { lastEventId: lastEventIdParam } = await searchParams;

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    redirect('/verify');
  }

  let worldUserId: string;
  try {
    const claims = await verifyWorldUserJwt(token);
    worldUserId = claims.world_user_id;
  } catch {
    redirect('/verify');
  }

  // Ownership check: pull the conversation + the two agents' user_ids and
  // interview_answers in one round-trip. The interview_answers carry the
  // partner's q0_name (set during onboarding), which the encounter end-of-
  // playback popup uses for its CTA copy.
  const supabase = getServiceClient();
  const { data: conv, error } = await supabase
    .from('conversations')
    .select('id, status, agent_a_id, agent_b_id')
    .eq('id', id)
    .maybeSingle();

  if (error || !conv) {
    notFound();
  }

  const { data: agents, error: agentsError } = await supabase
    .from('agents')
    .select('id, user_id, interview_answers')
    .in('id', [conv.agent_a_id, conv.agent_b_id]);

  if (agentsError || !agents || !agents.some((a) => a.user_id === worldUserId)) {
    notFound();
  }

  // Resolve display names for both sides of the dialogue plate:
  //   selfName    — the viewer's own agent's q0_name (e.g. "bigJY")
  //   partnerName — the OTHER agent's owner's q0_name (CTA copy)
  // Both fall back to null for legacy agents that pre-date q0_name.
  const pickName = (a: { interview_answers: unknown } | undefined): string | null => {
    const raw = (a?.interview_answers as Record<string, unknown> | null | undefined)?.q0_name;
    return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
  };
  const me = agents.find((a) => a.user_id === worldUserId);
  const partner = agents.find((a) => a.user_id !== worldUserId);
  const selfName = pickName(me);
  const partnerName = pickName(partner);
  // Which canonical side does the current viewer occupy? agent_a_id is the
  // canonical 'A'; if my agent is agent_a_id then I'm A, otherwise B.
  const selfSide: 'A' | 'B' = me?.id === conv.agent_a_id ? 'A' : 'B';

  const parsed = lastEventIdParam !== undefined ? Number(lastEventIdParam) : 0;
  const lastEventId = Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;

  return (
    <PokemonStage
      conversationId={conv.id}
      initialStatus={conv.status as ConversationStatus}
      initialLastEventId={lastEventId}
      partnerName={partnerName}
      selfName={selfName}
      selfSide={selfSide}
    />
  );
}
