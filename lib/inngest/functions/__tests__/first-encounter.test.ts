// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.mock factories run before imports, so any vars they
// reference must be inside vi.hoisted().
// ---------------------------------------------------------------------------

const { inngestSend, generateAvatar } = vi.hoisted(() => ({
  inngestSend: vi.fn().mockResolvedValue({ ids: ['evt_test'] }),
  generateAvatar: vi.fn(async () => ({
    url: '/avatars/placeholder/abc.png',
    placeholder: true,
  })),
}));

vi.mock('@/lib/inngest/client', () => ({
  inngest: {
    createFunction: (_config: unknown, handler: (ctx: unknown) => Promise<unknown>) => ({
      handler,
    }),
    send: inngestSend,
  },
}));

vi.mock('@/lib/avatar/generate', () => ({ generateAvatar }));

// ---------------------------------------------------------------------------
// Supabase service-client mock.
// ---------------------------------------------------------------------------

interface MatchesRow {
  id: string;
  user_id: string;
  candidate_user_id: string;
  origin: string;
  first_encounter: boolean;
  created_at: string;
}

const dbState = {
  candidates: [] as Array<{ candidate_user: string; score: number }>,
  candidateAgent: null as { id: string; user_id: string } | null,
  agent: null as { avatar_url: string | null; extracted_features: Record<string, unknown> } | null,
  matchesRow: null as MatchesRow | null,
  updatedMatches: [] as Array<{ id: string; first_encounter: boolean }>,
  rpcCalls: [] as Array<{ fn: string; args: unknown }>,
};

