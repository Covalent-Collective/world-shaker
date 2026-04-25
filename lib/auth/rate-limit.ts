import 'server-only';

import { getServiceClient } from '@/lib/supabase/service';

export interface RateLimitOpts {
  world_user_id: string;
  bucket_key: string;
  max: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  ok: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

/** Rate-limit constants for the /api/agent/answer route. */
export const agentAnswerRateLimit = { max: 30, windowSeconds: 60 } as const;

/**
 * Postgres-backed fixed-window rate limiter using the rate_limit_buckets table.
 *
 * Schema: (world_user_id UUID, bucket_key TEXT, window_start TIMESTAMPTZ, count INT,
 *          PRIMARY KEY(world_user_id, bucket_key, window_start))
 *
 * Algorithm (SELECT → INSERT-or-UPDATE):
 *  1. Compute window_start = epoch-aligned start of current window.
 *  2. SELECT existing count for (user, bucket, window).
 *  3. If row exists UPDATE count = count + 1; else INSERT count = 1.
 *  4. Evaluate new count against max.
 *  5. Opportunistically DELETE stale rows older than 1 hour (~1% of calls).
 *
 * Note: The SELECT+UPDATE has a small race window at very high concurrency.
 * For strict atomicity, add a rate_limit_increment(p_user, p_bucket, p_window)
 * Postgres RPC in a future migration. Acceptable for v0.
 */
export async function rateLimit(opts: RateLimitOpts): Promise<RateLimitResult> {
  const { world_user_id, bucket_key, max, windowSeconds } = opts;

  const nowMs = Date.now();
  const windowStartMs = Math.floor(nowMs / (windowSeconds * 1000)) * windowSeconds * 1000;
  const windowStart = new Date(windowStartMs).toISOString();

  const db = getServiceClient();

  // Best-effort opportunistic cleanup of stale buckets (~1% of calls).
  if (Math.random() < 0.01) {
    const staleThreshold = new Date(nowMs - 3600 * 1000).toISOString();
    void db.from('rate_limit_buckets').delete().lt('window_start', staleThreshold);
  }

  // SELECT existing row for this (user, bucket, window).
  const { data: existing, error: selectError } = await db
    .from('rate_limit_buckets')
    .select('count')
    .eq('world_user_id', world_user_id)
    .eq('bucket_key', bucket_key)
    .eq('window_start', windowStart)
    .maybeSingle();

  if (selectError) {
    console.error('[rate-limit] select error', selectError);
    // Fail open: allow the request.
    return { ok: true, retryAfterSeconds: 0, remaining: max };
  }

  let newCount: number;

  if (existing === null) {
    // No row yet — INSERT with count=1.
    const { error: insertError } = await db
      .from('rate_limit_buckets')
      .insert({ world_user_id, bucket_key, window_start: windowStart, count: 1 });

    if (insertError) {
      // Another request may have raced and inserted first; re-SELECT and increment.
      const { data: raceRow, error: raceSelectError } = await db
        .from('rate_limit_buckets')
        .select('count')
        .eq('world_user_id', world_user_id)
        .eq('bucket_key', bucket_key)
        .eq('window_start', windowStart)
        .maybeSingle();

      if (raceSelectError || raceRow === null) {
        console.error('[rate-limit] race insert/select error', insertError, raceSelectError);
        return { ok: true, retryAfterSeconds: 0, remaining: max };
      }

      newCount = (raceRow as { count: number }).count + 1;
      const { error: raceUpdateError } = await db
        .from('rate_limit_buckets')
        .update({ count: newCount })
        .eq('world_user_id', world_user_id)
        .eq('bucket_key', bucket_key)
        .eq('window_start', windowStart);

      if (raceUpdateError) {
        console.error('[rate-limit] race update error', raceUpdateError);
        return { ok: true, retryAfterSeconds: 0, remaining: max };
      }
    } else {
      newCount = 1;
    }
  } else {
    // Row exists — UPDATE count = existing + 1.
    newCount = (existing as { count: number }).count + 1;
    const { error: updateError } = await db
      .from('rate_limit_buckets')
      .update({ count: newCount })
      .eq('world_user_id', world_user_id)
      .eq('bucket_key', bucket_key)
      .eq('window_start', windowStart);

    if (updateError) {
      console.error('[rate-limit] update error', updateError);
      return { ok: true, retryAfterSeconds: 0, remaining: max };
    }
  }

  if (newCount > max) {
    const windowEndMs = windowStartMs + windowSeconds * 1000;
    const retryAfterSeconds = Math.max(0, Math.ceil((windowEndMs - Date.now()) / 1000));
    return { ok: false, retryAfterSeconds, remaining: 0 };
  }

  return { ok: true, retryAfterSeconds: 0, remaining: max - newCount };
}
