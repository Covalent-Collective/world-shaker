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

// ---------------------------------------------------------------------------
// captureServer — enforces cohort hashing, rejects raw distinctId API
// ---------------------------------------------------------------------------

describe('captureServer', () => {
  // captureServer lives in ../server.ts; it imports hashCohort from ../cohort.
  // We mock posthog-node and @/lib/supabase/service so no real I/O happens.

  const mockCapture = vi.fn();
  const mockFlush = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.resetModules();
    mockFrom.mockReset();
    mockSelect.mockReset();
    mockEq.mockReset();
    mockSingle.mockReset();
    mockCapture.mockReset();
    mockFlush.mockReset().mockResolvedValue(undefined);

    // Mock posthog-node so no real PostHog client is created.
    vi.doMock('posthog-node', () => ({
      PostHog: vi.fn(function (this: { capture: typeof mockCapture; flush: typeof mockFlush }) {
        this.capture = mockCapture;
        this.flush = mockFlush;
      }),
    }));

    // Provide a POSTHOG_PROJECT_API_KEY so getPostHogServer() initialises.
    process.env.POSTHOG_PROJECT_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.POSTHOG_PROJECT_API_KEY;
    vi.clearAllMocks();
  });

  it('hashes worldUserId before calling ph.capture — never forwards a raw UUID', async () => {
    const salt = 'capture-salt';
    mockSalt(salt);

    const { captureServer } = await import('../server');

    const worldUserId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    await captureServer('test.event', { worldUserId, properties: { foo: 'bar' } });

    expect(mockCapture).toHaveBeenCalledTimes(1);
    const captureArg = mockCapture.mock.calls[0][0] as {
      distinctId: string;
      event: string;
      properties?: Record<string, unknown>;
    };

    // distinctId must be the 64-hex cohort hash, not the raw UUID.
    expect(captureArg.distinctId).toMatch(/^[0-9a-f]{64}$/);
    expect(captureArg.distinctId).not.toBe(worldUserId);
    expect(captureArg.distinctId).toBe(expectedHash(worldUserId, salt));
    expect(captureArg.event).toBe('test.event');
    expect(captureArg.properties).toEqual({ foo: 'bar' });
  });

  it('new API only accepts worldUserId — a raw 64-hex distinctId cannot be passed', async () => {
    // The old captureServer({ distinctId, event, properties }) signature no
    // longer exists. Verify TypeScript would reject it at compile time by
    // asserting the runtime shape of captureServer's second argument.
    mockSalt('shape-salt');

    const { captureServer } = await import('../server');

    // captureServer takes (eventName: string, opts: { worldUserId: string; ... }).
    // The presence of 'worldUserId' in opts (not 'distinctId') is the contract.
    const fnStr = captureServer.toString();
    // The implementation must reference worldUserId (not distinctId) in opts.
    expect(fnStr).toContain('worldUserId');
    // A raw 64-hex string passed as worldUserId is still hashed — it cannot
    // bypass hashing even if the caller tries to pass a pre-hashed value.
    const rawHex = 'a'.repeat(64); // looks like a cohort hash
    await captureServer('probe.event', { worldUserId: rawHex });
    expect(mockCapture).toHaveBeenCalledTimes(1);
    const arg = mockCapture.mock.calls[0][0] as { distinctId: string };
    // The resulting distinctId is hash(rawHex:salt) — not rawHex itself.
    expect(arg.distinctId).not.toBe(rawHex);
    expect(arg.distinctId).toBe(expectedHash(rawHex, 'shape-salt'));
  });
});

// ---------------------------------------------------------------------------
// captureServerSafe — fire-and-forget; never throws; hashes listed properties
// ---------------------------------------------------------------------------

describe('captureServerSafe', () => {
  const mockCaptureSafe = vi.fn();
  const mockFlushSafe = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.resetModules();
    mockFrom.mockReset();
    mockSelect.mockReset();
    mockEq.mockReset();
    mockSingle.mockReset();
    mockCaptureSafe.mockReset();
    mockFlushSafe.mockReset().mockResolvedValue(undefined);

    vi.doMock('posthog-node', () => ({
      PostHog: vi.fn(function (this: {
        capture: typeof mockCaptureSafe;
        flush: typeof mockFlushSafe;
      }) {
        this.capture = mockCaptureSafe;
        this.flush = mockFlushSafe;
      }),
    }));

    process.env.POSTHOG_PROJECT_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.POSTHOG_PROJECT_API_KEY;
    vi.clearAllMocks();
  });

  it('(a) does not throw and logs a warning when hashCohort throws (salt read fail)', async () => {
    // Make the DB call fail so hashCohort throws.
    mockSingle.mockResolvedValue({ data: null, error: { message: 'salt read fail' } });
    mockEq.mockReturnValue({ single: mockSingle });
    mockSelect.mockReturnValue({ eq: mockEq });
    mockFrom.mockReturnValue({ select: mockSelect });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { captureServerSafe } = await import('../server');

    // Must not throw even though hashing the worldUserId (inside captureServer) will fail.
    await expect(
      captureServerSafe('like_sent', {
        worldUserId: 'user-fail',
        properties: { candidate_cohort: 'user-bob' },
        hashProperties: ['candidate_cohort'],
      }),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      '[posthog] captureServerSafe error',
      expect.objectContaining({ event: 'like_sent' }),
    );

    warnSpy.mockRestore();
  });

  it('(b) is a no-op when PostHog is disabled (no API key)', async () => {
    delete process.env.POSTHOG_PROJECT_API_KEY;
    // No salt mock needed — PostHog client is null, so we return before any hashing.

    const { captureServerSafe } = await import('../server');

    await expect(
      captureServerSafe('like_sent', { worldUserId: 'user-x' }),
    ).resolves.toBeUndefined();

    expect(mockCaptureSafe).not.toHaveBeenCalled();
  });

  it('(c) hashes listed hashProperties values before forwarding to captureServer', async () => {
    const salt = 'safe-salt';
    mockSalt(salt);

    const { captureServerSafe } = await import('../server');

    const rawCandidateId = 'user-bob-raw-uuid';
    await captureServerSafe('like_sent', {
      worldUserId: 'user-alice',
      properties: { match_id: 'match-123', candidate_cohort: rawCandidateId },
      hashProperties: ['candidate_cohort'],
    });

    expect(mockCaptureSafe).toHaveBeenCalledTimes(1);
    const captureArg = mockCaptureSafe.mock.calls[0][0] as {
      properties?: Record<string, unknown>;
    };

    // candidate_cohort must be the hash of the raw id, not the raw id itself.
    expect(captureArg.properties?.candidate_cohort).toBe(expectedHash(rawCandidateId, salt));
    expect(captureArg.properties?.candidate_cohort).not.toBe(rawCandidateId);
    // Other properties must be forwarded unchanged.
    expect(captureArg.properties?.match_id).toBe('match-123');
  });
});
