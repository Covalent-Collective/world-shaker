// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @/lib/supabase/service
//
// safety.ts uses two surfaces on the service client:
//   1. .rpc('increment_moderation_breaker_failures' | 'reset_moderation_breaker')
//   2. .from('app_settings').select('moderation_breaker_state').eq('id', 1).maybeSingle()
// The mock returns whatever appSettingsStub.data currently holds for the
// app_settings read, and lets each test set explicit RPC responses on mockRpc.
// ---------------------------------------------------------------------------

const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });
const appSettingsStub: { data: unknown; error: unknown } = { data: null, error: null };
const mockMaybeSingle = vi.fn(() => Promise.resolve(appSettingsStub));

const mockGetServiceClient = vi.fn(() => ({
  rpc: mockRpc,
  from: (_table: string) => ({
    select: (_cols: string) => ({
      eq: (_col: string, _val: unknown) => ({
        maybeSingle: mockMaybeSingle,
      }),
    }),
  }),
}));

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: () => mockGetServiceClient(),
}));

// ---------------------------------------------------------------------------
// Mock @/lib/posthog/server
// ---------------------------------------------------------------------------

const mockCapture = vi.fn();
const mockGetPostHogServer = vi.fn(() => ({ capture: mockCapture }));

vi.mock('@/lib/posthog/server', () => ({
  getPostHogServer: () => mockGetPostHogServer(),
}));

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Helpers to build mock responses
// ---------------------------------------------------------------------------

