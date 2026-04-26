import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import MatchViewerClient from './MatchViewerClient';
import { SESSION_COOKIE, verifyWorldUserJwt } from '@/lib/auth/jwt';
import { getServiceClient } from '@/lib/supabase/service';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MatchPage({ params }: PageProps): Promise<React.ReactElement> {
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
    .select(
      'id, user_id, compatibility_score, why_click, watch_out, highlight_quotes, rendered_transcript',
    )
    .eq('id', id)
    .eq('user_id', worldUserId)
    .maybeSingle();

  if (!match) notFound();

  return <MatchViewerClient match={match} />;
}
