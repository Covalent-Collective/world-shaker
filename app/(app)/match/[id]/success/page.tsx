import { notFound } from 'next/navigation';
import { getServerClient } from '@/lib/supabase/server';
import AgentFarewell from '@/components/match/AgentFarewell';
import StarterCard from '@/components/match/StarterCard';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MatchSuccessPage({ params }: PageProps): Promise<React.ReactElement> {
  const { id } = await params;
  const supabase = await getServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: match } = await supabase
    .from('matches')
    .select('id, status, user_id, starters, world_chat_link')
    .eq('id', id)
    .single();

  if (!match || match.status !== 'mutual' || match.user_id !== user?.id) {
    notFound();
  }

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
