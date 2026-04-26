import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { verifyWorldUserJwt, SESSION_COOKIE } from '@/lib/auth/jwt';
import { getServerClient } from '@/lib/supabase/server';
import { getServiceClient } from '@/lib/supabase/service';
import { getDailyQuota } from '@/lib/quota/daily';
import { getT } from '@/lib/i18n/getT';
import StrollClient from './StrollClient';

export const dynamic = 'force-dynamic';

export interface MatchCandidate {
  candidate_user: string;
}

/**
 * Daily Stroll page (US-311 / US-312).
 *
 * Server component:
 *   1. Authenticates via ws_session JWT — redirects to /onboarding/verify if invalid.
 *   2. Reads app_settings.streaming_paused via service client.
 *   3. Reads the user's daily quota via getDailyQuota.
 *   4. Calls match_candidates RPC (mode='stroll_proactive') for up to 10 results.
 *   5. Renders the appropriate state: paused / quota exhausted / card stack.
 */
export default async function StrollPage(): Promise<React.ReactElement> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (!token) {
    redirect('/onboarding/verify');
  }

  let worldUserId: string;
  try {
    const claims = await verifyWorldUserJwt(token);
    worldUserId = claims.world_user_id;
  } catch {
    redirect('/onboarding/verify');
  }

  const t = await getT();
  const serviceClient = getServiceClient();

  // ── app_settings.streaming_paused ────────────────────────────────────────
  const { data: settingsRow } = await serviceClient
    .from('app_settings')
    .select('streaming_paused')
    .limit(1)
    .single();

  const streamingPaused = settingsRow?.streaming_paused === true;

  if (streamingPaused) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-4 p-6">
        <p className="text-center text-text-2">{t('stroll.streaming_paused')}</p>
      </main>
    );
  }

  // ── Daily quota ───────────────────────────────────────────────────────────
  const quota = await getDailyQuota(worldUserId);
  const quotaRemaining = Math.max(0, quota.max - quota.used);

  if (quota.used >= quota.max) {
    const resetTime = quota.nextResetAt.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-4 p-6">
        <p className="text-center text-text-2">
          {t('stroll.quota_remaining').replace('{remaining}', '0')}
        </p>
        <p className="text-center text-text-3 text-sm">
          {t('stroll.tomorrow_at').replace('{time}', resetTime)}
        </p>
      </main>
    );
  }

  // ── User timezone (RLS-scoped via server client) ──────────────────────────
  const serverClient = await getServerClient();
  const { data: userRow } = await serverClient
    .from('users')
    .select('timezone')
    .eq('id', worldUserId)
    .single();

  void userRow; // timezone available for future use (e.g. formatted reset time)

  // ── match_candidates RPC ──────────────────────────────────────────────────
  const { data: candidates, error: rpcError } = await serviceClient.rpc('match_candidates', {
    target_user: worldUserId,
    k: 10,
    mode: 'stroll_proactive',
  });

  if (rpcError) {
    console.error('[StrollPage] match_candidates error:', rpcError.message);
  }

  const candidateList: MatchCandidate[] = Array.isArray(candidates) ? candidates : [];

  if (candidateList.length === 0) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-4 p-6">
        <p className="text-center text-text-2">{t('stroll.empty')}</p>
      </main>
    );
  }

  return <StrollClient candidates={candidateList} quotaRemaining={quotaRemaining} />;
}
