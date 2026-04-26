import { inngest } from '../client';
import { getServiceClient } from '@/lib/supabase/service';
import { generateAvatar } from '@/lib/avatar/generate';
import { getDailyQuota } from '@/lib/quota/daily';

/**
 * First-encounter pipeline.
 *
 * Plan source: .omc/plans/world-shaker-ux-v1-plan.md Step 3.5 + AC-21.
 *
 * Triggered by `agent.activated` event with payload { user_id, agent_id }.
 *
 * Steps:
 *   0. quota-check: enforce daily quota (US-312). If used >= max, insert
 *      outcome_event 'wont_connect' and return early.
 *   1. pick-candidate: call match_candidates(target_user, k=10, mode='system_generated')
 *      and pick the top-scoring candidate. (Seed-pool mixing for low active-user
 *      counts is deferred to Phase 4 / Step 4.6 — for v0 we just use whatever
 *      match_candidates returns; if the candidate pool is empty the function exits
 *      cleanly and AC-21 recovery will retry on next app load.)
 *   2. avatar: ensure agent has an avatar_url; call generateAvatar() if missing.
 *   3. spawn-conversation: emit `conversation/start` via step.sendEvent with
 *      is_first_encounter: true so generate-report stamps the match row correctly.
 */
export const firstEncounter = inngest.createFunction(
  {
    id: 'first-encounter',
    name: 'First Encounter Pipeline',
    triggers: [{ event: 'agent.activated' }],
  },
  async ({ event, step, logger }) => {
    const { user_id, agent_id } = event.data as { user_id: string; agent_id: string };

    if (!user_id || !agent_id) {
      throw new Error('agent.activated event missing user_id or agent_id');
    }

    // ── Step 0: daily quota check (US-312) ─────────────────────────────
    const quotaResult = await step.run('quota-check', async () => {
      const quota = await getDailyQuota(user_id);
      return { used: quota.used, max: quota.max };
    });

    if (quotaResult.used >= quotaResult.max) {
      await step.run('emit-wont-connect', async () => {
        const supabase = getServiceClient();
        await supabase.from('outcome_events').insert({
          user_id,
          event_type: 'wont_connect',
          source_screen: 'first-encounter',
          metadata: {
            reason: 'daily_quota_exceeded',
            used: quotaResult.used,
            max: quotaResult.max,
          },
        });
      });
      logger.info(
        `[first-encounter] daily quota exceeded for user=${user_id} (${quotaResult.used}/${quotaResult.max}) — exiting`,
      );
      return { spawned: false, reason: 'daily_quota_exceeded' };
    }

    // ── Step 1: pick best candidate ─────────────────────────────────────
    const candidate = await step.run('pick-candidate', async () => {
      const supabase = getServiceClient();

      // Read seed_pool_active flag; passed to RPC for SQL-level filtering.
      const { data: settingsRow } = await supabase
        .from('app_settings')
        .select('seed_pool_active')
        .limit(1)
        .single();
      const seedPoolActive = settingsRow?.seed_pool_active ?? true;

      const { data, error } = await supabase.rpc('match_candidates', {
        target_user: user_id,
        k: 10,
        mode: 'system_generated',
        include_seeds: seedPoolActive,
      });
      if (error) {
        throw new Error(`match_candidates rpc error: ${error.message}`);
      }
      const rows = (data ?? []) as Array<{
        candidate_user: string;
        score: number;
        is_seed?: boolean;
      }>;

      const top = rows[0];
      if (!top) return null;

      // Resolve the candidate's agent id (active surface=dating).
      const { data: agentRow, error: agentError } = await supabase
        .from('agents')
        .select('id, user_id')
        .eq('user_id', top.candidate_user)
        .eq('status', 'active')
        .maybeSingle();
      if (agentError) {
        throw new Error(`candidate agent lookup error: ${agentError.message}`);
      }
      if (!agentRow) return null;

      return {
        candidate_user_id: top.candidate_user,
        candidate_agent_id: agentRow.id as string,
        score: top.score,
      };
    });

    if (!candidate) {
      logger.info(
        `[first-encounter] no candidate available for user=${user_id} — exiting; recovery will retry`,
      );
      return { spawned: false, reason: 'no_candidate' };
    }

    // ── Step 2: ensure avatar ───────────────────────────────────────────
    await step.run('avatar', async () => {
      const supabase = getServiceClient();
      const { data: agent, error } = await supabase
        .from('agents')
        .select('avatar_url, extracted_features')
        .eq('id', agent_id)
        .maybeSingle();
      if (error) throw new Error(`agent lookup error: ${error.message}`);
      if (!agent) throw new Error(`agent ${agent_id} not found`);
      if (agent.avatar_url) return { generated: false };

      await generateAvatar({
        agent_id,
        extracted_features: (agent.extracted_features ?? {}) as Record<string, unknown>,
      });
      return { generated: true };
    });

    // ── Step 3: spawn conversation ──────────────────────────────────────
    // Use step.sendEvent (durable) instead of inngest.send (fire-and-forget).
    // pair_key is intentionally omitted — live-conversation computes it
    // canonically from agent_a_id and agent_b_id.
    // is_first_encounter: true is forwarded through conversation.completed
    // so generate-report stamps the match row correctly (AC-21 recovery semantic).
    const { pair_key, agent_a_id, agent_b_id } = await step.run('spawn-conversation', async () => {
      const a = agent_id;
      const b = candidate.candidate_agent_id;
      const pairKey = a < b ? `${a}|${b}` : `${b}|${a}`;
      return { pair_key: pairKey, agent_a_id: a, agent_b_id: b };
    });

    await step.sendEvent('send-conversation-start', {
      name: 'conversation/start',
      data: {
        user_id,
        surface: 'dating' as const,
        agent_a_id,
        agent_b_id,
        language: 'ko' as const,
        is_first_encounter: true,
      },
    });

    return {
      spawned: true,
      pair_key,
      agent_a_id,
      agent_b_id,
      candidate_user_id: candidate.candidate_user_id,
    };
  },
);
