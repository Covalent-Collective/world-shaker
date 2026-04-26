import { inngest } from '../client';
import { getServiceClient } from '@/lib/supabase/service';

/**
 * Cleanup orphaned conversations (US-410 piece).
 *
 * Cron: hourly ('0 * * * *').
 *
 * UPDATE conversations SET status='abandoned'
 *  WHERE status='live'
 *    AND created_at < now() - interval '15 minutes'
 *    AND NOT EXISTS (
 *          SELECT 1 FROM conversation_turns
 *           WHERE conversation_id = conversations.id
 *        );
 *
 * Implemented client-side as a two-step query (load orphan ids, then UPDATE
 * by id IN (...)) so we don't need a new RPC. PostgREST has no first-class
 * NOT EXISTS so we filter by checking the count of matching turns.
 */
export const cleanupOrphans = inngest.createFunction(
  {
    id: 'cleanup-orphans',
    name: 'Cleanup Orphaned Conversations',
    triggers: [{ cron: '0 * * * *' }], // hourly
  },
  async ({ step, logger }) => {
    const supabase = getServiceClient();
    const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    const orphanIds = await step.run('find-orphans', async () => {
      const { data: stale, error } = await supabase
        .from('conversations')
        .select('id')
        .eq('status', 'live')
        .lt('created_at', cutoff);
      if (error) throw new Error(`stale conversations load failed: ${error.message}`);
      const candidates = (stale ?? []) as Array<{ id: string }>;
      if (candidates.length === 0) return [] as string[];

      // Filter out anything that has at least one turn.
      const ids = candidates.map((r) => r.id);
      const { data: turns, error: turnsErr } = await supabase
        .from('conversation_turns')
        .select('conversation_id')
        .in('conversation_id', ids);
      if (turnsErr) throw new Error(`turns load failed: ${turnsErr.message}`);
      const withTurns = new Set(
        ((turns ?? []) as Array<{ conversation_id: string }>).map((r) => r.conversation_id),
      );
      return ids.filter((id) => !withTurns.has(id));
    });

    if (orphanIds.length === 0) {
      logger.info('[cleanup-orphans] no orphans found');
      return { abandoned: 0 };
    }

    const updated = await step.run('mark-abandoned', async () => {
      const { data, error } = await supabase
        .from('conversations')
        .update({ status: 'abandoned' })
        .in('id', orphanIds)
        .eq('status', 'live')
        .select('id');
      if (error) throw new Error(`mark-abandoned failed: ${error.message}`);
      return ((data ?? []) as Array<{ id: string }>).length;
    });

    logger.info(`[cleanup-orphans] abandoned=${updated} (cutoff=${cutoff})`);
    return { abandoned: updated };
  },
);
