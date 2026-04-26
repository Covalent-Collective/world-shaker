import 'server-only';

import { PostHog } from 'posthog-node';
import { hashCohort, setPosthogIdentity } from './cohort';

let cached: PostHog | null = null;

/**
 * Server-side PostHog client for capturing backend events
 * (cron job runs, LLM cost, abuse signals).
 *
 * Identification: distinct_id is always the cohort hash
 * (sha256(world_user_id:salt)), never the raw id.
 */
export function getPostHogServer(): PostHog | null {
  if (cached) return cached;
  const key = process.env.POSTHOG_PROJECT_API_KEY ?? process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return null;
  cached = new PostHog(key, {
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
    flushAt: 1,
    flushInterval: 0,
  });
  return cached;
}

/**
 * Capture a server-side event in PostHog.
 *
 * The distinct_id is always derived from worldUserId via hashCohort()
 * (sha256(worldUserId:salt)). Raw world user IDs are never forwarded to PostHog.
 */
export async function captureServer(
  eventName: string,
  opts: { worldUserId: string; properties?: Record<string, unknown> },
): Promise<void> {
  const ph = getPostHogServer();
  if (!ph) return;
  const distinctId = await hashCohort(opts.worldUserId);
  ph.capture({
    distinctId,
    event: eventName,
    properties: opts.properties,
  });
  await ph.flush();
}

/**
 * Fire-and-forget capture that never throws. Use for analytics on hot paths
 * where hashing failure or PostHog unavailability must not break the product.
 *
 * - Hashes worldUserId via captureServer (privacy invariant preserved)
 * - Hashes any property values matching `hashProperties` keys via hashCohort
 * - Catches and logs failures; does NOT propagate
 * - Returns void; do NOT await for product correctness
 */
export async function captureServerSafe(
  event: string,
  opts: {
    worldUserId: string;
    properties?: Record<string, unknown>;
    hashProperties?: string[]; // keys whose values must be hashed before send
  },
): Promise<void> {
  try {
    const ph = getPostHogServer();
    if (!ph) return; // PostHog disabled — no-op

    let properties: Record<string, unknown> = opts.properties ?? {};
    if (opts.hashProperties && opts.hashProperties.length > 0) {
      const hashed: Record<string, unknown> = { ...properties };
      for (const key of opts.hashProperties) {
        const value = hashed[key];
        if (typeof value === 'string') {
          hashed[key] = await hashCohort(value);
        }
      }
      properties = hashed;
    }

    await captureServer(event, { worldUserId: opts.worldUserId, properties });
  } catch (err) {
    // Analytics must never fail the product flow.
    console.warn('[posthog] captureServerSafe error', { event, err });
  }
}

/**
 * Identify a server-side PostHog session using the cohort hash as distinct_id.
 * Wraps `setPosthogIdentity` from `lib/posthog/cohort.ts` with a PostHog Node
 * client that conforms to the expected identify interface.
 */
export async function identifyServer(world_user_id: string): Promise<void> {
  const ph = getPostHogServer();
  if (!ph) return;
  await setPosthogIdentity(
    {
      identify: ({ distinctId, properties }) => ph.identify({ distinctId, properties }),
    },
    world_user_id,
  );
  await ph.flush();
}
