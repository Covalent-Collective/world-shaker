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

// PostHog server mock
const mockCaptureServer = vi.fn();
vi.mock('@/lib/posthog/server', () => ({
  captureServer: (...args: unknown[]) => mockCaptureServer(...args),
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
  chain.update = vi.fn().mockReturnValue(chain);
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

    // match_candidates RPC returns our candidate (keyed by user id) with is_seed.
    // allocate_conversation_attempt RPC returns a synthetic conversation_id.
    mockRpc
      .mockResolvedValueOnce({
        data: [{ candidate_user: CANDIDATE_USER_ID, score: 0.9, is_seed: false }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: SYNTHETIC_CONVERSATION_ID,
        error: null,
      });

    // Capture RPC args for include_seeds assertion below.

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

    // RPC was called with include_seeds=true (seed_pool_active defaults true).
    expect(mockRpc).toHaveBeenCalledWith(
      'match_candidates',
      expect.objectContaining({ include_seeds: true }),
    );
  });

  // ── US-410: Inngest send failure ─────────────────────────────────────────

  it('returns 503 and marks conversation failed when inngest.send throws', async () => {
    const SYNTHETIC_CONVERSATION_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

    mockVerifyWorldUserJwt.mockResolvedValue(DEFAULT_CLAIMS);
    mockRateLimit.mockResolvedValue({ ok: true, retryAfterSeconds: 0, remaining: 9 });
    mockGetDailyQuota.mockResolvedValue({ used: 1, max: 4, nextResetAt: new Date() });

    // Inngest throws
    mockInngestSend.mockRejectedValue(new Error('inngest_unavailable'));

    const settingsChain = buildChain({ data: { streaming_paused: false }, error: null });
    const ownAgentChain = buildChain({ data: { id: OWN_AGENT_ID }, error: null });
    const candidateAgentChain = buildChain({ data: { id: CANDIDATE_AGENT_ID }, error: null });
    // conversations.update chain (for marking failed)
    const updateChain = buildChain({ error: null });

    mockRpc
      .mockResolvedValueOnce({
        data: [{ candidate_user: CANDIDATE_USER_ID, score: 0.9, is_seed: false }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: SYNTHETIC_CONVERSATION_ID,
        error: null,
      });

    mockFrom
      .mockReturnValueOnce(settingsChain)
      .mockReturnValueOnce(ownAgentChain)
      .mockReturnValueOnce(candidateAgentChain)
      .mockReturnValueOnce(updateChain); // conversations UPDATE

    const req = makeRequest({ candidate_user_id: CANDIDATE_USER_ID }, 'valid-token');
    const res = await POST(req);

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toBe('spawn_failed');
    expect(json.conversation_id).toBe(SYNTHETIC_CONVERSATION_ID);

    // UPDATE conversations SET status='failed'
    expect(updateChain.update).toHaveBeenCalledWith({ status: 'failed' });
    expect(updateChain.eq).toHaveBeenCalledWith('id', SYNTHETIC_CONVERSATION_ID);

    // PostHog capture for observability (fire-and-forget — may not be awaited)
    // Give microtasks a tick to resolve the void promise
    await Promise.resolve();
    expect(mockCaptureServer).toHaveBeenCalledWith(
      'stroll_spawn_inngest_failed',
      expect.objectContaining({ worldUserId: DEFAULT_CLAIMS.world_user_id }),
    );
  });

  // ── US-411a: outcome_events insert error — graceful degradation ──────────

  it('returns 200 and captures quota_undercount_warning when outcome_events insert fails', async () => {
    const SYNTHETIC_CONVERSATION_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

    mockVerifyWorldUserJwt.mockResolvedValue(DEFAULT_CLAIMS);
    mockRateLimit.mockResolvedValue({ ok: true, retryAfterSeconds: 0, remaining: 9 });
    mockGetDailyQuota.mockResolvedValue({ used: 1, max: 4, nextResetAt: new Date() });
    mockInngestSend.mockResolvedValue(undefined);

    const settingsChain = buildChain({ data: { streaming_paused: false }, error: null });
    const ownAgentChain = buildChain({ data: { id: OWN_AGENT_ID }, error: null });
    const candidateAgentChain = buildChain({ data: { id: CANDIDATE_AGENT_ID }, error: null });

    // outcome_events insert returns an error
    const insertChain = buildChain({ error: null });
    (insertChain.insert as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: { message: 'db_write_error' },
    });

    mockRpc
      .mockResolvedValueOnce({
        data: [{ candidate_user: CANDIDATE_USER_ID, score: 0.9, is_seed: false }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: SYNTHETIC_CONVERSATION_ID,
        error: null,
      });

    mockFrom
      .mockReturnValueOnce(settingsChain)
      .mockReturnValueOnce(ownAgentChain)
      .mockReturnValueOnce(candidateAgentChain)
      .mockReturnValueOnce(insertChain);

    const req = makeRequest({ candidate_user_id: CANDIDATE_USER_ID }, 'valid-token');
    const res = await POST(req);

    // Must still return 200 — graceful degradation
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.conversation_id).toBe(SYNTHETIC_CONVERSATION_ID);

    // PostHog capture for quota undercount observability
    await Promise.resolve();
    expect(mockCaptureServer).toHaveBeenCalledWith(
      'quota_undercount_warning',
      expect.objectContaining({ worldUserId: DEFAULT_CLAIMS.world_user_id }),
    );
  });

  // ── seed_pool_active=false: seed candidates filtered out ─────────────────

  it('returns 404 candidate_not_found when seed_pool_active=false and RPC returns no matching candidate', async () => {
    mockVerifyWorldUserJwt.mockResolvedValue(DEFAULT_CLAIMS);
    mockRateLimit.mockResolvedValue({ ok: true, retryAfterSeconds: 0, remaining: 9 });
    mockGetDailyQuota.mockResolvedValue({ used: 1, max: 4, nextResetAt: new Date() });

    // seed_pool_active=false
    const settingsChain = buildChain({
      data: { streaming_paused: false, seed_pool_active: false },
      error: null,
    });

    // SQL-level filter already excluded seeds; RPC returns empty list.
    mockRpc.mockResolvedValueOnce({
      data: [],
      error: null,
    });

    mockFrom.mockReturnValueOnce(settingsChain);

    const req = makeRequest({ candidate_user_id: CANDIDATE_USER_ID }, 'valid-token');
    const res = await POST(req);

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('candidate_not_found');

    // RPC must have been called with include_seeds=false.
    expect(mockRpc).toHaveBeenCalledWith(
      'match_candidates',
      expect.objectContaining({ include_seeds: false }),
    );
  });

  it('returns 200 when seed_pool_active=false and candidate is a non-seed real user', async () => {
    const SYNTHETIC_CONVERSATION_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

    mockVerifyWorldUserJwt.mockResolvedValue(DEFAULT_CLAIMS);
    mockRateLimit.mockResolvedValue({ ok: true, retryAfterSeconds: 0, remaining: 9 });
    mockGetDailyQuota.mockResolvedValue({ used: 1, max: 4, nextResetAt: new Date() });
    mockInngestSend.mockResolvedValue(undefined);

    // seed_pool_active=false; RPC returns only non-seed (SQL filter applied).
    const settingsChain = buildChain({
      data: { streaming_paused: false, seed_pool_active: false },
      error: null,
    });
    const ownAgentChain = buildChain({ data: { id: OWN_AGENT_ID }, error: null });
    const candidateAgentChain = buildChain({ data: { id: CANDIDATE_AGENT_ID }, error: null });
    const insertChain = buildChain({ error: null });

    mockRpc
      .mockResolvedValueOnce({
        data: [{ candidate_user: CANDIDATE_USER_ID, score: 0.85, is_seed: false }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: SYNTHETIC_CONVERSATION_ID,
        error: null,
      });

    mockFrom
      .mockReturnValueOnce(settingsChain)
      .mockReturnValueOnce(ownAgentChain)
      .mockReturnValueOnce(candidateAgentChain)
      .mockReturnValueOnce(insertChain);

    const req = makeRequest({ candidate_user_id: CANDIDATE_USER_ID }, 'valid-token');
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.conversation_id).toBe(SYNTHETIC_CONVERSATION_ID);

    // RPC was called with include_seeds=false.
    expect(mockRpc).toHaveBeenCalledWith(
      'match_candidates',
      expect.objectContaining({ include_seeds: false }),
    );
  });
});
