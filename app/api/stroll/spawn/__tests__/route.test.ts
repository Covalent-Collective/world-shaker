// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — registered before any imports that depend on them
// ---------------------------------------------------------------------------

const mockCookiesGet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: mockCookiesGet })),
}));

// Supabase service client mock
const mockFrom = vi.fn();
const mockRpc = vi.fn();
vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));

// JWT mock
const mockVerifyWorldUserJwt = vi.fn();
vi.mock('@/lib/auth/jwt', () => ({
  SESSION_COOKIE: 'ws_session',
  verifyWorldUserJwt: (...args: unknown[]) => mockVerifyWorldUserJwt(...args),
}));

// Rate limit mock
const mockRateLimit = vi.fn();
vi.mock('@/lib/auth/rate-limit', () => ({
  rateLimit: (...args: unknown[]) => mockRateLimit(...args),
}));

// Daily quota mock
const mockGetDailyQuota = vi.fn();
vi.mock('@/lib/quota/daily', () => ({
  getDailyQuota: (...args: unknown[]) => mockGetDailyQuota(...args),
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

const DEFAULT_CLAIMS = {
  world_user_id: 'user-alice',
  nullifier: 'null-abc',
  language_pref: 'ko' as const,
};

const CANDIDATE_USER_ID = 'ccccdddd-cccc-4ccc-8ccc-cccccccccc02';
const CANDIDATE_AGENT_ID = 'ddddeeee-dddd-4ddd-8ddd-dddddddddd03';
const OWN_AGENT_ID = 'aaaabbbb-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function makeRequest(body: unknown, cookieValue?: string): Request {
  mockCookiesGet.mockImplementation((name: string) =>
    name === 'ws_session' && cookieValue !== undefined ? { value: cookieValue } : undefined,
  );
  return new Request('http://localhost/api/stroll/spawn', {
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
  chain.insert = vi.fn().mockResolvedValue({ error: null });
  return chain;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/stroll/spawn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInngestSend.mockResolvedValue(undefined);
  });

  // ── 401 ─────────────────────────────────────────────────────────────────

  it('returns 401 when no cookie is present', async () => {
    mockCookiesGet.mockReturnValue(undefined);
    const req = new Request('http://localhost/api/stroll/spawn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidate_user_id: CANDIDATE_USER_ID }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('unauthorized');
  });

  it('returns 401 when JWT verification fails', async () => {
    mockVerifyWorldUserJwt.mockRejectedValue(new Error('jwt_invalid'));
    const req = makeRequest({ candidate_user_id: CANDIDATE_USER_ID }, 'bad-token');

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('unauthorized');
  });

  // ── 429 quota_exceeded ───────────────────────────────────────────────────

  it('returns 429 with reason quota_exceeded when daily quota is exhausted', async () => {
    mockVerifyWorldUserJwt.mockResolvedValue(DEFAULT_CLAIMS);
    mockRateLimit.mockResolvedValue({ ok: true, retryAfterSeconds: 0, remaining: 9 });
    mockGetDailyQuota.mockResolvedValue({ used: 4, max: 4, nextResetAt: new Date() });

    // app_settings chain
    const settingsChain = buildChain({ data: { streaming_paused: false }, error: null });
    mockFrom.mockReturnValue(settingsChain);

    const req = makeRequest({ candidate_user_id: CANDIDATE_USER_ID }, 'valid-token');
    const res = await POST(req);

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.reason).toBe('quota_exceeded');
  });

  // ── 503 streaming_paused ─────────────────────────────────────────────────

  it('returns 503 with reason streaming_paused when streaming is paused', async () => {
    mockVerifyWorldUserJwt.mockResolvedValue(DEFAULT_CLAIMS);
    mockRateLimit.mockResolvedValue({ ok: true, retryAfterSeconds: 0, remaining: 9 });
    mockGetDailyQuota.mockResolvedValue({ used: 1, max: 4, nextResetAt: new Date() });

    const settingsChain = buildChain({ data: { streaming_paused: true }, error: null });
    mockFrom.mockReturnValue(settingsChain);

    const req = makeRequest({ candidate_user_id: CANDIDATE_USER_ID }, 'valid-token');
    const res = await POST(req);

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.reason).toBe('streaming_paused');
  });

  // ── 200 success ──────────────────────────────────────────────────────────

  it('returns 200 and inserts outcome_event on success', async () => {
    const SYNTHETIC_CONVERSATION_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

    mockVerifyWorldUserJwt.mockResolvedValue(DEFAULT_CLAIMS);
    mockRateLimit.mockResolvedValue({ ok: true, retryAfterSeconds: 0, remaining: 9 });
    mockGetDailyQuota.mockResolvedValue({ used: 1, max: 4, nextResetAt: new Date() });

    // app_settings → streaming_paused: false
    const settingsChain = buildChain({ data: { streaming_paused: false }, error: null });

    // agents → own active agent
    const ownAgentChain = buildChain({ data: { id: OWN_AGENT_ID }, error: null });

    // agents → candidate's active agent
    const candidateAgentChain = buildChain({ data: { id: CANDIDATE_AGENT_ID }, error: null });

    // outcome_events insert
    const insertChain = buildChain({ error: null });

    // match_candidates RPC returns our candidate (keyed by user id).
    // allocate_conversation_attempt RPC returns a synthetic conversation_id.
    mockRpc
      .mockResolvedValueOnce({
        data: [{ candidate_user: CANDIDATE_USER_ID }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: SYNTHETIC_CONVERSATION_ID,
        error: null,
      });

    // from() call order:
    //  1. app_settings (select streaming_paused)
    //  2. agents (select id — own agent)
    //  3. agents (select id — candidate agent)
    //  4. outcome_events (insert)
    mockFrom
      .mockReturnValueOnce(settingsChain)
      .mockReturnValueOnce(ownAgentChain)
      .mockReturnValueOnce(candidateAgentChain)
      .mockReturnValueOnce(insertChain);

    const req = makeRequest({ candidate_user_id: CANDIDATE_USER_ID }, 'valid-token');
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    // Route now returns the pre-allocated conversation_id directly.
    expect(json.conversation_id).toBe(SYNTHETIC_CONVERSATION_ID);

    // Inngest event was sent with the pre-allocated conversation_id and resolved agent ids.
    expect(mockInngestSend).toHaveBeenCalledOnce();
    expect(mockInngestSend).toHaveBeenCalledWith({
      name: 'conversation/start',
      data: expect.objectContaining({
        user_id: DEFAULT_CLAIMS.world_user_id,
        surface: 'dating',
        agent_a_id: OWN_AGENT_ID,
        agent_b_id: CANDIDATE_AGENT_ID,
        language: 'ko',
        conversation_id: SYNTHETIC_CONVERSATION_ID,
      }),
    });

    // outcome_event INSERT was called with correct shape.
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: DEFAULT_CLAIMS.world_user_id,
        event_type: 'viewed',
        source_screen: 'stroll',
      }),
    );
  });
});
