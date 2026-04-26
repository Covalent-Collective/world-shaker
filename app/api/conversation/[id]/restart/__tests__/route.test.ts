// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockInngestSend,
  mockGetServiceClient,
  mockCookies,
  mockVerifyJwt,
  mockAssertQuota,
  mockGetDailyQuota,
} = vi.hoisted(() => ({
  mockInngestSend: vi.fn(),
  mockGetServiceClient: vi.fn(),
  mockCookies: vi.fn(),
  mockVerifyJwt: vi.fn(),
  mockAssertQuota: vi.fn(),
  mockGetDailyQuota: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: mockInngestSend },
}));

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: mockGetServiceClient,
}));

vi.mock('@/lib/auth/jwt', () => ({
  SESSION_COOKIE: 'ws_session',
  verifyWorldUserJwt: mockVerifyJwt,
}));

vi.mock('@/lib/quota/daily', () => ({
  assertQuotaAvailable: mockAssertQuota,
  getDailyQuota: mockGetDailyQuota,
}));

import { POST } from '../route';

interface MaybeSingleResult {
  data: unknown;
  error: unknown;
}

interface AgentsResult {
  data: Array<{ id: string; user_id: string }> | null;
  error: unknown;
}

function buildSupabaseStub(convResult: MaybeSingleResult, agentsResult?: AgentsResult) {
  const maybeSingle = vi.fn().mockResolvedValue(convResult);
  const convEq = vi.fn(() => ({ maybeSingle }));
  const inFn = vi
    .fn()
    .mockResolvedValue(
      agentsResult ?? { data: [] as Array<{ id: string; user_id: string }>, error: null },
    );
  const convSelect = vi.fn(() => ({ eq: convEq }));
  const agentsSelect = vi.fn(() => ({ in: inFn }));
  // outcome_events insert stub (used when quota is exceeded)
  const insertFn = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn((table: string) => {
    if (table === 'agents') return { select: agentsSelect };
    if (table === 'outcome_events') return { insert: insertFn };
    return { select: convSelect };
  });
  return { from, insertFn };
}

function buildCookieStore(token: string | undefined) {
  return {
    get: vi.fn((name: string) =>
      name === 'ws_session' && token !== undefined ? { name, value: token } : undefined,
    ),
  };
}

function makeParams(id: string): Promise<{ id: string }> {
  return Promise.resolve({ id });
}

