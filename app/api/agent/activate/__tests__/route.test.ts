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
// Inngest client mock
// ---------------------------------------------------------------------------

const { inngestSend } = vi.hoisted(() => ({
  inngestSend: vi.fn().mockResolvedValue({ ids: ['evt_activate'] }),
}));
vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: inngestSend },
}));

// ---------------------------------------------------------------------------
// Supabase service-client mock
// ---------------------------------------------------------------------------

const dbState = {
  agent: null as { id: string } | null,
  agentError: null as { message: string } | null,
};

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: () => ({
    from(table: string) {
      if (table === 'agents') {
        const builder = {
          select() {
            return builder;
          },
          eq() {
            return builder;
          },
          limit() {
            return builder;
          },
          maybeSingle() {
            return Promise.resolve({ data: dbState.agent, error: dbState.agentError });
          },
        };
        return builder;
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
    language_pref: 'ko',
  });
  cookieJar[SESSION_COOKIE] = token;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/agent/activate', () => {
  beforeEach(() => {
    cookieJar = {};
    inngestSend.mockClear();
    dbState.agent = null;
    dbState.agentError = null;
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
    const json = await res.json();
    expect(json.error).toBe('unauthorized');
    expect(inngestSend).not.toHaveBeenCalled();
  });

  it('returns 404 when user has no active agent', async () => {
    await setSessionCookie('user-no-agent');
    dbState.agent = null;

    const res = await POST();
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('no_active_agent');
    expect(inngestSend).not.toHaveBeenCalled();
  });

  it('returns 200 and emits agent.activated when active agent exists', async () => {
    await setSessionCookie('user-active');
    dbState.agent = { id: 'agent-xyz' };

    const res = await POST();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ activated: true, agent_id: 'agent-xyz' });

    expect(inngestSend).toHaveBeenCalledTimes(1);
    expect(inngestSend).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'agent.activated',
        data: expect.objectContaining({
          user_id: 'user-active',
          agent_id: 'agent-xyz',
        }),
      }),
    );
  });
});
