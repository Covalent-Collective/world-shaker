import 'server-only';

import { createHash } from 'crypto';
import { getServiceClient } from '@/lib/supabase/service';

// ---------------------------------------------------------------------------
// Salt cache — 5-minute in-process TTL.
// On salt rotation the old hash will be served for up to 5 min (acceptable;
// see US-013 / AC-19: "no eager invalidation needed; 5-min TTL is acceptable").
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface SaltCache {
  value: string;
  expiresAt: number;
}

let saltCache: SaltCache | null = null;

async function fetchSalt(): Promise<string> {
  const now = Date.now();

  if (saltCache && now < saltCache.expiresAt) {
    return saltCache.value;
  }

  const client = getServiceClient();
  const { data, error } = await client
    .from('app_settings')
    .select('posthog_cohort_salt')
    .eq('id', 1)
    .single();

  if (error || !data?.posthog_cohort_salt) {
    throw new Error(`Failed to fetch posthog_cohort_salt: ${error?.message ?? 'no data'}`);
  }

  saltCache = { value: data.posthog_cohort_salt, expiresAt: now + CACHE_TTL_MS };
  return saltCache.value;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Computes the PostHog cohort distinct_id for the given World ID user.
 *
 * Formula: sha256(<world_user_id> + ':' + <salt>) as lowercase hex (64 chars).
 *
 * The salt is fetched from `app_settings.posthog_cohort_salt` via the service
 * client and cached in-process for 5 minutes. On quarterly salt rotation the
 * cache naturally expires within the 5-min window; no eager invalidation is
 * required (see AC-19).
 *
 * Raw `world_user_id` never leaves the server.
 */
export async function hashCohort(world_user_id: string): Promise<string> {
  const salt = await fetchSalt();
  return createHash('sha256').update(`${world_user_id}:${salt}`).digest('hex');
}

/**
 * Returns the predecessor cohort hash for dashboard continuity across salt
 * rotations (retention/funnel queries can JOIN on the predecessor chain).
 *
 * v0: returns null. Full implementation is deferred to Step 4.9 (cohort
 * rotation Inngest fn) which will write the predecessor hash to
 * `users.posthog_cohort` before flipping the salt in `app_settings`.
 *
 * @param world_user_id - The caller's World ID user identifier.
 * @returns null in v0; in v1+ the previous quarter's cohort hash.
 */
export async function getPredecessorCohort(_world_user_id: string): Promise<string | null> {
  return null;
}

/**
 * Calls `client.identify` with:
 *   - `distinctId` = hashCohort(world_user_id)
 *   - `$set.posthog_cohort_predecessor` = getPredecessorCohort(world_user_id)
 *
 * Use this helper from both server-side (PostHog Node) and client-side
 * (posthog-js) wrappers so distinct_id is always the cohort hash, never the
 * raw World ID.
 *
 * The `client` parameter accepts any object with an `identify` method that
 * matches the posthog-js / posthog-node identify signature.
 */
export async function setPosthogIdentity(
  client: { identify: (args: { distinctId: string; properties: Record<string, unknown> }) => void },
  world_user_id: string,
): Promise<void> {
  const [distinctId, predecessor] = await Promise.all([
    hashCohort(world_user_id),
    getPredecessorCohort(world_user_id),
  ]);

  client.identify({
    distinctId,
    properties: {
      $set: {
        posthog_cohort_predecessor: predecessor,
      },
    },
  });
}
