import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Mock getServiceClient before importing cohort so the module-level import
// resolves to our stub.
// ---------------------------------------------------------------------------

const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: () => ({
    from: mockFrom,
  }),
}));

// Helper: configure the mock chain to return a given salt value.
function mockSalt(salt: string): void {
  mockSingle.mockResolvedValue({ data: { posthog_cohort_salt: salt }, error: null });
  mockEq.mockReturnValue({ single: mockSingle });
  mockSelect.mockReturnValue({ eq: mockEq });
  mockFrom.mockReturnValue({ select: mockSelect });
}

// Helper: compute expected hash inline (no shared code path with production).
function expectedHash(world_user_id: string, salt: string): string {
  return createHash('sha256').update(`${world_user_id}:${salt}`).digest('hex');
}

describe('hashCohort', () => {
  // We need a fresh module for each test group that manipulates the cache.
  // vitest module isolation is done via vi.resetModules().

  beforeEach(() => {
    vi.resetModules();
    mockFrom.mockReset();
    mockSelect.mockReset();
    mockEq.mockReset();
    mockSingle.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('produces a deterministic 64-char lowercase hex hash for the same (id, salt)', async () => {
    mockSalt('test-salt-abc');
    const { hashCohort } = await import('../cohort');
    const hash = await hashCohort('user-123');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(expectedHash('user-123', 'test-salt-abc'));
  });

  it('returns the same hash on repeated calls within 5-min cache window', async () => {
    mockSalt('stable-salt');
    const { hashCohort } = await import('../cohort');
    const first = await hashCohort('user-abc');
    const second = await hashCohort('user-abc');
    expect(first).toBe(second);
    // Service client should only be called once (cache hit on second call).
    expect(mockSingle).toHaveBeenCalledTimes(1);
  });

  it('different salts produce different hashes for the same user id', async () => {
    // First module instance with salt A.
    mockSalt('salt-A');
    const { hashCohort: hashA } = await import('../cohort');
    const hashWithSaltA = await hashA('user-xyz');

    // Fresh module instance with salt B.
    vi.resetModules();
    mockSingle.mockReset();
    mockSalt('salt-B');
    const { hashCohort: hashB } = await import('../cohort');
    const hashWithSaltB = await hashB('user-xyz');

    expect(hashWithSaltA).not.toBe(hashWithSaltB);
    expect(hashWithSaltA).toMatch(/^[0-9a-f]{64}$/);
    expect(hashWithSaltB).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different user ids with the same salt produce different hashes', async () => {
    mockSalt('shared-salt');
    const { hashCohort } = await import('../cohort');
    const hashA = await hashCohort('user-aaa');
    const hashB = await hashCohort('user-bbb');
    expect(hashA).not.toBe(hashB);
  });

  it('output matches /^[0-9a-f]{64}$/ for arbitrary inputs', async () => {
    mockSalt('any-salt');
    const { hashCohort } = await import('../cohort');
    const results = await Promise.all([
      hashCohort(''),
      hashCohort('a'),
      hashCohort('world_user_id_very_long_string_12345678901234567890'),
    ]);
    for (const hash of results) {
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('throws when service client returns an error', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'DB error' } });
    mockEq.mockReturnValue({ single: mockSingle });
    mockSelect.mockReturnValue({ eq: mockEq });
    mockFrom.mockReturnValue({ select: mockSelect });

    const { hashCohort } = await import('../cohort');
    await expect(hashCohort('user-fail')).rejects.toThrow('posthog_cohort_salt');
  });
});

describe('getPredecessorCohort', () => {
  it('returns null in v0', async () => {
    vi.resetModules();
    // No salt mock needed — getPredecessorCohort doesn't hit the DB in v0.
    const { getPredecessorCohort } = await import('../cohort');
    const result = await getPredecessorCohort('any-user');
    expect(result).toBeNull();
  });
});

describe('setPosthogIdentity', () => {
  beforeEach(() => {
    vi.resetModules();
    mockFrom.mockReset();
    mockSelect.mockReset();
    mockEq.mockReset();
    mockSingle.mockReset();
  });

  it('calls client.identify with hashed distinctId and null predecessor', async () => {
    mockSalt('identity-salt');
    const { setPosthogIdentity } = await import('../cohort');

    const mockIdentify = vi.fn();
    const mockClient = { identify: mockIdentify };

    await setPosthogIdentity(mockClient, 'user-identity');

    expect(mockIdentify).toHaveBeenCalledTimes(1);
    const call = mockIdentify.mock.calls[0][0] as {
      distinctId: string;
      properties: { $set: { posthog_cohort_predecessor: string | null } };
    };
    expect(call.distinctId).toMatch(/^[0-9a-f]{64}$/);
    expect(call.distinctId).toBe(expectedHash('user-identity', 'identity-salt'));
    expect(call.properties.$set.posthog_cohort_predecessor).toBeNull();
  });
});
