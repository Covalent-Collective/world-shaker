// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @/lib/supabase/service
// ---------------------------------------------------------------------------
//
// We build an in-memory Map that mirrors the rate_limit_buckets table:
//   key = `${world_user_id}|${bucket_key}|${window_start}`
//   value = { count: number }
//
// The mock returns chainable builder objects that replicate the Supabase JS
// query-builder interface used by rateLimit():
//   .from(table).select(...).eq(...).maybeSingle()
//   .from(table).insert({...})
//   .from(table).update({...}).eq(...)
//   .from(table).delete().lt(...)

type Row = { world_user_id: string; bucket_key: string; window_start: string; count: number };

const db = new Map<string, Row>();

function rowKey(world_user_id: string, bucket_key: string, window_start: string): string {
  return `${world_user_id}|${bucket_key}|${window_start}`;
}

// Minimal chainable builder factory.
function makeBuilder(table: string) {
  // Filters accumulated during chaining.
  const filters: Array<{ col: string; op: string; val: unknown }> = [];
  // Pending update payload.
  let updatePayload: Record<string, unknown> | null = null;
  // Whether we're in delete mode.
  let deleteMode = false;
  // Whether we're in select mode.
  let selectMode = false;

  function matchingRows(): Row[] {
    if (table !== 'rate_limit_buckets') return [];
    return Array.from(db.values()).filter((row) =>
      filters.every(({ col, op, val }) => {
        const rowVal = row[col as keyof Row];
        if (op === 'eq') return rowVal === val;
        if (op === 'lt') return rowVal < (val as string);
        return true;
      }),
    );
  }

  const builder: Record<string, unknown> = {};

  builder.select = (_cols?: string) => {
    selectMode = true;
    return builder;
  };

  builder.insert = (payload: Record<string, unknown>) => {
    // Execute immediately.
    if (table === 'rate_limit_buckets') {
      const key = rowKey(
        payload['world_user_id'] as string,
        payload['bucket_key'] as string,
        payload['window_start'] as string,
      );
      if (db.has(key)) {
        // Simulate unique constraint violation.
        return Promise.resolve({
          data: null,
          error: { code: '23505', message: 'unique violation' },
        });
      }
      db.set(key, {
        world_user_id: payload['world_user_id'] as string,
        bucket_key: payload['bucket_key'] as string,
        window_start: payload['window_start'] as string,
        count: payload['count'] as number,
      });
    }
    return Promise.resolve({ data: null, error: null });
  };

  builder.update = (payload: Record<string, unknown>) => {
    updatePayload = payload;
    // Return builder for chained .eq() calls.
    return builder;
  };

  builder.delete = () => {
    deleteMode = true;
    return builder;
  };

  builder.eq = (col: string, val: unknown) => {
    filters.push({ col, op: 'eq', val });
    return builder;
  };

  builder.lt = (col: string, val: unknown) => {
    filters.push({ col, op: 'lt', val });
    // Delete executes on .lt() terminal call.
    if (deleteMode && table === 'rate_limit_buckets') {
      const toDelete = matchingRows();
      toDelete.forEach((row) => {
        db.delete(rowKey(row.world_user_id, row.bucket_key, row.window_start));
      });
    }
    return builder;
  };

  builder.maybeSingle = () => {
    if (selectMode) {
      const rows = matchingRows();
      if (rows.length === 0) return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: rows[0], error: null });
    }
    return Promise.resolve({ data: null, error: null });
  };

  // Make the builder itself thenable so that .update().eq().eq() can be
  // awaited without calling .maybeSingle().
  (builder as Record<string, unknown>).then = (
    resolve: (v: { data: null; error: null }) => void,
  ) => {
    // Execute pending update on await.
    if (updatePayload !== null && table === 'rate_limit_buckets') {
      const rows = matchingRows();
      rows.forEach((row) => {
        const key = rowKey(row.world_user_id, row.bucket_key, row.window_start);
        db.set(key, { ...row, count: updatePayload!['count'] as number });
      });
    }
    resolve({ data: null, error: null });
  };

  return builder;
}

const mockGetServiceClient = vi.fn(() => ({
  from: (table: string) => makeBuilder(table),
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
