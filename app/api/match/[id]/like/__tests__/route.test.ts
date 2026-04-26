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
  return chain;
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

  it('skip → updates status to skipped, returns mutual: false', async () => {
    mockVerifyWorldUserJwt.mockResolvedValue(DEFAULT_CLAIMS);

    // Route calls: from('matches').update().eq().eq().select().single()
    const ownUpdateChain = buildChain({
      data: { id: 'match-abc', candidate_user_id: 'user-bob', world_chat_link: null },
      error: null,
    });
    mockFrom.mockReturnValue(ownUpdateChain);

    const req = makeRequest({ decision: 'skipped' }, 'valid-token');
    const res = await POST(req, { params: DEFAULT_PARAMS });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('skipped');
    expect(json.mutual).toBe(false);
    expect(json.match_id).toBe('match-abc');

    // Inngest must NOT be called for skips
    expect(mockInngestSend).not.toHaveBeenCalled();
  });

  // ── accept, no reciprocal ───────────────────────────────────────────────

  it('accept with no reciprocal → status accepted, mutual: false', async () => {
    mockVerifyWorldUserJwt.mockResolvedValue(DEFAULT_CLAIMS);

    // Route makes two from('matches') calls:
    //   1. update().eq().eq().select().single() — own row
    //   2. select('id').eq().eq().eq().limit().single() — reciprocal check
    const ownUpdateChain = buildChain({
      data: { id: 'match-abc', candidate_user_id: 'user-bob', world_chat_link: null },
      error: null,
    });
    const reciprocalChain = buildChain({ data: null, error: { code: 'PGRST116' } });

    mockFrom.mockReturnValueOnce(ownUpdateChain).mockReturnValueOnce(reciprocalChain);

    const req = makeRequest({ decision: 'accepted' }, 'valid-token');
    const res = await POST(req, { params: DEFAULT_PARAMS });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('accepted');
    expect(json.mutual).toBe(false);
    expect(json.match_id).toBe('match-abc');

    expect(mockInngestSend).not.toHaveBeenCalled();
  });

  // ── accept with reciprocal → mutual ─────────────────────────────────────

  it('accept with reciprocal → both rows mutual, match.mutual event sent', async () => {
    mockVerifyWorldUserJwt.mockResolvedValue(DEFAULT_CLAIMS);

    // Route makes four from('matches') calls:
    //   1. update().eq().eq().select().single()  — own row update + fetch
    //   2. select('id').eq().eq().eq().limit().single() — reciprocal check
    //   3. update({ status:'mutual' }).eq('id', matchId)  — upgrade own row
    //   4. update({ status:'mutual' }).eq('id', reciprocal.id) — upgrade reciprocal
    const ownUpdateChain = buildChain({
      data: {
        id: 'match-abc',
        candidate_user_id: 'user-bob',
        world_chat_link: 'https://worldcoin.org/chat/xyz',
      },
      error: null,
    });
    const reciprocalChain = buildChain({ data: { id: 'match-xyz' }, error: null });
    const mutualUpgradeChain = buildChain({ error: null });

    mockFrom
      .mockReturnValueOnce(ownUpdateChain) // call 1: own row update
      .mockReturnValueOnce(reciprocalChain) // call 2: reciprocal check
      .mockReturnValue(mutualUpgradeChain); // calls 3 & 4: mutual upgrades

    const req = makeRequest({ decision: 'accepted' }, 'valid-token');
    const res = await POST(req, { params: DEFAULT_PARAMS });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('mutual');
    expect(json.mutual).toBe(true);
    expect(json.match_id).toBe('match-abc');
    expect(json.world_chat_link).toBe('https://worldcoin.org/chat/xyz');

    // Inngest event must be sent with both match IDs
    expect(mockInngestSend).toHaveBeenCalledOnce();
    expect(mockInngestSend).toHaveBeenCalledWith({
      name: 'match.mutual',
      data: {
        match_id_a: 'match-abc',
        match_id_b: 'match-xyz',
      },
    });
  });
});