function makeMatchesSelect(): unknown {
  const filters: Record<string, unknown> = {};
  const builder = {
    eq(col: string, val: unknown) {
      filters[col] = val;
      return builder;
    },
    order() {
      return builder;
    },
    limit() {
      return builder;
    },
    maybeSingle() {
      if (dbState.matchesRow) {
        return Promise.resolve({ data: { id: dbState.matchesRow.id }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  return builder;
}

function makeMatchesUpdate(payload: { first_encounter: boolean }): unknown {
  return {
    eq(_col: string, val: string) {
      dbState.updatedMatches.push({ id: val, first_encounter: payload.first_encounter });
      if (dbState.matchesRow && dbState.matchesRow.id === val) {
        dbState.matchesRow.first_encounter = payload.first_encounter;
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
}

function makeAgentsSelect(_cols: string): unknown {
  const filters: Record<string, unknown> = {};
  const builder = {
    eq(col: string, val: unknown) {
      filters[col] = val;
      return builder;
    },
    maybeSingle() {
      // Distinguish: candidate-agent lookup uses user_id+status; primary-agent
      // lookup uses id alone.
      if (filters.id) {
        return Promise.resolve({ data: dbState.agent, error: null });
      }
      return Promise.resolve({ data: dbState.candidateAgent, error: null });
    },
  };
  return builder;
}

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: () => ({
    rpc(fn: string, args: unknown) {
      dbState.rpcCalls.push({ fn, args });
      if (fn === 'match_candidates') {
        return Promise.resolve({ data: dbState.candidates, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unknown rpc: ${fn}` } });
    },
    from(table: string) {
      if (table === 'agents') {
        return {
          select: (cols: string) => makeAgentsSelect(cols),
        };
      }
      if (table === 'matches') {
        return {
          select: () => makeMatchesSelect(),
          update: (payload: { first_encounter: boolean }) => makeMatchesUpdate(payload),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

// ---------------------------------------------------------------------------
// Module under test (imported AFTER mocks are registered).
// ---------------------------------------------------------------------------

import { firstEncounter } from '../first-encounter';

// The mocked createFunction returns { handler }. Pull it out for direct call.
const handler = (firstEncounter as unknown as { handler: (ctx: unknown) => Promise<unknown> })
  .handler;

// Minimal `step.run` shim — runs callbacks immediately.
function makeCtx(eventData: { user_id: string; agent_id: string }) {
  return {
    event: { name: 'agent.activated', data: eventData },
    step: {
      run: async <T>(_id: string, fn: () => Promise<T>): Promise<T> => fn(),
    },
    logger: { info: () => {}, error: () => {}, warn: () => {} },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('firstEncounter Inngest fn', () => {
  beforeEach(() => {
    inngestSend.mockClear();
    generateAvatar.mockClear();
    dbState.candidates = [];
    dbState.candidateAgent = null;
    dbState.agent = null;
    dbState.matchesRow = null;
    dbState.updatedMatches = [];
    dbState.rpcCalls = [];
  });

  it('happy path: spawns conversation/start with deterministic pair_key and marks matches.first_encounter', async () => {
    const agent_id = 'agent-aaa';
    const candidate_user = 'user-bbb';
    const candidate_agent_id = 'agent-bbb';

    dbState.candidates = [{ candidate_user, score: 0.91 }];
    dbState.candidateAgent = { id: candidate_agent_id, user_id: candidate_user };
    dbState.agent = { avatar_url: null, extracted_features: { tone: 'warm' } };
    dbState.matchesRow = {
      id: 'match-1',
      user_id: 'user-aaa',
      candidate_user_id: candidate_user,
      origin: 'system_generated',
      first_encounter: false,
      created_at: new Date().toISOString(),
    };

    const result = (await handler(makeCtx({ user_id: 'user-aaa', agent_id }))) as {
      spawned: boolean;
      pair_key: string;
      first_encounter_marked: boolean;
      match_id: string | null;
    };

    expect(result.spawned).toBe(true);
    // Deterministic pair_key: lexicographic sort joined by '|'.
    const expectedPair =
      agent_id < candidate_agent_id
        ? `${agent_id}|${candidate_agent_id}`
        : `${candidate_agent_id}|${agent_id}`;
    expect(result.pair_key).toBe(expectedPair);

    // Avatar was generated since avatar_url was null.
    expect(generateAvatar).toHaveBeenCalledWith({
      agent_id,
      extracted_features: { tone: 'warm' },
    });

    // conversation/start event sent with both agents + pair_key.
    expect(inngestSend).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'conversation/start',
        data: expect.objectContaining({
          user_id: 'user-aaa',
          agent_a_id: agent_id,
          agent_b_id: candidate_agent_id,
          pair_key: expectedPair,
          surface: 'dating',
          first_encounter: true,
        }),
      }),
    );

    // matches row was stamped first_encounter=true.
    expect(result.first_encounter_marked).toBe(true);
    expect(result.match_id).toBe('match-1');
    expect(dbState.updatedMatches).toContainEqual({ id: 'match-1', first_encounter: true });
  });

  it('exits cleanly when no candidate is available (recovery will retry)', async () => {
    dbState.candidates = [];

    const result = (await handler(makeCtx({ user_id: 'user-aaa', agent_id: 'agent-aaa' }))) as {
      spawned: boolean;
      reason?: string;
    };

    expect(result.spawned).toBe(false);
    expect(result.reason).toBe('no_candidate');
    expect(inngestSend).not.toHaveBeenCalled();
    expect(generateAvatar).not.toHaveBeenCalled();
  });

  it('skips avatar generation when avatar_url is already set', async () => {
    dbState.candidates = [{ candidate_user: 'user-c', score: 0.5 }];
    dbState.candidateAgent = { id: 'agent-c', user_id: 'user-c' };
    dbState.agent = { avatar_url: '/already/here.png', extracted_features: {} };
    dbState.matchesRow = {
      id: 'm2',
      user_id: 'u',
      candidate_user_id: 'user-c',
      origin: 'system_generated',
      first_encounter: false,
      created_at: new Date().toISOString(),
    };

    await handler(makeCtx({ user_id: 'u', agent_id: 'agent-aa' }));

    expect(generateAvatar).not.toHaveBeenCalled();
    expect(inngestSend).toHaveBeenCalledTimes(1);
  });

  it('throws when event payload is missing required fields', async () => {
    await expect(handler(makeCtx({ user_id: '', agent_id: '' }))).rejects.toThrow(
      /missing user_id or agent_id/,
    );
  });
});
