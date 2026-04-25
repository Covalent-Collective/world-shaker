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
 * Algorithm (atomic RPC):
 *  1. Compute window_start = epoch-aligned start of current window.
 *  2. Call rate_limit_increment(p_world_user_id, p_bucket_key, p_window_start) RPC.
 *     The RPC does INSERT...ON CONFLICT DO UPDATE atomically, returning new count.
 *  3. Evaluate new count against max.
 *  4. Opportunistically DELETE stale rows older than 1 hour (~1% of calls).
 */
export async function rateLimit(opts: RateLimitOpts): Promise<RateLimitResult> {
  const { world_user_id, bucket_key, max, windowSeconds } = opts;

  const nowMs = Date.now();
  const windowStartMs = Math.floor(nowMs / (windowSeconds * 1000)) * windowSeconds * 1000;
  const window_start = new Date(windowStartMs).toISOString();

  const db = getServiceClient();

  // Best-effort opportunistic cleanup of stale buckets (~1% of calls).
  if (Math.random() < 0.01) {
    const staleThreshold = new Date(nowMs - 3600 * 1000).toISOString();
    void db.from('rate_limit_buckets').delete().lt('window_start', staleThreshold);
  }

  const { data, error } = await db.rpc('rate_limit_increment', {
    p_world_user_id: world_user_id,
    p_bucket_key: bucket_key,
    p_window_start: window_start,
  });

  if (error) {
    console.error('[rate-limit] rpc error', error);
    // Fail open: allow the request.
    return { ok: true, retryAfterSeconds: 0, remaining: max };
  }

  const newCount = data as number;

  if (newCount > max) {
    const windowEndMs = windowStartMs + windowSeconds * 1000;
    const retryAfterSeconds = Math.max(0, Math.ceil((windowEndMs - Date.now()) / 1000));
    return { ok: false, retryAfterSeconds, remaining: 0 };
  }

  return { ok: true, retryAfterSeconds: 0, remaining: max - newCount };
}
