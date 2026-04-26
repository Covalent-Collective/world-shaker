// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — registered BEFORE any module imports
// ---------------------------------------------------------------------------

// next/headers cookies()
const mockCookiesGet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => Promise.resolve({ get: mockCookiesGet })),
}));

// JWT verification
const mockVerifyWorldUserJwt = vi.fn();
vi.mock('@/lib/auth/jwt', () => ({
  SESSION_COOKIE: 'ws_session',
  verifyWorldUserJwt: (...args: unknown[]) => mockVerifyWorldUserJwt(...args),
}));

// ---------------------------------------------------------------------------
// Supabase service client mock
// ---------------------------------------------------------------------------

// We track calls so tests can assert on them.
const mockInsert = vi.fn();
const mockSelectUpdate = vi.fn(); // .update().eq().eq().select()

// The mock service client factory — reconfigured per-test via mockGetServiceClient.
const mockGetServiceClient = vi.fn();

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: () => mockGetServiceClient(),
}));

// Import AFTER mocks are registered.
import { POST } from '../route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONV_ID = 'conv-uuid-123';
const USER_ID = 'user-uuid-abc';

function makeRequest(): Request {
  return new Request(`http://localhost/api/conversation/${CONV_ID}/abandon`, {
    method: 'POST',
  });
}

function makeParams(id = CONV_ID): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

/** Build a service client that returns the given ownership row and update result. */
function buildClient({
  ownerRow,
  ownerError = null,
  updatedRows,
  updateError = null,
  insertError = null,
}: {
  ownerRow: unknown;
  ownerError?: unknown;
  updatedRows: unknown[];
  updateError?: unknown;
  insertError?: unknown;
}) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'conversations') {
        // We need to handle both select (ownership) and update (status change).
        // We use a counter: first call = ownership, second call = update.
        let callCount = 0;
        return {
          select: vi.fn(() => {
            callCount++;
            if (callCount === 1) {
              // Ownership query
              return {
                eq: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({ data: ownerRow, error: ownerError }),
              };
            }
            // Should not reach here in normal flow
            return { eq: vi.fn().mockReturnThis() };
          }),
          update: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            select: mockSelectUpdate.mockResolvedValue({ data: updatedRows, error: updateError }),
          })),
        };
      }
      if (table === 'outcome_events') {
        return {
          insert: mockInsert.mockResolvedValue({ error: insertError }),
        };
      }
      return {};
    }),
  };
}

/** Ownership row indicating the user owns agent_a. */
function ownerRowViaAgentA(userId = USER_ID) {
  return {
    id: CONV_ID,
    agent_a: { user_id: userId },
    agent_b: { user_id: 'other-user' },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/conversation/[id]/abandon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockResolvedValue({ error: null });
    mockSelectUpdate.mockResolvedValue({ data: [{ id: CONV_ID }], error: null });
  });

  // ── 401: missing cookie ───────────────────────────────────────────────────

  it('returns 401 when ws_session cookie is absent', async () => {
    mockCookiesGet.mockReturnValue(undefined);

    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthorized');
  });

  // ── 401: invalid JWT ──────────────────────────────────────────────────────

  it('returns 401 when JWT verification throws', async () => {
    mockCookiesGet.mockReturnValue({ value: 'bad-token' });
    mockVerifyWorldUserJwt.mockRejectedValue(new Error('jwt_invalid'));

    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthorized');
  });

  // ── 403: not an owner ─────────────────────────────────────────────────────

  it('returns 403 when the user does not own any agent in the conversation', async () => {
    mockCookiesGet.mockReturnValue({ value: 'valid-token' });
    mockVerifyWorldUserJwt.mockResolvedValue({
      world_user_id: USER_ID,
      nullifier: 'n',
      language_pref: 'ko',
    });

    // Ownership row exists but belongs to a different user.
    const nonOwnerRow = {
      id: CONV_ID,
      agent_a: { user_id: 'someone-else' },
      agent_b: { user_id: 'another-person' },
    };

    mockGetServiceClient.mockReturnValue(
      buildClient({
        ownerRow: nonOwnerRow,
        updatedRows: [],
      }),
    );

    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('forbidden');
  });

  it('returns 403 when the conversation does not exist', async () => {
    mockCookiesGet.mockReturnValue({ value: 'valid-token' });
    mockVerifyWorldUserJwt.mockResolvedValue({
      world_user_id: USER_ID,
      nullifier: 'n',
      language_pref: 'ko',
    });

    mockGetServiceClient.mockReturnValue(
      buildClient({
        ownerRow: null, // no row
        updatedRows: [],
      }),
    );

    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(403);
  });

  // ── 409: already terminal ─────────────────────────────────────────────────

  it('returns 409 when the conversation is not live (already terminal)', async () => {
    mockCookiesGet.mockReturnValue({ value: 'valid-token' });
    mockVerifyWorldUserJwt.mockResolvedValue({
      world_user_id: USER_ID,
      nullifier: 'n',
      language_pref: 'ko',
    });

    mockGetServiceClient.mockReturnValue(
      buildClient({
        ownerRow: ownerRowViaAgentA(),
        updatedRows: [], // 0 rows updated = already terminal
      }),
    );

    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('already_terminal');
  });

  // ── 200: success ──────────────────────────────────────────────────────────

  it('returns 200 { abandoned: true } and inserts outcome_event on success', async () => {
    mockCookiesGet.mockReturnValue({ value: 'valid-token' });
    mockVerifyWorldUserJwt.mockResolvedValue({
      world_user_id: USER_ID,
      nullifier: 'n',
      language_pref: 'ko',
    });

    mockGetServiceClient.mockReturnValue(
      buildClient({
        ownerRow: ownerRowViaAgentA(),
        updatedRows: [{ id: CONV_ID }],
      }),
    );

    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.abandoned).toBe(true);

    // Assert the outcome_event INSERT was called with correct fields.
    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'wont_connect',
        user_id: USER_ID,
        source_screen: 'conversation_overlay',
        metadata: { conversation_id: CONV_ID },
      }),
    );
  });
});
