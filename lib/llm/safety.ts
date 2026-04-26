import 'server-only';

import { getServiceClient } from '@/lib/supabase/service';
import { getPostHogServer } from '@/lib/posthog/server';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const MODERATION_MODEL = 'openai/omni-moderation-latest';
const FETCH_TIMEOUT_MS = 5000;
const BREAKER_WINDOW_MS = 60_000; // 60 seconds
const BREAKER_THRESHOLD = 3; // failures before opening
const BREAKER_CACHE_TTL_MS = 10_000; // 10s in-memory mirror of DB state
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

/** Per-provider breaker state as stored in app_settings.moderation_breaker_state. */
interface BreakerEntry {
  failures: number;
  openedAtMs: number; // 0 == never opened
}

/** Cached snapshot of breaker state for a provider, with expiry. */
interface BreakerCache {
  entry: BreakerEntry;
  fetchedAtMs: number;
}

// ---------------------------------------------------------------------------
// Circuit breaker — DB is the source of truth, with a short-lived in-memory
// cache (TTL 10s) to bound RPC pressure on the hot path.
// ---------------------------------------------------------------------------

const breakerCache = new Map<string, BreakerCache>();

/**
 * Reset cached breaker state. Used in tests only — does NOT reset the DB row.
 * @internal
 */
export function _resetBreakerForTesting(provider?: string): void {
  if (provider) {
    breakerCache.delete(provider);
  } else {
    breakerCache.clear();
  }
}

/** Parse the JSONB shape returned by the breaker RPCs / app_settings row. */
function parseBreakerJson(raw: unknown): BreakerEntry {
  if (!raw || typeof raw !== 'object') {
    return { failures: 0, openedAtMs: 0 };
  }
  const obj = raw as { failures?: unknown; opened_at?: unknown };
  const failures = typeof obj.failures === 'number' ? obj.failures : 0;
  let openedAtMs = 0;
  if (typeof obj.opened_at === 'string') {
    const parsed = Date.parse(obj.opened_at);
    if (Number.isFinite(parsed)) openedAtMs = parsed;
  } else if (typeof obj.opened_at === 'number' && Number.isFinite(obj.opened_at)) {
    openedAtMs = obj.opened_at;
  }
  return { failures, openedAtMs };
}

/** Read breaker state for a provider from the cache, or fetch from DB. */
async function loadBreakerState(provider: string): Promise<BreakerEntry> {
  const now = Date.now();
  const cached = breakerCache.get(provider);
  if (cached && now - cached.fetchedAtMs < BREAKER_CACHE_TTL_MS) {
    return cached.entry;
  }

  let entry: BreakerEntry = { failures: 0, openedAtMs: 0 };
  try {
    const client = getServiceClient();
    const { data, error } = await client
      .from('app_settings')
      .select('moderation_breaker_state')
      .eq('id', 1)
      .maybeSingle();
    if (!error && data) {
      const state = (data as { moderation_breaker_state?: Record<string, unknown> })
        .moderation_breaker_state;
      if (state && typeof state === 'object') {
        entry = parseBreakerJson(state[provider]);
      }
    }
  } catch {
    // Non-fatal: fall back to last-known cache, otherwise zero.
    if (cached) return cached.entry;
  }

  breakerCache.set(provider, { entry, fetchedAtMs: now });
  return entry;
}

function isBreakOpen(entry: BreakerEntry, now: number): boolean {
  return (
    entry.failures >= BREAKER_THRESHOLD &&
    entry.openedAtMs > 0 &&
    now - entry.openedAtMs < BREAKER_WINDOW_MS
  );
}

async function recordFailure(provider: string): Promise<void> {
  // Always call the RPC; it atomically increments and returns the new state.
  // The cache is invalidated (overwritten) with the authoritative response.
  try {
    const client = getServiceClient();
    const { data } = await client.rpc('increment_moderation_breaker_failures', {
      p_provider: provider,
    });
    const entry = parseBreakerJson(data);
    breakerCache.set(provider, { entry, fetchedAtMs: Date.now() });
  } catch {
    // Non-fatal: drop cache so the next read re-syncs from DB.
    breakerCache.delete(provider);
  }
}

