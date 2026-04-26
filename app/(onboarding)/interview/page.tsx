import { getServerClient } from '@/lib/supabase/server';
import InterviewClient from './InterviewClient';

export const dynamic = 'force-dynamic';

/**
 * Interview entry route (US-303).
 *
 * Server component: pulls the caller's `agents.interview_answers` jsonb via
 * the cookie-bound server client (RLS-scoped on `user_id`) and hands it to
 * the client child as `initialAnswers` so the flow can resume on the first
 * unanswered skeleton question.
 *
 * If the user has no agent row yet (e.g. they are mid-onboarding) we still
 * render the client with an empty answer set — US-304 creates the row on the
 * first POST to /api/agent/answer.
 */
export default async function InterviewPage(): Promise<React.ReactElement> {
  const supabase = await getServerClient();

  const { data } = await supabase.from('agents').select('interview_answers').maybeSingle();

  const initialAnswers: Record<string, unknown> =
    data?.interview_answers && typeof data.interview_answers === 'object'
      ? (data.interview_answers as Record<string, unknown>)
      : {};

  return <InterviewClient initialAnswers={initialAnswers} />;
}
