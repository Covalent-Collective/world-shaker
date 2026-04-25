'use client';

import posthog from 'posthog-js';

let initialized = false;

export function initPostHog() {
  if (initialized) return posthog;
  if (typeof window === 'undefined') return posthog;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return posthog;

  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
    person_profiles: 'identified_only',
    capture_pageview: false, // we capture manually after Next route changes
    capture_pageleave: true,
    autocapture: false, // be explicit about tracked events; cringe-as-feature transcripts must NOT be auto-captured
    disable_session_recording: false,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '[data-ph-mask]',
    },
    loaded: () => {
      initialized = true;
    },
  });

  return posthog;
}

export { posthog };

/**
 * Identify a client-side PostHog session using the cohort hash as distinct_id.
 *
 * Call this from client components after obtaining `world_user_id` from the
 * server session. The actual hashing happens server-side in
 * `lib/posthog/cohort.ts`; this helper accepts the pre-computed values so the
 * raw world_user_id never reaches the browser bundle.
 */
export function identifyClient(hashedDistinctId: string, predecessor: string | null): void {
  posthog.identify(hashedDistinctId, {
    posthog_cohort_predecessor: predecessor,
  });
}
