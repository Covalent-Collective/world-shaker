import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';

import { verifyWorldUserJwt, SESSION_COOKIE } from '@/lib/auth/jwt';
import { getServiceClient } from '@/lib/supabase/service';
import AgentRevealCard from '@/components/home/AgentRevealCard';

export const dynamic = 'force-dynamic';

/**
 * Authenticated home page (US-320).
 *
 * Server component decision tree:
 *   1. No/invalid JWT → redirect to /verify
 *   2. No active agent → redirect to /interview
 *   3. Match pending/accepted → CTA "Your encounter is ready"
 *   4. Conversation live → CTA "Watch live"
 *   5. Conversation completed, no match yet → "Generating report..." pending state
 *   6. No conversation, no match → "Preparing your first encounter" + HomeRecoveryProbe
 */
export default async function HomePage(): Promise<React.ReactElement> {
  // ── Auth ──────────────────────────────────────────────────────────────────
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

  const db = getServiceClient();

  // ── Active agent ──────────────────────────────────────────────────────────
  // Also fetch interview_answers so we can verify the user finished onboarding.
  // First answer of the interview inserts an active agent row, but until the
  // interview_complete sentinel is set the user should still be sent back to
  // /interview rather than the home decision tree.
  const { data: agentRow } = await db
    .from('agents')
    .select('id, interview_answers')
    .eq('user_id', worldUserId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (!agentRow) {
    redirect('/interview');
  }

  const interviewAnswers = (agentRow.interview_answers as Record<string, string> | null) ?? {};
  if (!interviewAnswers.interview_complete) {
    redirect('/interview');
  }

  const agentId: string = agentRow.id;

  // ── Most recent conversation involving the agent ───────────────────────────
  const { data: convRow } = await db
    .from('conversations')
    .select('id, status, created_at')
    .or(`agent_a_id.eq.${agentId},agent_b_id.eq.${agentId}`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // ── Most recent match for user with active status ─────────────────────────
  // Includes mutual so the home page can route to /match/[id]/success.
  const { data: matchRow } = await db
    .from('matches')
    .select('id, status')
    .eq('user_id', worldUserId)
    .in('status', ['pending', 'accepted', 'mutual'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // ── Decision tree ─────────────────────────────────────────────────────────

  // Case 0: Mutual match → success/handoff page
  if (matchRow?.status === 'mutual') {
    redirect(`/match/${matchRow.id}/success`);
  }

  // Case 1: Pending/accepted match → encounter ready CTA
  if (matchRow?.status === 'pending' || matchRow?.status === 'accepted') {
    return (
      <main className="min-h-dvh flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-6">
          <p className="text-text-3 text-xs tracking-widest uppercase font-semibold">
            World Shaker
          </p>
          <h1 className="font-serif text-4xl leading-tight">Your encounter is ready.</h1>
          <Link
            href={`/match/${matchRow.id}`}
            className="inline-block rounded-full bg-accent-warm px-8 py-3 text-white font-semibold"
          >
            View encounter
          </Link>
        </div>
      </main>
    );
  }

  // Case 2: Live conversation → watch live CTA
  if (convRow?.status === 'live') {
    return (
      <main className="min-h-dvh flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-6">
          <p className="text-text-3 text-xs tracking-widest uppercase font-semibold">
            World Shaker
          </p>
          <h1 className="font-serif text-4xl leading-tight">Your agents are talking.</h1>
          <Link
            href={`/conversation/${convRow.id}`}
            className="inline-block rounded-full bg-accent-warm px-8 py-3 text-white font-semibold"
          >
            Watch live
          </Link>
        </div>
      </main>
    );
  }

  // Case 3: Conversation completed but no match yet → generating report
  if (convRow?.status === 'completed' && !matchRow) {
    return (
      <main className="min-h-dvh flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-4">
          <p className="text-text-3 text-xs tracking-widest uppercase font-semibold">
            World Shaker
          </p>
          <h1 className="font-serif text-4xl leading-tight">Generating report&hellip;</h1>
          <p className="text-text-2">
            Your agents have finished their conversation. We&apos;re preparing your encounter
            report.
          </p>
        </div>
      </main>
    );
  }

  // Case 4: No conversation, no match → preparing first encounter + recovery probe.
  // AgentRevealCard wraps the recovery probe in the cinematic stage atmosphere.
  return <AgentRevealCard agentId={agentId} />;
}
