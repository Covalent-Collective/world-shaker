import 'server-only';

import { PostHog } from 'posthog-node';
import { setPosthogIdentity } from './cohort';

let cached: PostHog | null = null;

/**
 * Server-side PostHog client for capturing backend events
 * (cron job runs, LLM cost, abuse signals).
 *
 * Identification: use `identifyServer(ph, world_user_id)` so the distinct_id
 * is always the cohort hash (sha256(world_user_id:salt)), never the raw id.
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

export async function captureServer(args: {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
}) {
  const ph = getPostHogServer();
  if (!ph) return;
  ph.capture({
    distinctId: args.distinctId,
    event: args.event,
    properties: args.properties,
  });
  await ph.flush();
}

/**
 * Identify a server-side PostHog session using the cohort hash as distinct_id.
 * Wraps `setPosthogIdentity` from `lib/posthog/cohort.ts` with a PostHog Node
 * client that conforms to the expected identify interface.
 *
 * @param world_user_id - The caller's raw World ID (never sent to PostHog).
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
