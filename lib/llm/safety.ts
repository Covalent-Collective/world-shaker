import 'server-only';

import { getServiceClient } from '@/lib/supabase/service';
import { getPostHogServer } from '@/lib/posthog/server';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const MODERATION_MODEL = 'openai/omni-moderation-latest';
const FETCH_TIMEOUT_MS = 800;
const BREAKER_WINDOW_MS = 60_000; // 60 seconds
const BREAKER_THRESHOLD = 3; // failures before opening
const TRIGRAM_OVERLAP_THRESHOLD = 0.8; // 80% overlap triggers loop detection
const LOOP_WINDOW = 5; // check last N turns

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModerationReason = 'degraded' | 'flagged' | 'clean';

export interface ModerationResult {
  flagged: boolean;
  categories?: Record<string, number>;
  reason?: ModerationReason;
}

interface BreakerEntry {
  failures: number;
  openedAt: number; // ms timestamp
}

// ---------------------------------------------------------------------------
// In-memory circuit breaker state
// ---------------------------------------------------------------------------

const breakerState = new Map<string, BreakerEntry>();

/**
 * Reset breaker state for a provider. Used in tests only.
 * @internal
 */
export function _resetBreakerForTesting(provider?: string): void {
  if (provider) {
    breakerState.delete(provider);
  } else {
    breakerState.clear();
  }
}

function getBreakerEntry(provider: string): BreakerEntry {
  return breakerState.get(provider) ?? { failures: 0, openedAt: 0 };
}

function isBreakOpen(entry: BreakerEntry, now: number): boolean {
  return entry.openedAt > 0 && now - entry.openedAt < BREAKER_WINDOW_MS;
}

function isHalfOpen(entry: BreakerEntry, now: number): boolean {
  return entry.openedAt > 0 && now - entry.openedAt >= BREAKER_WINDOW_MS;
}

async function recordFailure(provider: string): Promise<void> {
  const entry = getBreakerEntry(provider);
  const now = Date.now();

  // Increment in-memory failure count.
  const newFailures = entry.failures + 1;
  const openedAt = newFailures >= BREAKER_THRESHOLD ? now : entry.openedAt;
  breakerState.set(provider, { failures: newFailures, openedAt });

  // Persist to Supabase after hitting the threshold.
  if (newFailures >= BREAKER_THRESHOLD) {
    try {
      const client = getServiceClient();
      await client.rpc('increment_moderation_breaker_failures', { p_provider: provider });
    } catch {
      // Non-fatal: in-memory state is authoritative for this process.
    }
  }
}

async function recordSuccess(provider: string): Promise<void> {
  breakerState.set(provider, { failures: 0, openedAt: 0 });
  try {
    const client = getServiceClient();
    await client.rpc('reset_moderation_breaker', { p_provider: provider });
  } catch {
    // Non-fatal.
  }
}

// ---------------------------------------------------------------------------
// Trigram helpers for repeat-loop detection
// ---------------------------------------------------------------------------

function trigrams(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const result = new Set<string>();
  for (let i = 0; i <= normalized.length - 3; i++) {
    result.add(normalized.slice(i, i + 3));
  }
  return result;
}

function trigramOverlap(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;

  let shared = 0;
  for (const tri of ta) {
    if (tb.has(tri)) shared++;
  }
  const union = ta.size + tb.size - shared;
  return shared / union;
}

// ---------------------------------------------------------------------------
// detectRepeatLoop — deterministic, synchronous
// ---------------------------------------------------------------------------

/**
 * Returns true if the last 5 turns exhibit >= 80% pairwise trigram overlap,
 * indicating the conversation is stuck in a repetition loop.
 */
