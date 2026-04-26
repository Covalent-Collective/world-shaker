// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockRedirect, mockRpc } = vi.hoisted(() => ({
  mockRedirect: vi.fn(),
  mockRpc: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn(() => ({ value: 'valid-token' })) })),
}));

vi.mock('@/lib/auth/jwt', () => ({
  SESSION_COOKIE: 'ws_session',
  verifyWorldUserJwt: vi.fn().mockResolvedValue({
    world_user_id: 'user-alice',
    nullifier: 'null-abc',
    language_pref: 'ko',
  }),
}));

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: () => ({
    from: vi.fn((table: string) => {
      if (table === 'app_settings') {
        return {
          select: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: mockAppSettings,
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      };
    }),
    rpc: mockRpc,
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  getServerClient: vi.fn().mockResolvedValue({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { timezone: 'Asia/Seoul' }, error: null }),
        }),
      }),
    })),
  }),
}));

vi.mock('@/lib/quota/daily', () => ({
  getDailyQuota: vi.fn().mockResolvedValue({ used: 1, max: 4, nextResetAt: new Date() }),
}));

vi.mock('@/lib/i18n/getT', () => ({
  getT: vi.fn().mockResolvedValue((key: string) => key),
}));

vi.mock('../StrollClient', () => ({
  default: ({ candidates }: { candidates: unknown[] }) => (
    <div data-testid="stroll-client" data-count={candidates.length} />
  ),
}));

// ---------------------------------------------------------------------------
// Mutable settings state
// ---------------------------------------------------------------------------

let mockAppSettings: { streaming_paused: boolean; seed_pool_active: boolean } = {
  streaming_paused: false,
  seed_pool_active: true,
};

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import StrollPage from '../page';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StrollPage server component — seed_pool_active gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedirect.mockImplementation(() => {
      throw new Error('REDIRECT');
    });
    mockAppSettings = { streaming_paused: false, seed_pool_active: true };
    mockRpc.mockResolvedValue({ data: [], error: null });
  });

  it('calls match_candidates with include_seeds=true when seed_pool_active=true', async () => {
    mockAppSettings = { streaming_paused: false, seed_pool_active: true };
    mockRpc.mockResolvedValue({
      data: [{ candidate_user: 'user-bbb', score: 0.9, is_seed: false }],
      error: null,
    });

    await StrollPage();

    expect(mockRpc).toHaveBeenCalledWith(
      'match_candidates',
      expect.objectContaining({ include_seeds: true }),
    );
  });

  it('calls match_candidates with include_seeds=false when seed_pool_active=false', async () => {
    mockAppSettings = { streaming_paused: false, seed_pool_active: false };
    // SQL-level filter applied; mock returns only real users.
    mockRpc.mockResolvedValue({
      data: [{ candidate_user: 'user-real', score: 0.8, is_seed: false }],
      error: null,
    });

    await StrollPage();

    expect(mockRpc).toHaveBeenCalledWith(
      'match_candidates',
      expect.objectContaining({ include_seeds: false }),
    );
  });

  it('returns empty state when RPC returns empty (seed_pool_active=false, all seeds filtered SQL-side)', async () => {
    mockAppSettings = { streaming_paused: false, seed_pool_active: false };
    mockRpc.mockResolvedValue({ data: [], error: null });

    // Should render the empty state, not throw.
    const result = await StrollPage();
    expect(result).toBeTruthy();

    // RPC still called with include_seeds=false.
    expect(mockRpc).toHaveBeenCalledWith(
      'match_candidates',
      expect.objectContaining({ include_seeds: false }),
    );
  });
});
