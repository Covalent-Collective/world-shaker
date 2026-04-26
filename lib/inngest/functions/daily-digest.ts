import { inngest } from '../client';
import { getServiceClient } from '@/lib/supabase/service';
import { hashCohort } from '@/lib/posthog/cohort';
import { getPostHogServer } from '@/lib/posthog/server';

/**
 * Daily digest cron (US-401).
 *
 * Plan source: .omc/plans/world-shaker-ux-v1-plan.md Step 4.1.
 *
 * Runs nightly at 22:00 UTC (chosen so the per-user-locale fan-out lands
 * around 9am morning local for major Asian timezones; per-locale scheduling
 * lands in a follow-up).
 *
 * For each active user:
 *   1. Collect last-24h matches whose card hasn't been viewed (no
 *      outcome_events row of type 'viewed' for that match by this user).
 *   2. Try a World App push via the env-gated probe
 *      (process.env.WORLD_APP_PUSH_ENABLED === 'true'). The push endpoint is
 *      not yet finalised in v0; this scaffold POSTs to a placeholder URL when
 *      the env var is on, and records a graceful badge fallback otherwise.
 *   3. On any push failure (HTTP non-2xx, network error, env disabled), set
 *      the in-app badge fallback by writing into
 *      `app_settings.user_badges` JSONB:
 *        { "<user_id>": { pending: true, last_set_at: "<iso>" } }
 *   4. Emit PostHog `daily_digest_sent` with distinct_id = hashCohort(user_id)
 *      and properties { match_count, push_attempted, push_ok }.
 */
export const dailyDigest = inngest.createFunction(
  {
    id: 'daily-digest',
    name: 'Daily Digest Push',
    triggers: [{ cron: '0 22 * * *' }], // 22:00 UTC nightly
  },
  async ({ step, logger }) => {
    const supabase = getServiceClient();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // 1. Active users (any user that owns an active agent).
    const activeUsers = await step.run('load-active-users', async () => {
      const { data, error } = await supabase
        .from('agents')
        .select('user_id')
        .eq('status', 'active');
      if (error) throw new Error(`load-active-users failed: ${error.message}`);
      const seen = new Set<string>();
      const ids: string[] = [];
      for (const row of (data ?? []) as Array<{ user_id: string }>) {
        if (!seen.has(row.user_id)) {
          seen.add(row.user_id);
          ids.push(row.user_id);
        }
      }
      return ids;
    });

    if (activeUsers.length === 0) {
      logger.info('[daily-digest] no active users — exiting');
      return { active_users: 0, sent: 0 };
    }

    let sent = 0;

    for (const user_id of activeUsers) {
      // 2. Recent matches for this user.
      const matches = await step.run(`load-matches-${user_id}`, async () => {
        const { data, error } = await supabase
          .from('matches')
          .select('id')
          .eq('user_id', user_id)
          .gt('created_at', since);
        if (error) throw new Error(`matches load failed: ${error.message}`);
        return (data ?? []) as Array<{ id: string }>;
      });

      if (matches.length === 0) continue;

      // 3. Filter to matches the user hasn't viewed yet.
      const unviewed = await step.run(`filter-unviewed-${user_id}`, async () => {
        const matchIds = matches.map((m) => m.id);
        const { data, error } = await supabase
          .from('outcome_events')
          .select('match_id')
          .eq('user_id', user_id)
          .eq('event_type', 'viewed')
          .in('match_id', matchIds);
        if (error) throw new Error(`outcome_events load failed: ${error.message}`);
        const viewed = new Set(
          ((data ?? []) as Array<{ match_id: string | null }>)
            .map((r) => r.match_id)
            .filter((id): id is string => Boolean(id)),
        );
        return matchIds.filter((id) => !viewed.has(id));
      });

      if (unviewed.length === 0) continue;

      // 4. Attempt push (env-gated). Falls back to badge on any failure.
      const pushResult = await step.run(`push-${user_id}`, async () => {
        if (process.env.WORLD_APP_PUSH_ENABLED !== 'true') {
          return { ok: false, attempted: false };
        }
        try {
          const res = await fetch(
            process.env.WORLD_APP_PUSH_URL ?? 'https://worldapp.invalid/push',
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                user_id,
                kind: 'daily_digest',
                match_count: unviewed.length,
              }),
            },
          );
          return { ok: res.ok, attempted: true, status: res.status };
        } catch (err) {
          return {
            ok: false,
            attempted: true,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      });

      if (!pushResult.ok) {
        await step.run(`badge-${user_id}`, async () => {
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
          current[user_id] = { pending: true, last_set_at: new Date().toISOString() };
          const { error: upErr } = await supabase
            .from('app_settings')
            .update({ user_badges: current })
            .eq('id', 1);
          if (upErr) throw new Error(`app_settings update failed: ${upErr.message}`);
        });
      }

      // 5. PostHog capture.
      await step.run(`posthog-${user_id}`, async () => {
        const ph = getPostHogServer();
        if (!ph) return;
        const distinctId = await hashCohort(user_id);
        ph.capture({
          distinctId,
          event: 'daily_digest_sent',
          properties: {
            match_count: unviewed.length,
            push_attempted: pushResult.attempted,
            push_ok: pushResult.ok,
          },
        });
        await ph.flush();
      });

      sent += 1;
    }

    logger.info(`[daily-digest] active_users=${activeUsers.length} sent=${sent}`);
    return { active_users: activeUsers.length, sent };
  },
);