export function detectRepeatLoop(turns: string[]): boolean {
  const window = turns.slice(-LOOP_WINDOW);
  if (window.length < 2) return false;

  for (let i = 0; i < window.length - 1; i++) {
    for (let j = i + 1; j < window.length; j++) {
      if (trigramOverlap(window[i], window[j]) >= TRIGRAM_OVERLAP_THRESHOLD) {
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// OpenRouter moderation call
// ---------------------------------------------------------------------------

interface OpenRouterModerationResult {
  results: Array<{
    categories: Record<string, boolean>;
    category_scores: Record<string, number>;
    flagged: boolean;
  }>;
}

type FailureKind = 'failure' | 'bug' | 'clean';

interface FetchOutcome {
  kind: FailureKind;
  categories?: Record<string, number>;
}

async function callModeration(text: string): Promise<FetchOutcome> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('safety: OPENROUTER_API_KEY missing');
    return { kind: 'failure' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${OPENROUTER_BASE_URL}/moderations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'https://world-shaker.local',
        'X-Title': 'World Shaker',
      },
      body: JSON.stringify({ model: MODERATION_MODEL, input: text }),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timer);
    // AbortError = timeout — counts as failure.
    if (err instanceof Error && err.name === 'AbortError') {
      return { kind: 'failure' };
    }
    // Network error — counts as failure.
    return { kind: 'failure' };
  }
  clearTimeout(timer);

  // HTTP 5xx and 429 → failures.
  if (response.status >= 500 || response.status === 429) {
    return { kind: 'failure' };
  }

  // Other 4xx (bugs, not transient failures).
  if (response.status >= 400) {
    let errorCode: string | undefined;
    try {
      const body = (await response.json()) as { error?: { code?: string } };
      errorCode = body?.error?.code;
    } catch {
      // ignore parse error
    }

    // content_policy refusal → failure (not bug).
    if (errorCode === 'content_policy') {
      return { kind: 'failure' };
    }

    // All other 4xx → bug path.
    return { kind: 'bug' };
  }

  // Parse the response body.
  let body: OpenRouterModerationResult;
  try {
    body = (await response.json()) as OpenRouterModerationResult;
  } catch {
    // Malformed JSON → failure.
    return { kind: 'failure' };
  }

  const result = body?.results?.[0];
  if (!result || typeof result.category_scores !== 'object' || result.category_scores === null) {
    // Missing or non-object categories → failure (malformed).
    return { kind: 'failure' };
  }

  // Validate that all scores are numeric.
  const scores = result.category_scores;
  for (const val of Object.values(scores)) {
    if (typeof val !== 'number') {
      return { kind: 'failure' };
    }
  }

  return { kind: 'clean', categories: scores };
}

// ---------------------------------------------------------------------------
// Shared moderation driver with circuit breaker
// ---------------------------------------------------------------------------

const PROVIDER = 'openrouter';

async function runModeration(text: string): Promise<FetchOutcome> {
  const now = Date.now();
  const entry = getBreakerEntry(PROVIDER);

  // Breaker open — skip network call.
  if (isBreakOpen(entry, now)) {
    return { kind: 'failure' };
  }

  // Half-open — allow one probe call.
  const outcome = await callModeration(text);

  if (outcome.kind === 'failure') {
    await recordFailure(PROVIDER);
    return { kind: 'failure' };
  }

  if (outcome.kind === 'bug') {
    // Bug: do NOT increment breaker; but fail-CLOSED.
    return { kind: 'bug' };
  }

  // Success — reset breaker if it was half-open.
  if (isHalfOpen(entry, now)) {
    await recordSuccess(PROVIDER);
  } else if (entry.failures > 0) {
    // Partial recovery: reset in-memory count.
    breakerState.set(PROVIDER, { failures: 0, openedAt: 0 });
  }

  return outcome;
}

// ---------------------------------------------------------------------------
// detectHostileTone
// ---------------------------------------------------------------------------

/**
 * Calls the moderation endpoint and flags if harassment >= 0.5 or hate >= 0.5.
 * On provider failure (timeout, 5xx, 429, malformed response) returns
 * { flagged: true, reason: 'degraded' } (fail-CLOSED).
 */
export async function detectHostileTone(text: string): Promise<ModerationResult> {
  const outcome = await runModeration(text);

  if (outcome.kind === 'failure' || outcome.kind === 'bug') {
    if (outcome.kind === 'bug') {
      console.error('safety: detectHostileTone received bug-class error from provider');
      // PostHog event fired without a real worldUserId — use anonymous sentinel.
      try {
        const ph = getPostHogServer();
        ph?.capture({
          distinctId: 'system',
          event: 'safety_provider_bug',
          properties: { provider: PROVIDER, fn: 'detectHostileTone' },
        });
      } catch {
        // Non-fatal.
      }
    }
    return { flagged: true, reason: 'degraded' };
  }

  const cats = outcome.categories!;
  const harassment = cats['harassment'] ?? 0;
  const hate = cats['hate'] ?? 0;

  if (harassment >= 0.5 || hate >= 0.5) {
    return { flagged: true, categories: cats, reason: 'flagged' };
  }

  return { flagged: false, categories: cats, reason: 'clean' };
}

// ---------------------------------------------------------------------------
// detectNSFW
// ---------------------------------------------------------------------------

/**
 * Calls the moderation endpoint and flags if sexual >= 0.3 or
 * sexual/minors >= 0.01 (zero-tolerance).
 * On provider failure, returns { flagged: true, reason: 'degraded' } (fail-CLOSED).
 */
export async function detectNSFW(text: string): Promise<ModerationResult> {
  const outcome = await runModeration(text);

  if (outcome.kind === 'failure' || outcome.kind === 'bug') {
    if (outcome.kind === 'bug') {
      console.error('safety: detectNSFW received bug-class error from provider');
      try {
        const ph = getPostHogServer();
        ph?.capture({
          distinctId: 'system',
          event: 'safety_provider_bug',
          properties: { provider: PROVIDER, fn: 'detectNSFW' },
        });
      } catch {
        // Non-fatal.
      }
    }
    return { flagged: true, reason: 'degraded' };
  }

  const cats = outcome.categories!;
  const sexual = cats['sexual'] ?? 0;
  const sexualMinors = cats['sexual/minors'] ?? 0;

  if (sexual >= 0.3 || sexualMinors >= 0.01) {
    return { flagged: true, categories: cats, reason: 'flagged' };
  }

  return { flagged: false, categories: cats, reason: 'clean' };
}
