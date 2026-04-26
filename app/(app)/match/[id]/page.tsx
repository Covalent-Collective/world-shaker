import { notFound } from 'next/navigation';
import { getServerClient } from '@/lib/supabase/server';
import MatchViewerClient from './MatchViewerClient';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MatchPage({ params }: PageProps): Promise<React.ReactElement> {
  const { id } = await params;
  const supabase = await getServerClient();

  const { data: match } = await supabase
    .from('matches')
    .select('id, compatibility_score, why_click, watch_out, highlight_quotes, rendered_transcript')
    .eq('id', id)
    .single();

  if (!match) {
    notFound();
  }

  return <MatchViewerClient match={match} />;
}
