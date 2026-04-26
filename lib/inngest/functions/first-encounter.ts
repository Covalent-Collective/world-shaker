import { inngest } from '../client';
import { getServiceClient } from '@/lib/supabase/service';
import { generateAvatar } from '@/lib/avatar/generate';

/**
 * First-encounter pipeline.
 *
 * Plan source: .omc/plans/world-shaker-ux-v1-plan.md Step 3.5 + AC-21.
 *
 * Triggered by `agent.activated` event with payload { user_id, agent_id }.
 *
 * Steps:
 *   1. pick-candidate: call match_candidates(target_user, k=10, mode='system_generated')
 *      and pick the top-scoring candidate. (Seed-pool mixing for low active-user
 *      counts is deferred to Phase 4 / Step 4.6 — for v0 we just use whatever
 *      match_candidates returns; if the candidate pool is empty the function exits
 *      cleanly and AC-21 recovery will retry on next app load.)
 *   2. avatar: ensure agent has an avatar_url; call generateAvatar() if missing.
 *   3. spawn-conversation: emit `conversation/start` event with deterministic
 *      pair_key = sorted(agent_a, agent_b) joined by '|'.
 *   4. mark-first-encounter: poll for the matches row produced by the
 *      downstream generate-report fn and flip first_encounter=true. Used by
 *      the AC-21 recovery check.
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

    // ── Step 1: pick best candidate ─────────────────────────────────────
    const candidate = await step.run('pick-candidate', async () => {
      const supabase = getServiceClient();
      const { data, error } = await supabase.rpc('match_candidates', {
        target_user: user_id,
        k: 10,
        mode: 'system_generated',
      });
      if (error) {
        throw new Error(`match_candidates rpc error: ${error.message}`);
      }
      const rows = (data ?? []) as Array<{ candidate_user: string; score: number }>;
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
    const { pair_key, agent_a_id, agent_b_id } = await step.run('spawn-conversation', async () => {
      const a = agent_id;
      const b = candidate.candidate_agent_id;
      const pairKey = a < b ? `${a}|${b}` : `${b}|${a}`;

      await inngest.send({
        name: 'conversation/start',
        data: {
          user_id,
          surface: 'dating' as const,
          agent_a_id: a,
          agent_b_id: b,
          pair_key: pairKey,
          language: 'ko' as const,
          origin: 'system_generated' as const,
          first_encounter: true,
        },
      });

      return { pair_key: pairKey, agent_a_id: a, agent_b_id: b };
    });

    // ── Step 4: mark matches.first_encounter=true once the row exists ───
    // The downstream live-conversation + generate-report Inngest fns insert
    // a matches row when the conversation completes. We poll briefly for it
    // and stamp first_encounter=true. If the row never appears (e.g. the
    // conversation failed), we exit cleanly — AC-21 recovery handles retry.
    const marked = await step.run('mark-first-encounter', async () => {
      const supabase = getServiceClient();
      const startedAt = Date.now();
      const deadlineMs = startedAt + 10 * 60 * 1000; // 10 minutes

      while (Date.now() < deadlineMs) {
        const { data, error } = await supabase
          .from('matches')
          .select('id')
          .eq('user_id', user_id)
          .eq('candidate_user_id', candidate.candidate_user_id)
          .eq('origin', 'system_generated')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw new Error(`matches lookup error: ${error.message}`);
        if (data) {
          const { error: updateError } = await supabase
            .from('matches')
            .update({ first_encounter: true })
            .eq('id', data.id);
          if (updateError) throw new Error(`matches update error: ${updateError.message}`);
          return { match_id: data.id as string, marked: true };
        }
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
      return { match_id: null, marked: false };
    });

    return {
      spawned: true,
      pair_key,
      agent_a_id,
      agent_b_id,
      candidate_user_id: candidate.candidate_user_id,
      first_encounter_marked: marked.marked,
      match_id: marked.match_id,
    };
  },
);
