// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @/lib/supabase/service
// ---------------------------------------------------------------------------
//
// We build an in-memory Map that mirrors the rate_limit_buckets table:
//   key = `${world_user_id}|${bucket_key}|${window_start}`
//   value = count (number)
//
// The mock implements two Supabase operations used by rateLimit():
//   db.rpc('rate_limit_increment', { p_world_user_id, p_bucket_key, p_window_start })
//   db.from('rate_limit_buckets').delete().lt('window_start', threshold)

const db = new Map<string, number>();

function rowKey(world_user_id: string, bucket_key: string, window_start: string): string {
  return `${world_user_id}|${bucket_key}|${window_start}`;
}

// Simulate the atomic INSERT...ON CONFLICT DO UPDATE, returning new count.
function atomicIncrement(world_user_id: string, bucket_key: string, window_start: string): number {
  const key = rowKey(world_user_id, bucket_key, window_start);
  const current = db.get(key) ?? 0;
  const next = current + 1;
  db.set(key, next);
  return next;
}

// Minimal chainable builder for .from('rate_limit_buckets').delete().lt(...)
function makeDeleteBuilder() {
  const filters: Array<{ col: string; val: string }> = [];

  const builder = {
    lt(col: string, val: string) {
      filters.push({ col, val });
      // Execute delete for matching rows.
      for (const [key] of Array.from(db.entries())) {
        const parts = key.split('|');
        const window_start = parts[2];
        if (col === 'window_start' && window_start < val) {
          db.delete(key);
        }
      }
      return builder;
    },
  };
  return builder;
}

function makeFromBuilder(_table: string) {
  return {
    delete() {
      return makeDeleteBuilder();
    },
  };
}

const mockGetServiceClient = vi.fn(() => ({
  rpc: (
    fn: string,
    args: { p_world_user_id: string; p_bucket_key: string; p_window_start: string },
  ) => {
    if (fn === 'rate_limit_increment') {
      const count = atomicIncrement(args.p_world_user_id, args.p_bucket_key, args.p_window_start);
      return Promise.resolve({ data: count, error: null });
    }
    return Promise.resolve({ data: null, error: { message: `unknown rpc: ${fn}` } });
  },
  from: (table: string) => makeFromBuilder(table),
}));

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: () => mockGetServiceClient(),
}));

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are registered.
// ---------------------------------------------------------------------------
import { rateLimit, agentAnswerRateLimit } from '../rate-limit';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOpts(overrides: Partial<Parameters<typeof rateLimit>[0]> = {}) {
  return {
    world_user_id: 'user-aaa',
    bucket_key: 'agent-answer',
    max: 30,
    windowSeconds: 60,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('agentAnswerRateLimit constant', () => {
  it('exports max=30 windowSeconds=60', () => {
    expect(agentAnswerRateLimit.max).toBe(30);
    expect(agentAnswerRateLimit.windowSeconds).toBe(60);
  });
});

describe('rateLimit', () => {
  beforeEach(() => {
    db.clear();
    vi.useFakeTimers();
    // Pin to a stable time well within a 60s window.
    vi.setSystemTime(new Date('2025-01-01T00:00:10.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ── 30 sequential calls → all ok, decreasing remaining ─────────────────

  it('allows 30 sequential calls with decreasing remaining', async () => {
    const opts = makeOpts();
    for (let i = 1; i <= 30; i++) {
      const result = await rateLimit(opts);
      expect(result.ok, `call ${i} should be ok`).toBe(true);
      expect(result.remaining, `call ${i} remaining`).toBe(30 - i);
    }
  });

  // ── 31st call → blocked ─────────────────────────────────────────────────

  it('blocks the 31st call and returns ok=false with retryAfterSeconds in (0, 60]', async () => {
    const opts = makeOpts();
    for (let i = 0; i < 30; i++) {
      await rateLimit(opts);
    }
    const result = await rateLimit(opts);
    expect(result.ok).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  // ── Different bucket_keys are independent ───────────────────────────────

  it('treats different bucket_keys as independent counters', async () => {
    const user = 'user-bbb';
    // Exhaust bucket A.
    for (let i = 0; i < 30; i++) {
      await rateLimit(makeOpts({ world_user_id: user, bucket_key: 'bucket-A' }));
    }
    const blockedA = await rateLimit(makeOpts({ world_user_id: user, bucket_key: 'bucket-A' }));
    expect(blockedA.ok).toBe(false);

    // bucket B should still be at its first call.
    const firstB = await rateLimit(makeOpts({ world_user_id: user, bucket_key: 'bucket-B' }));
    expect(firstB.ok).toBe(true);
    expect(firstB.remaining).toBe(29); // max=30, used=1
  });

  // ── Different world_user_ids are independent ────────────────────────────

  it('treats different world_user_ids as independent counters', async () => {
    const bucket = 'shared-bucket';
    // Exhaust user1.
    for (let i = 0; i < 30; i++) {
      await rateLimit(makeOpts({ world_user_id: 'user-1', bucket_key: bucket }));
    }
    const blockedUser1 = await rateLimit(makeOpts({ world_user_id: 'user-1', bucket_key: bucket }));
    expect(blockedUser1.ok).toBe(false);

    // user2 should be fresh.
    const firstUser2 = await rateLimit(makeOpts({ world_user_id: 'user-2', bucket_key: bucket }));
    expect(firstUser2.ok).toBe(true);
    expect(firstUser2.remaining).toBe(29);
  });

  // ── Window expiry resets count ──────────────────────────────────────────

  it('resets the count when the window advances past windowSeconds', async () => {
    const opts = makeOpts({ windowSeconds: 60 });

    // Make 30 calls in the first window (window_start = 00:00:00).
    for (let i = 0; i < 30; i++) {
      await rateLimit(opts);
    }
    // 31st call in same window → blocked.
    const blocked = await rateLimit(opts);
    expect(blocked.ok).toBe(false);

    // Advance time into the next window (61 seconds later).
    vi.advanceTimersByTime(61 * 1000);

    // First call in the new window should succeed and reset count to 1.
    const newWindow = await rateLimit(opts);
    expect(newWindow.ok).toBe(true);
    expect(newWindow.remaining).toBe(29); // max=30, used=1
  });
});
