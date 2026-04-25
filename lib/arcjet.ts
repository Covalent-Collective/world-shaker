import 'server-only';

import arcjet, { detectBot, shield, tokenBucket } from '@arcjet/next';

/**
 * Shared Arcjet instance for the project.
 *
 * Apply per-route policies via `aj.withRule(...)` in route handlers.
 *
 * Defaults:
 *   - shield: blocks common attack patterns (SQLi, XSS, path traversal)
 *   - detectBot: allows verified search engines, blocks unwanted automation
 *
 * Endpoints under /api/verify and /api/wallet-auth additionally use a
 * tokenBucket rate limiter — see usage in those route handlers.
 */
export const aj = arcjet({
  key: process.env.ARCJET_KEY!,
  characteristics: ['ip.src'],
  rules: [
    shield({ mode: 'LIVE' }),
    detectBot({
      mode: 'LIVE',
      allow: ['CATEGORY:SEARCH_ENGINE', 'CATEGORY:PREVIEW'],
    }),
  ],
});

/** Pre-configured rate limiter for verification endpoints. */
export const verifyRateLimit = tokenBucket({
  mode: 'LIVE',
  refillRate: 5,
  interval: 60,
  capacity: 10,
});
