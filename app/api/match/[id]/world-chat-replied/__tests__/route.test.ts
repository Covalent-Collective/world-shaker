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
const mockInsert = vi.fn();
const mockSingle = vi.fn();
const mockLimit = vi.fn(() => ({ single: mockSingle }));
const mockEq2 = vi.fn(() => ({ limit: mockLimit }));
const mockEq1 = vi.fn(() => ({ eq: mockEq2 }));
const mockSelect = vi.fn(() => ({ eq: mockEq1 }));

// mockFrom routes: 'matches' → ownership chain, 'outcome_events' → insert
const mockFrom = vi.fn((table: string) => {
  if (table === 'matches') return { select: mockSelect };
  return { insert: mockInsert };
});
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

const DEFAULT_PARAMS = Promise.resolve({ id: 'match-abc' });

function makeRequest(cookieValue?: string): Request {
  mockCookiesGet.mockImplementation((name: string) =>
    name === 'ws_session' && cookieValue !== undefined ? { value: cookieValue } : undefined,
  );
  return new Request('http://localhost/api/match/match-abc/world-chat-replied', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/match/[id]/world-chat-replied', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServiceClient.mockReturnValue({ from: mockFrom });
    mockInsert.mockResolvedValue({ error: null });
    // Default: ownership check passes (match found)
    mockSingle.mockResolvedValue({ data: { id: 'match-abc' }, error: null });
  });

  // ── 401 missing auth ──────────────────────────────────────────────────────

  it('returns 401 when no cookie is present', async () => {
    mockCookiesGet.mockReturnValue(undefined);
    const req = new Request('http://localhost/api/match/match-abc/world-chat-replied', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const res = await POST(req, { params: DEFAULT_PARAMS });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('unauthorized');
  });

  it('returns 401 when JWT verification fails', async () => {
    mockVerifyWorldUserJwt.mockRejectedValue(new Error('jwt_invalid'));
    const req = makeRequest('bad-token');

    const res = await POST(req, { params: DEFAULT_PARAMS });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('unauthorized');
  });

  // ── 403 ownership check ───────────────────────────────────────────────────

  it('returns 403 when match does not belong to the authenticated user', async () => {
    mockVerifyWorldUserJwt.mockResolvedValue(DEFAULT_CLAIMS);
    // Ownership check returns no row
    mockSingle.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });

    const req = makeRequest('valid-token');
    const res = await POST(req, { params: DEFAULT_PARAMS });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('forbidden');
    // outcome_events must NOT be inserted
    expect(mockInsert).not.toHaveBeenCalled();
  });

  // ── 200 success ───────────────────────────────────────────────────────────

  it('returns 200 { recorded: true } and inserts outcome_event', async () => {
    mockVerifyWorldUserJwt.mockResolvedValue(DEFAULT_CLAIMS);
    mockInsert.mockResolvedValue({ error: null });

    const req = makeRequest('valid-token');
    const res = await POST(req, { params: DEFAULT_PARAMS });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.recorded).toBe(true);

    // Assert outcome_event INSERT was called with correct payload
    expect(mockFrom).toHaveBeenCalledWith('outcome_events');
    expect(mockInsert).toHaveBeenCalledWith({
      event_type: 'replied_24h',
      user_id: 'user-alice',
      match_id: 'match-abc',
      source_screen: 'world_chat',
    });
  });

  it('still returns 200 even when insert fails (graceful degradation)', async () => {
    mockVerifyWorldUserJwt.mockResolvedValue(DEFAULT_CLAIMS);
    mockInsert.mockResolvedValue({ error: { message: 'db error' } });

    const req = makeRequest('valid-token');
    const res = await POST(req, { params: DEFAULT_PARAMS });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.recorded).toBe(true);
  });
});