function makeModResponse(categoryScores: Record<string, number>): Response {
  return new Response(
    JSON.stringify({
      results: [
        {
          flagged: false,
          categories: {},
          category_scores: categoryScores,
        },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function makeErrorResponse(status: number, body: object = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks are set up.
// ---------------------------------------------------------------------------

import {
  detectRepeatLoop,
  detectHostileTone,
  detectNSFW,
  _resetBreakerForTesting,
} from '../safety';

// ---------------------------------------------------------------------------
// Global setup: reset breaker + mocks before every test
// ---------------------------------------------------------------------------

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-key';
  _resetBreakerForTesting();
  mockFetch.mockReset();
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: null, error: null });
  appSettingsStub.data = null;
  appSettingsStub.error = null;
  mockMaybeSingle.mockClear();
  mockCapture.mockReset();
});

// Helpers to script the DB-backed breaker state.
function setAppSettingsBreaker(
  state: Record<string, { failures: number; opened_at: string }>,
): void {
  appSettingsStub.data = { moderation_breaker_state: state };
  appSettingsStub.error = null;
}

function makeIncrementResponse(failures: number, openedAt = new Date().toISOString()) {
  return { data: { failures, opened_at: openedAt }, error: null };
}

afterEach(() => {
  vi.useRealTimers();
});

// ===========================================================================
// detectRepeatLoop
// ===========================================================================

describe('detectRepeatLoop', () => {
  it('returns false for fewer than 2 turns', () => {
    expect(detectRepeatLoop([])).toBe(false);
    expect(detectRepeatLoop(['hello world'])).toBe(false);
  });

  it('detects substantial trigram overlap in last 5 turns (nearly identical)', () => {
    const turns = ['hi there', 'hi there', 'hi there', 'hi there', 'hi there'];
    expect(detectRepeatLoop(turns)).toBe(true);
  });

  it('detects loop: overlapping short phrases', () => {
    // 'hi' vs 'hi' → identical = 100% overlap → triggers
    const turns = ['hi', 'hi there', 'hi there friend', 'hi', 'hi'];
    expect(detectRepeatLoop(turns)).toBe(true);
  });

  it('returns false for 5 distinct sentences with no significant overlap', () => {
    const turns = [
      'The quick brown fox jumps over the lazy dog.',
      'I love programming in TypeScript and building things.',
      'The sunset painted the sky in shades of orange and pink.',
      'Quantum mechanics describes the behavior of subatomic particles.',
      'She decided to open a bakery specializing in sourdough bread.',
    ];
    expect(detectRepeatLoop(turns)).toBe(false);
  });

  it('only examines the last 5 turns (ignores older turns)', () => {
    // First 10 turns are identical — but last 5 are all distinct.
    const identical = Array(10).fill('hello world how are you doing today');
    const distinct = [
      'The quick brown fox jumped.',
      'Quantum mechanics is fascinating.',
      'She loves baking sourdough bread.',
      'Mountains and rivers define the landscape.',
      'Technology shapes modern civilization.',
    ];
    expect(detectRepeatLoop([...identical, ...distinct])).toBe(false);
  });
});

// ===========================================================================
// detectHostileTone
// ===========================================================================

describe('detectHostileTone', () => {
  it('clean text → flagged: false, reason: clean', async () => {
    mockFetch.mockResolvedValueOnce(makeModResponse({ harassment: 0.01, hate: 0.02, sexual: 0.0 }));

    const result = await detectHostileTone('Hello, how are you?');

    expect(result.flagged).toBe(false);
    expect(result.reason).toBe('clean');
    expect(result.categories).toBeDefined();
  });

  it('hostile text with harassment >= 0.5 → flagged: true, reason: flagged', async () => {
    mockFetch.mockResolvedValueOnce(makeModResponse({ harassment: 0.6, hate: 0.1, sexual: 0.0 }));

    const result = await detectHostileTone('You are absolutely terrible!');

    expect(result.flagged).toBe(true);
    expect(result.reason).toBe('flagged');
    expect(result.categories?.['harassment']).toBe(0.6);
  });

  it('hate score >= 0.5 → flagged: true, reason: flagged', async () => {
    mockFetch.mockResolvedValueOnce(makeModResponse({ harassment: 0.1, hate: 0.7, sexual: 0.0 }));

    const result = await detectHostileTone('hateful text here');

    expect(result.flagged).toBe(true);
    expect(result.reason).toBe('flagged');
    expect(result.categories?.['hate']).toBe(0.7);
  });

  it('exactly at threshold (0.5) → flagged: true', async () => {
    mockFetch.mockResolvedValueOnce(makeModResponse({ harassment: 0.5, hate: 0.0 }));

    const result = await detectHostileTone('borderline text');
    expect(result.flagged).toBe(true);
  });

  it('HTTP 5xx → flagged: true, reason: degraded', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(503));

    const result = await detectHostileTone('some text');

    expect(result.flagged).toBe(true);
    expect(result.reason).toBe('degraded');
  });

  it('HTTP 429 → flagged: true, reason: degraded', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(429));

    const result = await detectHostileTone('some text');

    expect(result.flagged).toBe(true);
    expect(result.reason).toBe('degraded');
  });

  it('malformed JSON body → flagged: true, reason: degraded', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('not json at all!!!', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await detectHostileTone('some text');

    expect(result.flagged).toBe(true);
    expect(result.reason).toBe('degraded');
  });

  it('response missing category_scores → flagged: true, reason: degraded', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [{ flagged: false }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await detectHostileTone('some text');

    expect(result.flagged).toBe(true);
    expect(result.reason).toBe('degraded');
  });

  it('timeout (5s abort) → flagged: true, reason: degraded', async () => {
    vi.useFakeTimers();

    // fetch never resolves; rejects on abort signal.
    mockFetch.mockImplementationOnce(
      (_url: string, opts: { signal: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    );

    const resultPromise = detectHostileTone('some text');

    // Flush microtasks so loadBreakerState() resolves and callModeration()
    // schedules its abort timer BEFORE we advance fake time. Timer is
    // FETCH_TIMEOUT_MS (5000ms) — advance past it.
    await vi.advanceTimersByTimeAsync(5100);

    const result = await resultPromise;

    expect(result.flagged).toBe(true);
    expect(result.reason).toBe('degraded');
  });

  it('4xx bug error (non content_policy) → flagged: true, reason: degraded, fires posthog event', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(400, { error: { code: 'bad_request' } }));

    const result = await detectHostileTone('some text');

    expect(result.flagged).toBe(true);
    expect(result.reason).toBe('degraded');
    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'safety_provider_bug' }),
    );
  });

  it('content_policy error code → flagged: true, reason: degraded (not bug, no posthog)', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(400, { error: { code: 'content_policy' } }));

    const result = await detectHostileTone('some text');

    expect(result.flagged).toBe(true);
    expect(result.reason).toBe('degraded');
    // content_policy is classified as failure, not bug — no posthog event
    expect(mockCapture).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// detectNSFW
