import { inngest } from '../client';
import { getServiceClient } from '@/lib/supabase/service';
import { hashCohort } from '@/lib/posthog/cohort';
import { getPostHogServer } from '@/lib/posthog/server';

/**
 * Mutual-match push (US-402).
 *
 * Triggered by `match.mutual` event written by Phase 2 generate-report or the
 * /api/match/[id]/like route on the second-side accept.
 *
 * Payload: { match_id_a, match_id_b, user_a, user_b }
 *
 * For each side:
 *   1. Try World App push (env-gated probe; same shape as daily-digest).
 *   2. On any push failure, set in-app badge fallback in app_settings.user_badges.
 *   3. PostHog capture('mutual_match_push_sent') with cohort-hashed distinct_id.
 */
export const MUTUAL_PUSH_EVENT = 'match.mutual';

export type MutualPushPayload = {
  match_id_a: string;
  match_id_b: string;
  user_a: string;
  user_b: string;
};

async function attemptPush(user_id: string): Promise<{
  ok: boolean;
  attempted: boolean;
  status?: number;
  error?: string;
}> {
  if (process.env.WORLD_APP_PUSH_ENABLED !== 'true') {
    return { ok: false, attempted: false };
  }
  try {
    const res = await fetch(process.env.WORLD_APP_PUSH_URL ?? 'https://worldapp.invalid/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_id, kind: 'mutual_match' }),
    });
    return { ok: res.ok, attempted: true, status: res.status };
  } catch (err) {
    return {
      ok: false,
      attempted: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const mutualPush = inngest.createFunction(
  {
    id: 'mutual-push',
    name: 'Mutual Match Push',
    triggers: [{ event: MUTUAL_PUSH_EVENT }],
  },
  async ({ event, step, logger }) => {
    const { user_a, user_b, match_id_a, match_id_b } = event.data as MutualPushPayload;
    if (!user_a || !user_b) {
      throw new Error('match.mutual event missing user_a or user_b');
    }

    const supabase = getServiceClient();

    const sides: Array<{ user_id: string; match_id: string }> = [
      { user_id: user_a, match_id: match_id_a },
      { user_id: user_b, match_id: match_id_b },
    ];

    const results: Array<{ user_id: string; ok: boolean; attempted: boolean }> = [];

    for (const side of sides) {
      const pushResult = await step.run(`push-${side.user_id}`, () => attemptPush(side.user_id));

      if (!pushResult.ok) {
        await step.run(`badge-${side.user_id}`, async () => {
          const { data: settings, error: readErr } = await supabase
            .from('app_settings')
            .select('user_badges')
            .eq('id', 1)
            .maybeSingle();
          if (readErr) throw new Error(`app_settings read failed: ${readErr.message}`);
          const current = (settings?.user_badges ?? {}) as Record<
            string,
            { pending: boolean; last_set_at: string }
          >;
          current[side.user_id] = { pending: true, last_set_at: new Date().toISOString() };
          const { error: upErr } = await supabase
            .from('app_settings')
            .update({ user_badges: current })
            .eq('id', 1);
          if (upErr) throw new Error(`app_settings update failed: ${upErr.message}`);
        });
      }

      await step.run(`posthog-${side.user_id}`, async () => {
        const ph = getPostHogServer();
        if (!ph) return;
        const distinctId = await hashCohort(side.user_id);
        ph.capture({
          distinctId,
          event: 'mutual_match_push_sent',
          properties: {
            match_id: side.match_id,
            push_attempted: pushResult.attempted,
            push_ok: pushResult.ok,
          },
        });
        await ph.flush();
      });

      results.push({ user_id: side.user_id, ok: pushResult.ok, attempted: pushResult.attempted });
    }

    logger.info(`[mutual-push] users=${user_a},${user_b} ok=${results.map((r) => r.ok).join(',')}`);
    return { results };
  },
);
