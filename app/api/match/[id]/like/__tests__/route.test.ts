// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — registered before any imports that depend on them
// ---------------------------------------------------------------------------

const mockCookiesGet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: mockCookiesGet })),
}));

// Supabase service client mock — mockFrom is overridden per-test
const mockFrom = vi.fn();
const mockGetServiceClient = vi.fn(() => ({ from: mockFrom }));

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: () => mockGetServiceClient(),
}));

// JWT mock
const mockVerifyWorldUserJwt = vi.fn();
vi.mock('@/lib/auth/jwt', () => ({
  SESSION_COOKIE: 'ws_session',
  verifyWorldUserJwt: (...args: unknown[]) => mockVerifyWorldUserJwt(...args),
}));

// Inngest mock
const mockInngestSend = vi.fn();
vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: (...args: unknown[]) => mockInngestSend(...args) },
}));

// PostHog server mock — captureServerSafe is fire-and-forget; capture calls recorded for assertion
const mockCaptureServerSafe = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/posthog/server', () => ({
  captureServerSafe: (...args: unknown[]) => mockCaptureServerSafe(...args),
}));

// ---------------------------------------------------------------------------
// Import route handler AFTER mocks
// ---------------------------------------------------------------------------
import { POST } from '../route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: unknown, cookieValue?: string): Request {
  mockCookiesGet.mockImplementation((name: string) =>
    name === 'ws_session' && cookieValue !== undefined ? { value: cookieValue } : undefined,
  );
  return new Request('http://localhost/api/match/match-abc/like', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Build a fully chainable Supabase query builder stub that resolves to `result`. */
function buildChain(result: unknown) {
  const chain: Record<string, unknown> = {};
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.select = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(result);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.insert = vi.fn().mockResolvedValue({ error: null });
  return chain;
}

/** Build a simple insert-only chain (for outcome_events). */
function buildInsertChain(error: null | object = null) {
  return { insert: vi.fn().mockResolvedValue({ error }) };
}

const DEFAULT_CLAIMS = {
  world_user_id: 'user-alice',
  nullifier: 'null-abc',
  language_pref: 'ko' as const,
};

const DEFAULT_PARAMS = Promise.resolve({ id: 'match-abc' });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/match/[id]/like', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServiceClient.mockReturnValue({ from: mockFrom });
    mockInngestSend.mockResolvedValue(undefined);
    mockCaptureServerSafe.mockResolvedValue(undefined);
  });

  // ── 401 missing auth ────────────────────────────────────────────────────

  it('returns 401 when no cookie is present', async () => {
    mockCookiesGet.mockReturnValue(undefined);
    const req = new Request('http://localhost/api/match/match-abc/like', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'accepted' }),
    });

    const res = await POST(req, { params: DEFAULT_PARAMS });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('unauthorized');
  });

  it('returns 401 when JWT verification fails', async () => {
    mockVerifyWorldUserJwt.mockRejectedValue(new Error('jwt_invalid'));
    const req = makeRequest({ decision: 'accepted' }, 'bad-token');

    const res = await POST(req, { params: DEFAULT_PARAMS });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('unauthorized');
  });

  // ── skip ────────────────────────────────────────────────────────────────

  it('skip → updates status to skipped, records skipped outcome_event, returns mutual: false', async () => {
    mockVerifyWorldUserJwt.mockResolvedValue(DEFAULT_CLAIMS);

    // Route makes 2 from() calls:
    //   1. from('matches').update().eq().eq().select().single() — own row
    //   2. from('outcome_events').insert() — skipped event
    const ownUpdateChain = buildChain({
      data: { id: 'match-abc', candidate_user_id: 'user-bob', world_chat_link: null },
      error: null,
    });
    const outcomeEventChain = buildInsertChain();

    mockFrom
      .mockReturnValueOnce(ownUpdateChain) // call 1: own row update
      .mockReturnValueOnce(outcomeEventChain); // call 2: outcome_events insert

    const req = makeRequest({ decision: 'skipped' }, 'valid-token');
    const res = await POST(req, { params: DEFAULT_PARAMS });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('skipped');
    expect(json.mutual).toBe(false);
    expect(json.match_id).toBe('match-abc');

    // outcome_events insert called with skipped
    expect(outcomeEventChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'skipped',
        match_id: 'match-abc',
        source_screen: 'match',
      }),
    );

    // Inngest must NOT be called for skips
    expect(mockInngestSend).not.toHaveBeenCalled();
  });

  // ── accept, no reciprocal ───────────────────────────────────────────────

  it('accept with no reciprocal → records accepted outcome_event, status accepted, mutual: false', async () => {
    mockVerifyWorldUserJwt.mockResolvedValue(DEFAULT_CLAIMS);

    // Route makes 3 from() calls:
    //   1. from('matches').update().eq().eq().select().single() — own row
    //   2. from('outcome_events').insert() — accepted event
    //   3. from('matches').select('id').eq().eq().eq().limit().single() — reciprocal check
    const ownUpdateChain = buildChain({
      data: { id: 'match-abc', candidate_user_id: 'user-bob', world_chat_link: null },
      error: null,
    });
    const outcomeEventChain = buildInsertChain();
    const reciprocalChain = buildChain({ data: null, error: { code: 'PGRST116' } });

    mockFrom
      .mockReturnValueOnce(ownUpdateChain) // call 1: own row update
      .mockReturnValueOnce(outcomeEventChain) // call 2: outcome_events insert (accepted)
      .mockReturnValueOnce(reciprocalChain); // call 3: reciprocal check

    const req = makeRequest({ decision: 'accepted' }, 'valid-token');
    const res = await POST(req, { params: DEFAULT_PARAMS });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('accepted');
    expect(json.mutual).toBe(false);
    expect(json.match_id).toBe('match-abc');

    expect(outcomeEventChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'accepted',
        match_id: 'match-abc',
        source_screen: 'match',
      }),
    );

    expect(mockInngestSend).not.toHaveBeenCalled();

    // like_sent fired with raw candidate_user_id as candidate_cohort (hashing delegated to captureServerSafe)
    expect(mockCaptureServerSafe).toHaveBeenCalledWith('like_sent', {
      worldUserId: 'user-alice',
      properties: expect.objectContaining({ candidate_cohort: 'user-bob' }),
      hashProperties: ['candidate_cohort'],
    });
  });

  // ── accept with reciprocal → mutual ─────────────────────────────────────

  it('accept with reciprocal → both rows mutual, outcome_events for both users, match.mutual event sent', async () => {
    mockVerifyWorldUserJwt.mockResolvedValue(DEFAULT_CLAIMS);

    // Route makes 7 from() calls:
    //   1. from('matches').update().eq().eq().select().single() — own row update + fetch
    //   2. from('outcome_events').insert() — accepted event
    //   3. from('matches').select('id').eq().eq().eq().limit().single() — reciprocal check
    //   4. from('matches').update({ status:'mutual' }).eq('id', matchId) — upgrade own row
    //   5. from('matches').update({ status:'mutual' }).eq('id', reciprocal.id) — upgrade reciprocal
    //   6. from('outcome_events').insert() — mutual event for user-alice
    //   7. from('outcome_events').insert() — mutual event for user-bob
    const ownUpdateChain = buildChain({
      data: {
        id: 'match-abc',
        candidate_user_id: 'user-bob',
        world_chat_link: 'https://worldcoin.org/chat/xyz',
      },
      error: null,
    });
    const acceptedEventChain = buildInsertChain();
    const reciprocalChain = buildChain({ data: { id: 'match-xyz' }, error: null });
    const mutualUpgradeChain = buildChain({ error: null });
    const mutualEventAlice = buildInsertChain();
    const mutualEventBob = buildInsertChain();

    mockFrom
      .mockReturnValueOnce(ownUpdateChain) // call 1: own row update
      .mockReturnValueOnce(acceptedEventChain) // call 2: outcome_events insert (accepted)
      .mockReturnValueOnce(reciprocalChain) // call 3: reciprocal check
      .mockReturnValueOnce(mutualUpgradeChain) // call 4: upgrade own row to mutual
      .mockReturnValueOnce(mutualUpgradeChain) // call 5: upgrade reciprocal to mutual
      .mockReturnValueOnce(mutualEventAlice) // call 6: mutual event for alice
      .mockReturnValueOnce(mutualEventBob); // call 7: mutual event for bob

    const req = makeRequest({ decision: 'accepted' }, 'valid-token');
    const res = await POST(req, { params: DEFAULT_PARAMS });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('mutual');
    expect(json.mutual).toBe(true);
    expect(json.match_id).toBe('match-abc');
    expect(json.world_chat_link).toBe('https://worldcoin.org/chat/xyz');

    // outcome_events: accepted event for alice
    expect(acceptedEventChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'accepted',
        user_id: 'user-alice',
        match_id: 'match-abc',
      }),
    );

    // outcome_events: mutual event for alice (own match_id)
    expect(mutualEventAlice.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'mutual',
        user_id: 'user-alice',
        match_id: 'match-abc',
      }),
    );

    // outcome_events: mutual event for bob (reciprocal match_id)
    expect(mutualEventBob.insert).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'mutual', user_id: 'user-bob', match_id: 'match-xyz' }),
    );

    // Inngest event must be sent with both match IDs and user IDs
    expect(mockInngestSend).toHaveBeenCalledOnce();
    expect(mockInngestSend).toHaveBeenCalledWith({
      name: 'match.mutual',
      data: {
        match_id_a: 'match-abc',
        match_id_b: 'match-xyz',
        user_a: 'user-alice',
        user_b: 'user-bob',
      },
    });

    // like_sent and mutual_match fired with raw candidate_user_id as candidate_cohort
    // (hashing is delegated to captureServerSafe, not done inline here)
    expect(mockCaptureServerSafe).toHaveBeenCalledWith('like_sent', {
      worldUserId: 'user-alice',
      properties: expect.objectContaining({ candidate_cohort: 'user-bob' }),
      hashProperties: ['candidate_cohort'],
    });
    expect(mockCaptureServerSafe).toHaveBeenCalledWith('mutual_match', {
      worldUserId: 'user-alice',
      properties: expect.objectContaining({ candidate_cohort: 'user-bob' }),
      hashProperties: ['candidate_cohort'],
    });
  });
});
