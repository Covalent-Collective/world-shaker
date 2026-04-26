// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signWorldUserJwt, SESSION_COOKIE } from '@/lib/auth/jwt';

// ---------------------------------------------------------------------------
// Cookies mock
// ---------------------------------------------------------------------------

let cookieJar: Record<string, string> = {};
vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (cookieJar[name] ? { name, value: cookieJar[name] } : undefined),
    }),
}));

// ---------------------------------------------------------------------------
// Rate-limit mock — allow by default, override per test
// ---------------------------------------------------------------------------

const rateLimitState = { ok: true, retryAfterSeconds: 60 };
vi.mock('@/lib/auth/rate-limit', () => ({
  rateLimit: vi.fn().mockImplementation(() => Promise.resolve(rateLimitState)),
}));

// ---------------------------------------------------------------------------
// Supabase service-client mock
// ---------------------------------------------------------------------------

interface InsertError {
  code?: string;
  message: string;
}

const dbState = {
  insertError: null as InsertError | null,
  matchRow: null as Record<string, unknown> | null,
  matchError: null as { message: string } | null,
  conversationRow: null as Record<string, unknown> | null,
  conversationError: null as { message: string } | null,
};

let lastInsertPayload: Record<string, unknown> | null = null;
let lastOutcomeEventPayload: Record<string, unknown> | null = null;

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: () => ({
    from(table: string) {
      if (table === 'reports') {
        return {
          insert(payload: Record<string, unknown>) {
            lastInsertPayload = payload;
            return Promise.resolve({ error: dbState.insertError });
          },
        };
      }
      if (table === 'outcome_events') {
        return {
          insert(payload: Record<string, unknown>) {
            lastOutcomeEventPayload = payload;
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === 'matches') {
        return {
          select(_cols: string) {
            return {
              eq(_col: string, _val: unknown) {
                return {
                  eq(_col2: string, _val2: unknown) {
                    return {
                      single() {
                        return Promise.resolve({
                          data: dbState.matchRow,
                          error: dbState.matchError,
                        });
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (table === 'conversations') {
        return {
          select(_cols: string) {
            return {
              eq(_col: string, _val: unknown) {
                return {
                  single() {
                    return Promise.resolve({
                      data: dbState.conversationRow,
                      error: dbState.conversationError,
                    });
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

// ---------------------------------------------------------------------------
// Module under test — import AFTER mocks
// ---------------------------------------------------------------------------

import { POST } from '../route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPORTER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const REPORTED_ID = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
const UNRELATED_ID = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';
const MATCH_ID = 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44';
const CONV_ID = 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55';

async function setSessionCookie(world_user_id: string) {
  const token = await signWorldUserJwt({
    world_user_id,
    nullifier: 'nullifier-test',
    language_pref: 'en',
  });
  cookieJar[SESSION_COOKIE] = token;
}

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validMatchBody = {
  match_id: MATCH_ID,
  reason: 'spam',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/report', () => {
  beforeEach(() => {
    cookieJar = {};
    lastInsertPayload = null;
    lastOutcomeEventPayload = null;
    dbState.insertError = null;
    dbState.matchRow = { candidate_user_id: REPORTED_ID };
    dbState.matchError = null;
    dbState.conversationRow = null;
    dbState.conversationError = null;
    rateLimitState.ok = true;
    rateLimitState.retryAfterSeconds = 60;
  });

  it('returns 401 when ws_session cookie is missing', async () => {
    const res = await POST(makeRequest(validMatchBody));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('unauthorized');
  });

  it('returns 401 when ws_session cookie is invalid JWT', async () => {
    cookieJar[SESSION_COOKIE] = 'bad-token';
    const res = await POST(makeRequest(validMatchBody));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('unauthorized');
  });

  it('returns 429 when rate limit is exceeded', async () => {
    await setSessionCookie(REPORTER_ID);
    rateLimitState.ok = false;
    rateLimitState.retryAfterSeconds = 45;

    const res = await POST(makeRequest(validMatchBody));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('45');
    const json = await res.json();
    expect(json.error).toBe('rate_limit_exceeded');
  });

  it('returns 400 on invalid body (bad reason enum)', async () => {
    await setSessionCookie(REPORTER_ID);
    const res = await POST(makeRequest({ match_id: MATCH_ID, reason: 'invalid_reason' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_body');
  });

  it('returns 400 on invalid body (neither match_id nor conversation_id)', async () => {
    await setSessionCookie(REPORTER_ID);
    const res = await POST(makeRequest({ reason: 'spam' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_body');
  });

  it('returns 403 when match_id does not belong to reporter (unrelated user)', async () => {
    await setSessionCookie(UNRELATED_ID);
    dbState.matchRow = null;
    dbState.matchError = { message: 'no rows' };

    const res = await POST(makeRequest({ match_id: MATCH_ID, reason: 'spam' }));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('forbidden');
  });

  it('returns 400 on self-report attempt via match_id', async () => {
    await setSessionCookie(REPORTER_ID);
    dbState.matchRow = { candidate_user_id: REPORTER_ID };

    const res = await POST(makeRequest({ match_id: MATCH_ID, reason: 'spam' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('cannot_self_report');
  });

  it('returns 200 on success via match_id and inserts server-derived reported_user_id', async () => {
    await setSessionCookie(REPORTER_ID);
    dbState.matchRow = { candidate_user_id: REPORTED_ID };

    const res = await POST(
      makeRequest({ match_id: MATCH_ID, reason: 'harassment', detail: 'some detail' }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ reported: true });

    expect(lastInsertPayload).toMatchObject({
      reported_user_id: REPORTED_ID,
      reason: 'harassment',
      detail: 'some detail',
    });
    expect(typeof (lastInsertPayload as Record<string, unknown>).reporter_id).toBe('string');
  });

  it('returns 200 on success via conversation_id when reporter is agent_a', async () => {
    await setSessionCookie(REPORTER_ID);
    dbState.conversationRow = {
      agent_a: { user_id: REPORTER_ID },
      agent_b: { user_id: REPORTED_ID },
    };

    const res = await POST(makeRequest({ conversation_id: CONV_ID, reason: 'catfish' }));
    expect(res.status).toBe(200);
    expect(lastInsertPayload).toMatchObject({ reported_user_id: REPORTED_ID, reason: 'catfish' });
  });

  it('returns 200 on success via conversation_id when reporter is agent_b', async () => {
    await setSessionCookie(REPORTED_ID);
    dbState.conversationRow = {
      agent_a: { user_id: REPORTER_ID },
      agent_b: { user_id: REPORTED_ID },
    };

    const res = await POST(makeRequest({ conversation_id: CONV_ID, reason: 'hateful' }));
    expect(res.status).toBe(200);
  });

  it('returns 403 when reporter is not a participant in the conversation', async () => {
    await setSessionCookie(UNRELATED_ID);
    dbState.conversationRow = {
      agent_a: { user_id: REPORTER_ID },
      agent_b: { user_id: REPORTED_ID },
    };

    const res = await POST(makeRequest({ conversation_id: CONV_ID, reason: 'spam' }));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('forbidden');
  });

  it('returns 409 on duplicate report (Postgres code 23505)', async () => {
    await setSessionCookie(REPORTER_ID);
    dbState.matchRow = { candidate_user_id: REPORTED_ID };
    dbState.insertError = { code: '23505', message: 'unique violation' };

    const res = await POST(makeRequest(validMatchBody));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('already_reported');
  });

  it('emits report_filed outcome_event with correct payload on success', async () => {
    await setSessionCookie(REPORTER_ID);
    dbState.matchRow = { candidate_user_id: REPORTED_ID };

    const res = await POST(makeRequest({ match_id: MATCH_ID, reason: 'catfish' }));
    expect(res.status).toBe(200);

    expect(lastOutcomeEventPayload).toMatchObject({
      event_type: 'report_filed',
      source_screen: 'safety_menu',
      metadata: {
        reported_user_id: REPORTED_ID,
        reason: 'catfish',
      },
    });
    expect(typeof (lastOutcomeEventPayload as Record<string, unknown>).user_id).toBe('string');
  });
});