// ===========================================================================

describe('detectNSFW', () => {
  it('clean text → flagged: false, reason: clean', async () => {
    mockFetch.mockResolvedValueOnce(
      makeModResponse({ sexual: 0.01, 'sexual/minors': 0.0, harassment: 0.0 }),
    );

    const result = await detectNSFW('Let us discuss cooking techniques.');

    expect(result.flagged).toBe(false);
    expect(result.reason).toBe('clean');
  });

  it('sexual >= 0.3 → flagged: true, reason: flagged', async () => {
    mockFetch.mockResolvedValueOnce(makeModResponse({ sexual: 0.4, 'sexual/minors': 0.0 }));

    const result = await detectNSFW('explicit text');

    expect(result.flagged).toBe(true);
    expect(result.reason).toBe('flagged');
    expect(result.categories?.['sexual']).toBe(0.4);
  });

  it('sexual/minors >= 0.01 (zero-tolerance) → flagged: true', async () => {
    mockFetch.mockResolvedValueOnce(makeModResponse({ sexual: 0.0, 'sexual/minors': 0.01 }));

    const result = await detectNSFW('text');

    expect(result.flagged).toBe(true);
    expect(result.reason).toBe('flagged');
  });

  it('sexual/minors just below zero-tolerance (0.009) → flagged: false', async () => {
    mockFetch.mockResolvedValueOnce(makeModResponse({ sexual: 0.0, 'sexual/minors': 0.009 }));

    const result = await detectNSFW('text');

    expect(result.flagged).toBe(false);
  });

  it('HTTP 5xx → flagged: true, reason: degraded', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(500));

    const result = await detectNSFW('some text');

    expect(result.flagged).toBe(true);
    expect(result.reason).toBe('degraded');
  });
});

// ===========================================================================
// Circuit breaker
// ===========================================================================

