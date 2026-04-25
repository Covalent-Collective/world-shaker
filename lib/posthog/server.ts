import 'server-only';

import { PostHog } from 'posthog-node';

let cached: PostHog | null = null;

/**
 * Server-side PostHog client for capturing backend events
 * (cron job runs, LLM cost, abuse signals).
 *
 * Identification: pass `distinctId = world_user_id` so events stitch with
 * client-side events from the same user.
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
