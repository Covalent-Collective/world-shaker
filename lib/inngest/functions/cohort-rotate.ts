import { randomBytes, createHash } from 'crypto';
import { inngest } from '../client';
import { getServiceClient } from '@/lib/supabase/service';
import { getPostHogServer } from '@/lib/posthog/server';

/**
 * Cohort salt rotation (US-409).
 *
 * Cron: 1st of each quarter at 03:00 UTC ('0 3 1 1,4,7,10 *').
 *
 * Steps:
 *   1. Generate a fresh 32-byte salt (hex-encoded, 64 chars) via crypto.randomBytes.
 *   2. UPDATE app_settings SET posthog_cohort_salt + posthog_cohort_salt_rotated_at.
 *   3. Backfill users.posthog_cohort = sha256(id || ':' || new_salt) in
 *      batches of 1000 to avoid lock contention.
 *   4. PostHog capture('posthog_cohort_rotated', { rotation_at, user_count }).
 *
 * The 5-minute in-process salt cache in lib/posthog/cohort.ts means the new
 * salt naturally takes effect within 5 minutes of rotation — no eager
 * invalidation needed (AC-19).
 */

const BATCH_SIZE = 1000;

export const cohortRotate = inngest.createFunction(
  {
    id: 'cohort-rotate',
    name: 'PostHog Cohort Salt Rotation',
    triggers: [{ cron: '0 3 1 1,4,7,10 *' }], // 1st of Jan/Apr/Jul/Oct at 03:00 UTC
  },
  async ({ step, logger }) => {
    const supabase = getServiceClient();
    const rotationAt = new Date().toISOString();

    const newSalt = await step.run('generate-salt', async () => randomBytes(32).toString('hex'));

    await step.run('update-app-settings', async () => {
      const { error } = await supabase
        .from('app_settings')
        .update({
          posthog_cohort_salt: newSalt,
          posthog_cohort_salt_rotated_at: rotationAt,
        })
        .eq('id', 1);
      if (error) throw new Error(`app_settings update failed: ${error.message}`);
    });

    // Backfill in batches.
    let offset = 0;
    let totalUpdated = 0;

    // Use a bounded loop to avoid runaway iteration in pathological cases.
    for (let batch = 0; batch < 10000; batch++) {
      const result = await step.run(`backfill-batch-${batch}`, async () => {
        const { data, error } = await supabase
          .from('users')
          .select('id')
          .order('id', { ascending: true })
          .range(offset, offset + BATCH_SIZE - 1);
        if (error) throw new Error(`users batch fetch failed: ${error.message}`);
        const rows = (data ?? []) as Array<{ id: string }>;
        if (rows.length === 0) return { updated: 0, done: true };

        for (const row of rows) {
          const cohort = createHash('sha256').update(`${row.id}:${newSalt}`).digest('hex');
          const { error: upErr } = await supabase
            .from('users')
            .update({ posthog_cohort: cohort })
            .eq('id', row.id);
          if (upErr) throw new Error(`users update failed for ${row.id}: ${upErr.message}`);
        }

        return { updated: rows.length, done: rows.length < BATCH_SIZE };
      });

      totalUpdated += result.updated;
      offset += BATCH_SIZE;
      if (result.done) break;
    }

    await step.run('posthog-capture', async () => {
      const ph = getPostHogServer();
      if (!ph) return;
      ph.capture({
        distinctId: 'system:cohort-rotate',
        event: 'posthog_cohort_rotated',
        properties: { rotation_at: rotationAt, user_count: totalUpdated },
      });
      await ph.flush();
    });

    logger.info(`[cohort-rotate] rotated_at=${rotationAt} user_count=${totalUpdated}`);
    return { rotation_at: rotationAt, user_count: totalUpdated };
  },
);