describe('circuit breaker (DB-backed state)', () => {
  // _resetBreakerForTesting() is called in the global beforeEach above,
  // so each test starts with an empty in-memory cache. The DB stub
  // (appSettingsStub) starts empty, meaning "breaker closed".

  it('after 3 failures within 60s, 4th call skips network and returns degraded (cache hit, no DB read)', async () => {
    // Each provider failure → RPC returns the new (incremented) state.
    mockRpc
      .mockResolvedValueOnce(makeIncrementResponse(1))
      .mockResolvedValueOnce(makeIncrementResponse(2))
      .mockResolvedValueOnce(makeIncrementResponse(3));

    for (let i = 0; i < 3; i++) {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(503));
      const r = await detectHostileTone('text');
      expect(r.flagged).toBe(true);
      expect(r.reason).toBe('degraded');
    }

    // After the 3rd failure the cache holds { failures: 3, opened_at: ~now }.
    // The 4th call must NOT call fetch and must NOT re-read app_settings —
    // the cache (TTL 10s) is authoritative for this hot path.
    const maybeSingleBefore = mockMaybeSingle.mock.calls.length;

    mockFetch.mockResolvedValueOnce(makeModResponse({ harassment: 0.0, hate: 0.0 }));
    const result = await detectHostileTone('text');

    expect(result.flagged).toBe(true);
    expect(result.reason).toBe('degraded');

    expect(mockFetch).toHaveBeenCalledTimes(3);
    // No additional app_settings read — cache covered it.
    expect(mockMaybeSingle.mock.calls.length).toBe(maybeSingleBefore);
  });

  it('calls increment_moderation_breaker_failures on every failure', async () => {
    mockRpc
      .mockResolvedValueOnce(makeIncrementResponse(1))
      .mockResolvedValueOnce(makeIncrementResponse(2))
      .mockResolvedValueOnce(makeIncrementResponse(3));

    for (let i = 0; i < 3; i++) {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(503));
      await detectHostileTone('text');
    }

    const incrementCalls = mockRpc.mock.calls.filter(
      (args) => args[0] === 'increment_moderation_breaker_failures',
    );
    expect(incrementCalls).toHaveLength(3);
    expect(incrementCalls[0][1]).toEqual({ p_provider: 'openrouter' });
  });

  it('treats DB-stored open breaker as authoritative on cold cache (no fetch)', async () => {
    // Simulate another process having opened the breaker recently.
    setAppSettingsBreaker({
      openrouter: { failures: 3, opened_at: new Date().toISOString() },
    });

    // First call has no in-memory cache — must read DB, see open, skip fetch.
    mockFetch.mockResolvedValueOnce(makeModResponse({ harassment: 0.0, hate: 0.0 }));
    const result = await detectHostileTone('text');

    expect(result.flagged).toBe(true);
    expect(result.reason).toBe('degraded');
    expect(mockFetch).not.toHaveBeenCalled();
    // app_settings read was attempted exactly once.
    expect(mockMaybeSingle).toHaveBeenCalledTimes(1);
  });

  it('after breaker window elapses (half-open), probe call resets breaker on success via reset RPC', async () => {
    // Open the breaker with a stored opened_at well in the past.
    const openedAtPast = new Date(Date.now() - 61_000).toISOString();
    setAppSettingsBreaker({
      openrouter: { failures: 3, opened_at: openedAtPast },
    });

    // Half-open: cold cache reads DB → sees half-open → allows probe.
    mockFetch.mockResolvedValueOnce(makeModResponse({ harassment: 0.1, hate: 0.0 }));
    const result = await detectHostileTone('hello world');

    expect(result.flagged).toBe(false);
    expect(result.reason).toBe('clean');

    expect(mockRpc).toHaveBeenCalledWith('reset_moderation_breaker', {
      p_provider: 'openrouter',
    });
  });

  it('success with failures > 0 (not half-open) calls reset RPC and clears counter', async () => {
    // Simulate 2 prior failures in the DB (breaker not yet open — threshold is 3).
    setAppSettingsBreaker({
      openrouter: { failures: 2, opened_at: new Date(0).toISOString() },
    });

    // Next call succeeds — breaker is closed but failures > 0.
    mockFetch.mockResolvedValueOnce(makeModResponse({ harassment: 0.0, hate: 0.0 }));
    const result = await detectHostileTone('clean text');

    expect(result.flagged).toBe(false);
    expect(result.reason).toBe('clean');

    // reset_moderation_breaker MUST be called even though we were not half-open.
    expect(mockRpc).toHaveBeenCalledWith('reset_moderation_breaker', {
      p_provider: 'openrouter',
    });
  });

  it('bug-class 4xx errors do NOT increment the breaker (no RPC call, breaker stays closed)', async () => {
    // 5 bug-class calls: none should call the increment RPC.
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(400, { error: { code: 'bad_request' } }));
      const r = await detectHostileTone('text');
      expect(r.flagged).toBe(true);
      expect(r.reason).toBe('degraded');
    }

    const incrementCalls = mockRpc.mock.calls.filter(
      (args) => args[0] === 'increment_moderation_breaker_failures',
    );
    expect(incrementCalls).toHaveLength(0);

    // 6th call should still hit the network (fetch called 6 times total).
    mockFetch.mockResolvedValueOnce(makeModResponse({ harassment: 0.0, hate: 0.0 }));
    await detectHostileTone('clean text');
    expect(mockFetch).toHaveBeenCalledTimes(6);
  });
});
