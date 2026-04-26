// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.mock factories run before imports, so any vars they
// reference must be inside vi.hoisted().
// ---------------------------------------------------------------------------

const { stepSendEvent, generateAvatar, getDailyQuota } = vi.hoisted(() => ({
  stepSendEvent: vi.fn().mockResolvedValue({ ids: ['evt_test'] }),
  generateAvatar: vi.fn(async () => ({
    url: '/avatars/placeholder/abc.png',
    placeholder: true,
  })),
  getDailyQuota: vi.fn().mockResolvedValue({ used: 0, max: 4, nextResetAt: new Date() }),
}));

vi.mock('@/lib/inngest/client', () => ({
  inngest: {
    createFunction: (_config: unknown, handler: (ctx: unknown) => Promise<unknown>) => ({
      handler,
    }),
  },
}));

vi.mock('@/lib/avatar/generate', () => ({ generateAvatar }));
vi.mock('@/lib/quota/daily', () => ({ getDailyQuota }));

// ---------------------------------------------------------------------------
// Supabase service-client mock.
// ---------------------------------------------------------------------------

const dbState = {
  candidates: [] as Array<{ candidate_user: string; score: number; is_seed?: boolean }>,
  candidateAgent: null as { id: string; user_id: string } | null,
  agent: null as { avatar_url: string | null; extracted_features: Record<string, unknown> } | null,
  outcomeInserts: [] as unknown[],
  rpcCalls: [] as Array<{ fn: string; args: unknown }>,
  seedPoolActive: true,
};

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
      if (filters['id']) {
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
      if (table === 'outcome_events') {
        return {
          insert(row: unknown) {
            dbState.outcomeInserts.push(row);
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      if (table === 'app_settings') {
        return {
          select: () => ({
            limit: () => ({
              single: () =>
                Promise.resolve({
                  data: { seed_pool_active: dbState.seedPoolActive },
                  error: null,
                }),
            }),
          }),
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

// Minimal step shim — runs callbacks immediately; sendEvent delegates to mock.
function makeCtx(eventData: { user_id: string; agent_id: string }) {
  return {
    event: { name: 'agent.activated', data: eventData },
    step: {
      run: async <T>(_id: string, fn: () => Promise<T>): Promise<T> => fn(),
      sendEvent: stepSendEvent,
    },
    logger: { info: () => {}, error: () => {}, warn: () => {} },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('firstEncounter Inngest fn', () => {
  beforeEach(() => {
    stepSendEvent.mockClear();
    generateAvatar.mockClear();
    getDailyQuota.mockClear();
    getDailyQuota.mockResolvedValue({ used: 0, max: 4, nextResetAt: new Date() });
    dbState.candidates = [];
    dbState.candidateAgent = null;
    dbState.agent = null;
    dbState.outcomeInserts = [];
    dbState.rpcCalls = [];
    dbState.seedPoolActive = true;
  });

  it('happy path: spawns conversation/start with is_first_encounter=true (no pair_key in payload)', async () => {
    const agent_id = 'agent-aaa';
    const candidate_user = 'user-bbb';
    const candidate_agent_id = 'agent-bbb';

    dbState.candidates = [{ candidate_user, score: 0.91, is_seed: false }];
    dbState.candidateAgent = { id: candidate_agent_id, user_id: candidate_user };
    dbState.agent = { avatar_url: null, extracted_features: { tone: 'warm' } };
    dbState.seedPoolActive = true;

    const result = (await handler(makeCtx({ user_id: 'user-aaa', agent_id }))) as {
      spawned: boolean;
      pair_key: string;
      agent_a_id: string;
      agent_b_id: string;
      candidate_user_id: string;
    };

    expect(result.spawned).toBe(true);

    // Deterministic pair_key in return value.
    const expectedPair =
      agent_id < candidate_agent_id
        ? `${agent_id}|${candidate_agent_id}`
        : `${candidate_agent_id}|${agent_id}`;
    expect(result.pair_key).toBe(expectedPair);

    // RPC called with include_seeds=true (default when seed_pool_active=true).
    expect(dbState.rpcCalls).toHaveLength(1);
    expect(dbState.rpcCalls[0]).toMatchObject({
      fn: 'match_candidates',
      args: expect.objectContaining({ include_seeds: true }),
    });

    // Avatar was generated since avatar_url was null.
    expect(generateAvatar).toHaveBeenCalledWith({
      agent_id,
      extracted_features: { tone: 'warm' },
    });

    // conversation/start sent via step.sendEvent with is_first_encounter=true.
    // pair_key must NOT be in the payload (Phase 2 ignores it; omitting keeps payload clean).
    expect(stepSendEvent).toHaveBeenCalledWith(
      'send-conversation-start',
      expect.objectContaining({
        name: 'conversation/start',
        data: expect.objectContaining({
          user_id: 'user-aaa',
          agent_a_id: agent_id,
          agent_b_id: candidate_agent_id,
          surface: 'dating',
          is_first_encounter: true,
        }),
      }),
    );

    // pair_key must NOT be sent in the conversation/start payload.
    const sentData = stepSendEvent.mock.calls[0]?.[1]?.data as Record<string, unknown>;
    expect(sentData).not.toHaveProperty('pair_key');
    expect(sentData).not.toHaveProperty('first_encounter');
  });

  it('exits cleanly when no candidate is available (recovery will retry)', async () => {
    dbState.candidates = [];

    const result = (await handler(makeCtx({ user_id: 'user-aaa', agent_id: 'agent-aaa' }))) as {
      spawned: boolean;
      reason?: string;
    };

    expect(result.spawned).toBe(false);
    expect(result.reason).toBe('no_candidate');
    expect(stepSendEvent).not.toHaveBeenCalled();
    expect(generateAvatar).not.toHaveBeenCalled();
  });

  it('skips avatar generation when avatar_url is already set', async () => {
    dbState.candidates = [{ candidate_user: 'user-c', score: 0.5 }];
    dbState.candidateAgent = { id: 'agent-c', user_id: 'user-c' };
    dbState.agent = { avatar_url: '/already/here.png', extracted_features: {} };

    await handler(makeCtx({ user_id: 'u', agent_id: 'agent-aa' }));

    expect(generateAvatar).not.toHaveBeenCalled();
    expect(stepSendEvent).toHaveBeenCalledTimes(1);
  });

  it('throws when event payload is missing required fields', async () => {
    await expect(handler(makeCtx({ user_id: '', agent_id: '' }))).rejects.toThrow(
      /missing user_id or agent_id/,
    );
  });

  it('passes include_seeds=false to RPC when seed_pool_active=false', async () => {
    dbState.seedPoolActive = false;
    // RPC honours include_seeds at SQL level; mock returns only non-seed rows.
    dbState.candidates = [{ candidate_user: 'user-real', score: 0.8, is_seed: false }];
    dbState.candidateAgent = { id: 'agent-real', user_id: 'user-real' };
    dbState.agent = { avatar_url: '/avatar.png', extracted_features: {} };

    const result = (await handler(makeCtx({ user_id: 'user-aaa', agent_id: 'agent-aaa' }))) as {
      spawned: boolean;
      candidate_user_id?: string;
    };

    expect(result.spawned).toBe(true);
    expect(result.candidate_user_id).toBe('user-real');

    // RPC must have been called with include_seeds=false.
    expect(dbState.rpcCalls).toHaveLength(1);
    expect(dbState.rpcCalls[0]).toMatchObject({
      fn: 'match_candidates',
      args: expect.objectContaining({ include_seeds: false }),
    });
  });

  it('returns no_candidate when seed_pool_active=false and RPC returns empty (all seeds filtered SQL-side)', async () => {
    dbState.seedPoolActive = false;
    // SQL filter has already excluded seeds; mock returns empty.
    dbState.candidates = [];

    const result = (await handler(makeCtx({ user_id: 'user-aaa', agent_id: 'agent-aaa' }))) as {
      spawned: boolean;
      reason?: string;
    };

    expect(result.spawned).toBe(false);
    expect(result.reason).toBe('no_candidate');
    expect(stepSendEvent).not.toHaveBeenCalled();

    // Still called the RPC with include_seeds=false.
    expect(dbState.rpcCalls).toHaveLength(1);
    expect(dbState.rpcCalls[0]).toMatchObject({
      fn: 'match_candidates',
      args: expect.objectContaining({ include_seeds: false }),
    });
  });

  it('inserts wont_connect outcome and returns early when daily quota is exceeded', async () => {
    getDailyQuota.mockResolvedValue({ used: 4, max: 4, nextResetAt: new Date() });

    const result = (await handler(makeCtx({ user_id: 'user-quota', agent_id: 'agent-quota' }))) as {
      spawned: boolean;
      reason?: string;
    };

    expect(result.spawned).toBe(false);
    expect(result.reason).toBe('daily_quota_exceeded');

    // No conversation/start event emitted.
    expect(stepSendEvent).not.toHaveBeenCalled();

    // wont_connect outcome_event inserted.
    expect(dbState.outcomeInserts).toHaveLength(1);
    expect(dbState.outcomeInserts[0]).toMatchObject({
      user_id: 'user-quota',
      event_type: 'wont_connect',
      source_screen: 'first-encounter',
    });
  });
});