describe('POST /api/conversation/[id]/restart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when ws_session cookie is missing', async () => {
    mockCookies.mockResolvedValue(buildCookieStore(undefined));

    const res = await POST(new Request('http://t/'), { params: makeParams('c1') });

    expect(res.status).toBe(401);
    expect(mockInngestSend).not.toHaveBeenCalled();
  });

  it('returns 401 when JWT verify throws', async () => {
    mockCookies.mockResolvedValue(buildCookieStore('bad'));
    mockVerifyJwt.mockRejectedValue(new Error('invalid'));

    const res = await POST(new Request('http://t/'), { params: makeParams('c1') });

    expect(res.status).toBe(401);
    expect(mockInngestSend).not.toHaveBeenCalled();
  });

  it('returns 404 when conversation row is missing', async () => {
    mockCookies.mockResolvedValue(buildCookieStore('good'));
    mockVerifyJwt.mockResolvedValue({
      world_user_id: 'u1',
      nullifier: 'n',
      language_pref: 'ko',
    });
    mockGetServiceClient.mockReturnValue(buildSupabaseStub({ data: null, error: null }));

    const res = await POST(new Request('http://t/'), { params: makeParams('missing') });

    expect(res.status).toBe(404);
    expect(mockInngestSend).not.toHaveBeenCalled();
  });

  it('returns 403 when caller does not own either agent', async () => {
    mockCookies.mockResolvedValue(buildCookieStore('good'));
    mockVerifyJwt.mockResolvedValue({
      world_user_id: 'u-other',
      nullifier: 'n',
      language_pref: 'ko',
    });
    mockGetServiceClient.mockReturnValue(
      buildSupabaseStub(
        {
          data: {
            id: 'c1',
            status: 'failed',
            surface: 'dating',
            pair_key: 'p',
            agent_a_id: 'a1',
            agent_b_id: 'a2',
          },
          error: null,
        },
        {
          data: [
            { id: 'a1', user_id: 'u1' },
            { id: 'a2', user_id: 'u2' },
          ],
          error: null,
        },
      ),
    );

    const res = await POST(new Request('http://t/'), { params: makeParams('c1') });

    expect(res.status).toBe(403);
    expect(mockInngestSend).not.toHaveBeenCalled();
  });

  it('returns 409 when conversation is not in failed state', async () => {
    mockCookies.mockResolvedValue(buildCookieStore('good'));
    mockVerifyJwt.mockResolvedValue({
      world_user_id: 'u1',
      nullifier: 'n',
      language_pref: 'ko',
    });
    mockGetServiceClient.mockReturnValue(
      buildSupabaseStub(
        {
          data: {
            id: 'c1',
            status: 'live',
            surface: 'dating',
            pair_key: 'p',
            agent_a_id: 'a1',
            agent_b_id: 'a2',
          },
          error: null,
        },
        {
          data: [
            { id: 'a1', user_id: 'u1' },
            { id: 'a2', user_id: 'u2' },
          ],
          error: null,
        },
      ),
    );

    const res = await POST(new Request('http://t/'), { params: makeParams('c1') });

    expect(res.status).toBe(409);
    expect(mockInngestSend).not.toHaveBeenCalled();
  });

  it('sends conversation/start and returns restarted=true on success', async () => {
    mockCookies.mockResolvedValue(buildCookieStore('good'));
    mockVerifyJwt.mockResolvedValue({
      world_user_id: 'u1',
      nullifier: 'n',
      language_pref: 'ko',
    });
    mockGetServiceClient.mockReturnValue(
      buildSupabaseStub(
        {
          data: {
            id: 'c1',
            status: 'failed',
            surface: 'dating',
            pair_key: 'a1:a2',
            agent_a_id: 'a1',
            agent_b_id: 'a2',
          },
          error: null,
        },
        {
          data: [
            { id: 'a1', user_id: 'u1' },
            { id: 'a2', user_id: 'u2' },
          ],
          error: null,
        },
      ),
    );
    mockAssertQuota.mockResolvedValue({ ok: true, used: 0, max: 4 });
    mockInngestSend.mockResolvedValue(undefined);

    const res = await POST(new Request('http://t/'), { params: makeParams('c1') });
    const body = (await res.json()) as { restarted?: boolean };

    expect(res.status).toBe(200);
    expect(body.restarted).toBe(true);
    expect(mockInngestSend).toHaveBeenCalledWith({
      name: 'conversation/start',
      data: {
        user_id: 'u1',
        surface: 'dating',
        agent_a_id: 'a1',
        agent_b_id: 'a2',
        language: 'ko',
      },
    });
  });

  it('returns 429 when daily quota is exhausted, writes wont_connect outcome, does not send Inngest event', async () => {
    mockCookies.mockResolvedValue(buildCookieStore('good'));
    mockVerifyJwt.mockResolvedValue({
      world_user_id: 'u1',
      nullifier: 'n',
      language_pref: 'ko',
    });
    const nextResetAt = new Date('2026-04-27T15:00:00.000Z');
    const stub = buildSupabaseStub(
      {
        data: {
          id: 'c1',
          status: 'failed',
          surface: 'dating',
          pair_key: 'a1:a2',
          agent_a_id: 'a1',
          agent_b_id: 'a2',
        },
        error: null,
      },
      {
        data: [
          { id: 'a1', user_id: 'u1' },
          { id: 'a2', user_id: 'u2' },
        ],
        error: null,
      },
    );
    mockGetServiceClient.mockReturnValue(stub);
    mockAssertQuota.mockResolvedValue({ ok: false, reason: 'quota_exceeded', used: 4, max: 4 });
    mockGetDailyQuota.mockResolvedValue({ used: 4, max: 4, nextResetAt });

    const res = await POST(new Request('http://t/'), { params: makeParams('c1') });
    const body = (await res.json()) as { error?: string; retry_at?: string };

    expect(res.status).toBe(429);
    expect(body.error).toBe('quota_exceeded');
    expect(body.retry_at).toBe(nextResetAt.toISOString());
    expect(mockInngestSend).not.toHaveBeenCalled();
    expect(stub.insertFn).toHaveBeenCalledWith({
      user_id: 'u1',
      event_type: 'wont_connect',
      source_screen: 'restart',
      metadata: { reason: 'quota_exceeded', conversation_id: 'c1' },
    });
  });
});
