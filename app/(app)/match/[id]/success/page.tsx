import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import AgentFarewell from '@/components/match/AgentFarewell';
import StarterCard from '@/components/match/StarterCard';
import VerifiedHumanBadge from '@/components/world/VerifiedHumanBadge';
import WorldChatCta from '@/components/match/WorldChatCta';
import { SESSION_COOKIE, verifyWorldUserJwt } from '@/lib/auth/jwt';
import { getServiceClient } from '@/lib/supabase/service';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MatchSuccessPage({ params }: PageProps): Promise<React.ReactElement> {
  const { id } = await params;

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) redirect('/verify');

  let worldUserId: string;
  try {
    const claims = await verifyWorldUserJwt(token);
    worldUserId = claims.world_user_id;
  } catch {
    redirect('/verify');
  }

  const db = getServiceClient();
  const { data: match } = await db
    .from('matches')
    .select('id, status, user_id, candidate_user_id, starters, world_chat_link')
    .eq('id', id)
    .eq('user_id', worldUserId)
    .eq('status', 'mutual')
    .maybeSingle();

  if (!match) notFound();

  // Resolve the partner's q0_name (display name; for the draft message)
  // and q0_world_username (real World App handle, captured by
  // WorldProfileCapture on their MiniKit-side page-load; for the
  // recipient picker pre-fill).
  let partnerName: string | null = null;
  let partnerWorldUsername: string | null = null;
  if (match.candidate_user_id) {
    const { data: partnerAgent } = await db
      .from('agents')
      .select('interview_answers')
      .eq('user_id', match.candidate_user_id)
      .eq('status', 'active')
      .maybeSingle();
    const answers = (partnerAgent?.interview_answers as Record<string, unknown> | null) ?? null;
    const rawName = answers?.q0_name;
    if (typeof rawName === 'string' && rawName.trim().length > 0) {
      partnerName = rawName.trim();
    }
    const rawHandle = answers?.q0_world_username;
    if (typeof rawHandle === 'string' && rawHandle.trim().length > 0) {
      partnerWorldUsername = rawHandle.trim();
    }
  }

  const starters: Array<{ text: string }> = Array.isArray(match.starters) ? match.starters : [];
  const worldChatLink: string = match.world_chat_link ?? '#';

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center p-6 space-y-8">
      <div className="absolute top-6 right-6">
        <VerifiedHumanBadge variant="compact" />
      </div>
      <AgentFarewell />

      {starters.length > 0 && (
        <section className="w-full max-w-sm space-y-3">
          {starters.map((starter, index) => (
            <StarterCard key={index} text={starter.text} worldChatLink={worldChatLink} />
          ))}
        </section>
      )}

      <WorldChatCta
        partnerName={partnerName}
        partnerWorldUsername={partnerWorldUsername}
        fallbackUrl={worldChatLink}
      />
    </main>
  );
}
