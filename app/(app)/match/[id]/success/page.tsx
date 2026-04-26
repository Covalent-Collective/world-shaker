import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import AgentFarewell from '@/components/match/AgentFarewell';
import StarterCard from '@/components/match/StarterCard';
import { SESSION_COOKIE, verifyWorldUserJwt } from '@/lib/auth/jwt';
import { getServiceClient } from '@/lib/supabase/service';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MatchSuccessPage({ params }: PageProps): Promise<React.ReactElement> {
  const { id } = await params;

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) redirect('/onboarding/verify');

  let worldUserId: string;
  try {
    const claims = await verifyWorldUserJwt(token);
    worldUserId = claims.world_user_id;
  } catch {
    redirect('/onboarding/verify');
  }

  const db = getServiceClient();
  const { data: match } = await db
    .from('matches')
    .select('id, status, user_id, starters, world_chat_link')
    .eq('id', id)
    .eq('user_id', worldUserId)
    .eq('status', 'mutual')
    .maybeSingle();

  if (!match) notFound();

  const starters: Array<{ text: string }> = Array.isArray(match.starters) ? match.starters : [];
  const worldChatLink: string = match.world_chat_link ?? '#';

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center p-6 space-y-8">
      <AgentFarewell />

      {starters.length > 0 && (
        <section className="w-full max-w-sm space-y-3">
          {starters.map((starter, index) => (
            <StarterCard key={index} text={starter.text} worldChatLink={worldChatLink} />
          ))}
        </section>
      )}

      <a
        href={worldChatLink}
        target="_blank"
        rel="noopener noreferrer"
        className="w-full max-w-sm rounded-xl bg-foreground text-background py-3 px-6 text-sm font-semibold text-center transition-opacity hover:opacity-80 active:opacity-60"
      >
        World Chat에서 만나기
      </a>
    </main>
  );
}
