import { inngest } from '../client';
import { getServiceClient } from '@/lib/supabase/service';

/**
 * Nightly matching job.
 *
 * SCAFFOLD ONLY — actual matching logic to be implemented after UX is finalized.
 *
 * Plan (per v3 spec):
 *   1. For each active agent:
 *      a. Call SQL fn `match_candidates(user_id, k=30)` — pgvector + structured
 *         compatibility features. NO LLM in scoring.
 *      b. Take top 3 by compat score with diversity filter.
 *   2. For each (user, candidate) pair in top-3:
 *      a. Call generateExplanation() — Anthropic Sonnet, ~$0.05/user/day.
 *      b. Insert into `matches` with status='pending'.
 *   3. Schedule push notification at user-local 8 AM.
 */
export const nightlyMatch = inngest.createFunction(
  {
    id: 'nightly-match',
    name: 'Nightly Match Generation',
    triggers: [{ cron: '30 0 * * *' }], // 00:30 UTC daily
  },
  async ({ step, logger }) => {
    const supabase = getServiceClient();

    const { count: activeUsers } = await step.run('count-active', async () => {
      const { count } = await supabase
        .from('agents')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active');
      return { count };
    });

    logger.info(`active_agents=${activeUsers ?? 0}`);

    // TODO: iterate active agents, call match_candidates, generate explanations.
    return { active_agents: activeUsers ?? 0, generated: 0 };
  },
);
