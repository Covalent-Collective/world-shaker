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

const validBody = {
  reported_user_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
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
    rateLimitState.ok = true;
    rateLimitState.retryAfterSeconds = 60;
  });

  it('returns 401 when ws_session cookie is missing', async () => {
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('unauthorized');
  });

  it('returns 401 when ws_session cookie is invalid JWT', async () => {
    cookieJar[SESSION_COOKIE] = 'bad-token';
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('unauthorized');
  });

  it('returns 429 when rate limit is exceeded', async () => {
    await setSessionCookie('user-rl');
    rateLimitState.ok = false;
    rateLimitState.retryAfterSeconds = 45;

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('45');
    const json = await res.json();
    expect(json.error).toBe('rate_limit_exceeded');
  });

  it('returns 400 on invalid body (bad reason enum)', async () => {
    await setSessionCookie('user-bad');
    const res = await POST(
      makeRequest({ reported_user_id: validBody.reported_user_id, reason: 'invalid_reason' }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_body');
  });

  it('returns 400 on invalid body (missing reported_user_id)', async () => {
    await setSessionCookie('user-bad2');
    const res = await POST(makeRequest({ reason: 'spam' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_body');
  });

  it('returns 200 on success and inserts correct body shape', async () => {
    await setSessionCookie('user-ok');
    const res = await POST(
      makeRequest({
        reported_user_id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
        reason: 'harassment',
        detail: 'some detail',
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ reported: true });

    // Verify INSERT payload shape
    expect(lastInsertPayload).toMatchObject({
      reported_user_id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
      reason: 'harassment',
      detail: 'some detail',
    });
    expect(typeof (lastInsertPayload as Record<string, unknown>).reporter_id).toBe('string');
  });

  it('returns 409 on duplicate report (Postgres code 23505)', async () => {
    await setSessionCookie('user-dup');
    dbState.insertError = { code: '23505', message: 'unique violation' };

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('already_reported');
  });

  it('emits report_filed outcome_event with correct payload on success', async () => {
    await setSessionCookie('user-event');
    const body = {
      reported_user_id: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
      reason: 'catfish',
    };

    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);

    expect(lastOutcomeEventPayload).toMatchObject({
      event_type: 'report_filed',
      source_screen: 'safety_menu',
      metadata: {
        reported_user_id: body.reported_user_id,
        reason: body.reason,
      },
    });
    expect(typeof (lastOutcomeEventPayload as Record<string, unknown>).user_id).toBe('string');
  });
});
