// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signWorldUserJwt, SESSION_COOKIE } from '@/lib/auth/jwt';

// ---------------------------------------------------------------------------
// Cookies mock — Next.js `cookies()` from 'next/headers'.
// ---------------------------------------------------------------------------

let cookieJar: Record<string, string> = {};
vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (cookieJar[name] ? { name, value: cookieJar[name] } : undefined),
    }),
}));

// ---------------------------------------------------------------------------
// Inngest client mock — capture .send calls. Hoisted because vi.mock factories
// run before module body.
// ---------------------------------------------------------------------------

const { inngestSend } = vi.hoisted(() => ({
  inngestSend: vi.fn().mockResolvedValue({ ids: ['evt_x'] }),
}));
vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: inngestSend },
}));

// ---------------------------------------------------------------------------
// Supabase service-client mock.
// ---------------------------------------------------------------------------

const dbState = {
  agent: null as { id: string } | null,
  completedMatch: null as { id: string } | null,
  conversationCount: 0,
};

function makeAgentsSelect(): unknown {
  const builder = {
    eq() {
      return builder;
    },
    maybeSingle() {
      return Promise.resolve({ data: dbState.agent, error: null });
    },
  };
  return builder;
}

function makeMatchesSelect(): unknown {
  const builder = {
    eq() {
      return builder;
    },
    in() {
      return builder;
    },
    limit() {
      return builder;
    },
    maybeSingle() {
      return Promise.resolve({ data: dbState.completedMatch, error: null });
    },
  };
  return builder;
}

function makeConversationsSelect(): unknown {
  const builder = {
    or() {
      return builder;
    },
    eq() {
      // Final terminal in the chain — Supabase resolves the count here.
      return Promise.resolve({ count: dbState.conversationCount, error: null });
    },
  };
  return builder;
}

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: () => ({
    from(table: string) {
      if (table === 'agents') {
        return { select: () => makeAgentsSelect() };
      }
      if (table === 'matches') {
        return { select: () => makeMatchesSelect() };
      }
      if (table === 'conversations') {
        return {
          select: () => makeConversationsSelect(),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

// ---------------------------------------------------------------------------
// Module under test — import AFTER mocks.
// ---------------------------------------------------------------------------

import { POST } from '../route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setSessionCookie(world_user_id: string) {
  const token = await signWorldUserJwt({
    world_user_id,
    nullifier: 'nullifier-test',
    language_pref: 'ko',
  });
  cookieJar[SESSION_COOKIE] = token;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/first-encounter/recover', () => {
  beforeEach(() => {
    cookieJar = {};
    inngestSend.mockClear();
    dbState.agent = null;
    dbState.completedMatch = null;
    dbState.conversationCount = 0;
  });

  it('returns 401 when ws_session cookie is missing', async () => {
    const res = await POST();
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('unauthorized');
    expect(inngestSend).not.toHaveBeenCalled();
  });

  it('returns 401 when ws_session cookie is malformed', async () => {
    cookieJar[SESSION_COOKIE] = 'not-a-real-jwt';
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it('returns recovered=false when user has no active agent', async () => {
    await setSessionCookie('user-a');
    dbState.agent = null;

    const res = await POST();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ recovered: false });
    expect(inngestSend).not.toHaveBeenCalled();
  });

  it('returns recovered=false when a completed first-encounter match already exists (status accepted)', async () => {
    await setSessionCookie('user-b');
    dbState.agent = { id: 'agent-b' };
    dbState.completedMatch = { id: 'match-1' };

    const res = await POST();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ recovered: false });
    expect(inngestSend).not.toHaveBeenCalled();
  });

  it('recovers and emits agent.activated when active agent has no completed first-encounter match', async () => {
    await setSessionCookie('user-c');
    dbState.agent = { id: 'agent-c' };
    dbState.completedMatch = null;
    dbState.conversationCount = 0; // first attempt

    const res = await POST();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ recovered: true, attempt: 1 });

    expect(inngestSend).toHaveBeenCalledTimes(1);
    expect(inngestSend).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'agent-c:first_encounter:1',
        name: 'agent.activated',
        data: expect.objectContaining({
          user_id: 'user-c',
          agent_id: 'agent-c',
          attempt: 1,
        }),
      }),
    );
  });

  it('idempotency key includes attempt number and increments with prior conversations', async () => {
    await setSessionCookie('user-d');
    dbState.agent = { id: 'agent-d' };
    dbState.completedMatch = null;
    dbState.conversationCount = 2; // two prior attempts already exist

    const res = await POST();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.recovered).toBe(true);
    expect(json.attempt).toBe(3);

    const sendArg = inngestSend.mock.calls[0][0] as { id: string };
    expect(sendArg.id).toBe('agent-d:first_encounter:3');
  });

  it('repeat call within the same attempt window produces the same idempotency key', async () => {
    await setSessionCookie('user-e');
    dbState.agent = { id: 'agent-e' };
    dbState.completedMatch = null;
    dbState.conversationCount = 0;

    const r1 = await POST();
    const r2 = await POST();

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const j1 = await r1.json();
    const j2 = await r2.json();
    expect(j1).toEqual({ recovered: true, attempt: 1 });
    expect(j2).toEqual({ recovered: true, attempt: 1 });

    // Both calls produced the same idempotency id — Inngest dedup contract.
    const id1 = (inngestSend.mock.calls[0][0] as { id: string }).id;
    const id2 = (inngestSend.mock.calls[1][0] as { id: string }).id;
    expect(id1).toBe(id2);
    expect(id1).toBe('agent-e:first_encounter:1');
  });
});
