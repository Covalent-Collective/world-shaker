import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal Supabase client mock types
// ---------------------------------------------------------------------------

type SelectBuilder = {
  eq: (col: string, val: string) => SelectBuilder;
  gte: (col: string, val: string) => SelectBuilder;
  lt: (col: string, val: string) => SelectBuilder;
  single: () => Promise<{ data: { timezone: string } | null; error: null }>;
  // head:true path returns count
  then?: never;
  _resolve?: () => Promise<{ count: number | null; error: null }>;
};

type MockClient = {
  from: (table: string) => {
    select: (cols: string, opts?: { count?: string; head?: boolean }) => SelectBuilder;
  };
};

// ---------------------------------------------------------------------------
// Module mock
// ---------------------------------------------------------------------------

const mockSelect = vi.fn();
const mockFrom = vi.fn(() => ({ select: mockSelect }));
const mockGetServiceClient = vi.fn((): MockClient => ({ from: mockFrom }));

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: () => mockGetServiceClient(),
}));

// Import AFTER mock is registered.
import { getDailyQuota, DAILY_QUOTA_MAX } from '../daily';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a chainable select mock that:
 *  - returns `timezone` on the .single() path (users table query)
 *  - returns `count` on the head:true path (outcome_events count query)
 */
function buildSelectChain(timezone: string, viewedCount: number) {
  // The outcome_events count query: .select('id', {count:'exact', head:true})
  // chains .eq().eq().gte().lt() then resolves.
  const countChain = {
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    then: undefined, // not a thenable itself — resolved via the chain return
  } as unknown as SelectBuilder;

  // Make the final chain resolve to {count, error:null}
  (countChain as unknown as Record<string, unknown>).lt = vi
    .fn()
    .mockResolvedValue({ count: viewedCount, error: null });
  (countChain as unknown as Record<string, unknown>).gte = vi.fn().mockReturnValue(countChain);
  (countChain as unknown as Record<string, unknown>).eq = vi.fn().mockReturnValue(countChain);

  // The users query: .select('timezone').eq().single()
  const userChain = {
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { timezone }, error: null }),
  } as unknown as SelectBuilder;

  // mockSelect: first call (users.select('timezone')) → userChain
  //             second call (outcome_events.select('id', {count,head})) → countChain
  mockSelect.mockReturnValueOnce(userChain).mockReturnValueOnce(countChain);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getDailyQuota', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue({ select: mockSelect });
    mockGetServiceClient.mockReturnValue({ from: mockFrom } as unknown as MockClient);
  });

  it('exports DAILY_QUOTA_MAX = 4', () => {
    expect(DAILY_QUOTA_MAX).toBe(4);
  });

  it('returns used=0, max=4 when no viewed events', async () => {
    buildSelectChain('Asia/Seoul', 0);

    const result = await getDailyQuota('user-uuid-1');

    expect(result.used).toBe(0);
    expect(result.max).toBe(4);
    expect(result.nextResetAt).toBeInstanceOf(Date);
  });

  it('returns used=3, max=4 when 3 viewed events (below limit)', async () => {
    buildSelectChain('Asia/Seoul', 3);

    const result = await getDailyQuota('user-uuid-2');

    expect(result.used).toBe(3);
    expect(result.max).toBe(4);
  });

  it('returns used=4, max=4 when 4 viewed events (at limit)', async () => {
    buildSelectChain('Asia/Seoul', 4);

    const result = await getDailyQuota('user-uuid-3');

    expect(result.used).toBe(4);
    expect(result.max).toBe(4);
  });

  describe('timezone boundary: same UTC moment, different day boundaries', () => {
    /**
     * Pick a UTC moment that falls on different calendar days for Seoul vs UTC:
     *   2024-03-15 00:30:00 UTC
     *   = 2024-03-15 09:30:00 KST (same day)
     *   = 2024-03-15 00:30:00 UTC (same day for UTC user)
     *
     * A cleaner split:
     *   2024-03-15 15:00:00 UTC  → 2024-03-16 00:00:00 KST (next day in Seoul)
     *   Seoul user's day starts 2024-03-16 00:00 KST = 2024-03-15 15:00 UTC
     *   UTC user's day starts   2024-03-15 00:00 UTC
     *
     * We validate that nextResetAt (dayEnd) differs between the two users.
     */
    it('Seoul user has nextResetAt 9 hours earlier (UTC) than UTC user', async () => {
      // Query 1: Seoul user
      buildSelectChain('Asia/Seoul', 0);
      const seoulResult = await getDailyQuota('user-seoul');

      vi.clearAllMocks();
      mockFrom.mockReturnValue({ select: mockSelect });
      mockGetServiceClient.mockReturnValue({ from: mockFrom } as unknown as MockClient);

      // Query 2: UTC user
      buildSelectChain('UTC', 0);
      const utcResult = await getDailyQuota('user-utc');

      // Both nextResetAt values must be valid Dates
      expect(seoulResult.nextResetAt).toBeInstanceOf(Date);
      expect(utcResult.nextResetAt).toBeInstanceOf(Date);

      // Seoul day boundary is always 15:00 UTC (= midnight KST next day)
      // UTC day boundary is always 00:00 UTC
      // They must differ by 9 hours (= 9 * 3600 * 1000 ms).
      //
      // Both are computed relative to "now" so we compare the hour-of-day in UTC:
      //   Seoul nextResetAt UTC hour = 15
      //   UTC   nextResetAt UTC hour = 0
      const seoulHour = seoulResult.nextResetAt.getUTCHours();
      const utcHour = utcResult.nextResetAt.getUTCHours();

      // Seoul resets at 15:00 UTC (midnight Seoul = 00:00 KST next day)
      expect(seoulHour).toBe(15);
      // UTC resets at 00:00 UTC
      expect(utcHour).toBe(0);

      // The two nextResetAt values must not be equal
      expect(seoulResult.nextResetAt.getTime()).not.toBe(utcResult.nextResetAt.getTime());
    });
  });

  it('nextResetAt is a Date set to midnight of next user-local day in UTC', async () => {
    buildSelectChain('Asia/Seoul', 1);
    const result = await getDailyQuota('user-uuid-4');

    // dayEnd should be exactly at 15:00 UTC (midnight Seoul KST)
    expect(result.nextResetAt.getUTCHours()).toBe(15);
    expect(result.nextResetAt.getUTCMinutes()).toBe(0);
    expect(result.nextResetAt.getUTCSeconds()).toBe(0);
    expect(result.nextResetAt.getUTCMilliseconds()).toBe(0);
  });
});