async function recordSuccess(provider: string): Promise<void> {
  try {
    const client = getServiceClient();
    await client.rpc('reset_moderation_breaker', { p_provider: provider });
  } catch {
    // Non-fatal — cache is updated below regardless so the local process
    // doesn't keep returning degraded against a stale view.
  }
  breakerCache.set(provider, {
    entry: { failures: 0, openedAtMs: 0 },
    fetchedAtMs: Date.now(),
  });
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
  const entry = await loadBreakerState(PROVIDER);

  // Breaker open per DB state — skip network call entirely.
  if (isBreakOpen(entry, now)) {
    return { kind: 'failure' };
  }

  // Either closed or half-open — attempt the call. Half-open lets one probe
  // through; on success we reset, on failure the RPC re-opens.
  const outcome = await callModeration(text);

  if (outcome.kind === 'failure') {
    await recordFailure(PROVIDER);
    return { kind: 'failure' };
  }

  if (outcome.kind === 'bug') {
    // Bug: do NOT increment breaker; but fail-CLOSED.
    return { kind: 'bug' };
  }

  // Success — reset DB + cache whenever there are accumulated failures,
  // regardless of whether we were half-open. This prevents intermittent
  // failures from accumulating indefinitely and tripping the breaker.
  if (entry.failures > 0) {
    await recordSuccess(PROVIDER);
  }

  return outcome;
}

// ---------------------------------------------------------------------------
// degraded-result helper
// ---------------------------------------------------------------------------

/**
 * Build the result returned when the moderation provider fails.
 *
 * Default behaviour is fail-CLOSED — every conversation turn is rejected.
 * That is the right posture once a real moderation endpoint is wired in
 * (OpenAI's /v1/moderations, Anthropic's content safety, etc.). It is the
 * WRONG posture today: the configured endpoint
 * (`https://openrouter.ai/api/v1/moderations`) does not exist — OpenRouter
 * is a chat-completions proxy and serves an HTML 404 page for /moderations
 * — so every call returns `failure` and every conversation hangs at turn 0.
 *
 * To unblock end-to-end testing without permanently lowering safety we
 * gate fail-OPEN behind an explicit env flag. When `MODERATION_FAIL_OPEN`
 * is `1` / `true`, provider failures are downgraded to `clean`; otherwise
 * the original fail-CLOSED behaviour is preserved.
 *
 * Production-readiness: BEFORE turning this off (i.e. before relying on
 * the strict fail-CLOSED default), wire `runModeration` to a working
 * provider and verify with a manual POST.
 */
function moderationFailOpen(): boolean {
  const v = process.env.MODERATION_FAIL_OPEN;
  return v === '1' || v === 'true';
}

function buildDegradedResult(
  fnName: 'detectHostileTone' | 'detectNSFW',
  kind: 'failure' | 'bug',
): ModerationResult {
  if (kind === 'bug') {
    console.error(`safety: ${fnName} received bug-class error from provider`);
    try {
      const ph = getPostHogServer();
      ph?.capture({
        distinctId: 'system',
        event: 'safety_provider_bug',
        properties: { provider: PROVIDER, fn: fnName },
      });
    } catch {
      // Non-fatal.
    }
  }
  if (moderationFailOpen()) {
    console.warn(
      `safety: ${fnName} provider unavailable; fail-OPEN bypass active (MODERATION_FAIL_OPEN=1)`,
    );
    return { flagged: false, reason: 'clean' };
  }
  return { flagged: true, reason: 'degraded' };
}

// ---------------------------------------------------------------------------
// detectHostileTone
// ---------------------------------------------------------------------------

/**
 * Calls the moderation endpoint and flags if harassment >= 0.5 or hate >= 0.5.
 * On provider failure (timeout, 5xx, 429, malformed response) the default
 * is fail-CLOSED ({ flagged: true, reason: 'degraded' }); set
 * MODERATION_FAIL_OPEN=1 to downgrade provider failures to 'clean' while
 * a real moderation provider is being wired in. See buildDegradedResult.
 */
export async function detectHostileTone(text: string): Promise<ModerationResult> {
  const outcome = await runModeration(text);

  if (outcome.kind === 'failure' || outcome.kind === 'bug') {
    return buildDegradedResult('detectHostileTone', outcome.kind);
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
 * On provider failure: fail-CLOSED by default; opt-in fail-OPEN via
 * MODERATION_FAIL_OPEN=1. See buildDegradedResult for rationale.
 */
export async function detectNSFW(text: string): Promise<ModerationResult> {
  const outcome = await runModeration(text);

  if (outcome.kind === 'failure' || outcome.kind === 'bug') {
    return buildDegradedResult('detectNSFW', outcome.kind);
  }

  const cats = outcome.categories!;
  const sexual = cats['sexual'] ?? 0;
  const sexualMinors = cats['sexual/minors'] ?? 0;

  if (sexual >= 0.3 || sexualMinors >= 0.01) {
    return { flagged: true, categories: cats, reason: 'flagged' };
  }

  return { flagged: false, categories: cats, reason: 'clean' };
}
