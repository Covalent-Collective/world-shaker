// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { posthogCapture, posthogFlush, hashCohortMock } = vi.hoisted(() => ({
  posthogCapture: vi.fn(),
  posthogFlush: vi.fn().mockResolvedValue(undefined),
  hashCohortMock: vi.fn(async (id: string) => `hashed:${id}`),
}));

vi.mock('@/lib/inngest/client', () => ({
  inngest: {
    createFunction: (_config: unknown, handler: (ctx: unknown) => Promise<unknown>) => ({
      handler,
    }),
  },
}));

vi.mock('@/lib/posthog/cohort', () => ({
  hashCohort: hashCohortMock,
}));

vi.mock('@/lib/posthog/server', () => ({
  getPostHogServer: () => ({
    capture: posthogCapture,
    flush: posthogFlush,
  }),
}));

// ---------- supabase mock ---------------------------------------------------

interface DbState {
  activeAgents: Array<{ user_id: string }>;
  matchesByUser: Record<string, Array<{ id: string }>>;
  viewedByUser: Record<string, string[]>;
  appSettings: { user_badges: Record<string, { pending: boolean; last_set_at: string }> };
  badgeUpdates: Array<Record<string, unknown>>;
}

const dbState: DbState = {
  activeAgents: [],
  matchesByUser: {},
  viewedByUser: {},
  appSettings: { user_badges: {} },
  badgeUpdates: [],
};

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: () => ({
    from(table: string) {
      if (table === 'agents') {
        return {
          select: () => ({
            eq: (_col: string, _val: unknown) =>
              Promise.resolve({ data: dbState.activeAgents, error: null }),
          }),
        };
      }
      if (table === 'matches') {
        return {
          select: () => {
            const filters: Record<string, unknown> = {};
            const builder = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                return builder;
              },
              gt(_col: string, _val: unknown) {
                const userId = filters['user_id'] as string;
                return Promise.resolve({
                  data: dbState.matchesByUser[userId] ?? [],
                  error: null,
                });
              },
            };
            return builder;
          },
        };
      }
      if (table === 'outcome_events') {
        return {
          select: () => {
            const filters: Record<string, unknown> = {};
            const builder = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                return builder;
              },
              in(_col: string, ids: string[]) {
                const userId = filters['user_id'] as string;
                const viewed = dbState.viewedByUser[userId] ?? [];
                return Promise.resolve({
                  data: viewed.filter((m) => ids.includes(m)).map((match_id) => ({ match_id })),
                  error: null,
                });
              },
            };
            return builder;
          },
        };
      }
      if (table === 'app_settings') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: dbState.appSettings, error: null }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            dbState.badgeUpdates.push(payload);
            if (payload.user_badges) {
              dbState.appSettings.user_badges = payload.user_badges as Record<
                string,
                { pending: boolean; last_set_at: string }
              >;
            }
            return {
              eq: () => Promise.resolve({ data: null, error: null }),
            };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

// ---------------------------------------------------------------------------
// SUT (after mocks)
// ---------------------------------------------------------------------------

import { dailyDigest } from '../daily-digest';

const handler = (dailyDigest as unknown as { handler: (ctx: unknown) => Promise<unknown> }).handler;

function makeCtx() {
  return {
    step: {
      run: async <T>(_id: string, fn: () => Promise<T>): Promise<T> => fn(),
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('dailyDigest Inngest fn', () => {
  beforeEach(() => {
    posthogCapture.mockClear();
    posthogFlush.mockClear();
    hashCohortMock.mockClear();
    dbState.activeAgents = [];
    dbState.matchesByUser = {};
    dbState.viewedByUser = {};
    dbState.appSettings = { user_badges: {} };
    dbState.badgeUpdates = [];
    delete process.env.WORLD_APP_PUSH_ENABLED;
    delete process.env.WORLD_APP_PUSH_URL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exits cleanly when no active users', async () => {
    const result = (await handler(makeCtx())) as { active_users: number; sent: number };
    expect(result.active_users).toBe(0);
    expect(result.sent).toBe(0);
  });

  it('skips users with no recent matches', async () => {
    dbState.activeAgents = [{ user_id: 'u1' }];
    dbState.matchesByUser['u1'] = [];
    const result = (await handler(makeCtx())) as { active_users: number; sent: number };
    expect(result.sent).toBe(0);
  });

  it('skips matches the user has already viewed', async () => {
    dbState.activeAgents = [{ user_id: 'u1' }];
    dbState.matchesByUser['u1'] = [{ id: 'm1' }, { id: 'm2' }];
    dbState.viewedByUser['u1'] = ['m1', 'm2'];

    const result = (await handler(makeCtx())) as { sent: number };
    expect(result.sent).toBe(0);
    expect(posthogCapture).not.toHaveBeenCalled();
  });

  it('falls back to badge when push is disabled (no env)', async () => {
    dbState.activeAgents = [{ user_id: 'u1' }];
    dbState.matchesByUser['u1'] = [{ id: 'm1' }];

    const result = (await handler(makeCtx())) as { sent: number };
    expect(result.sent).toBe(1);

    // Badge written to app_settings.user_badges
    expect(dbState.appSettings.user_badges['u1']).toBeDefined();
    expect(dbState.appSettings.user_badges['u1'].pending).toBe(true);

    // PostHog event captured with hashed distinct id
    expect(hashCohortMock).toHaveBeenCalledWith('u1');
    expect(posthogCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: 'hashed:u1',
        event: 'daily_digest_sent',
        properties: expect.objectContaining({
          match_count: 1,
          push_attempted: false,
          push_ok: false,
        }),
      }),
    );
  });

  it('attempts World App push when enabled and skips badge on success', async () => {
    process.env.WORLD_APP_PUSH_ENABLED = 'true';
    process.env.WORLD_APP_PUSH_URL = 'https://world.test/push';
    dbState.activeAgents = [{ user_id: 'u1' }];
    dbState.matchesByUser['u1'] = [{ id: 'm1' }];

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }));

    const result = (await handler(makeCtx())) as { sent: number };
    expect(result.sent).toBe(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://world.test/push',
      expect.objectContaining({ method: 'POST' }),
    );
    // No badge fallback — push succeeded.
    expect(dbState.appSettings.user_badges['u1']).toBeUndefined();
    expect(posthogCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({ push_ok: true, push_attempted: true }),
      }),
    );
  });

  it('falls back to badge when push fetch returns non-2xx', async () => {
    process.env.WORLD_APP_PUSH_ENABLED = 'true';
    dbState.activeAgents = [{ user_id: 'u1' }];
    dbState.matchesByUser['u1'] = [{ id: 'm1' }];

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('err', { status: 500 }));

    const result = (await handler(makeCtx())) as { sent: number };
    expect(result.sent).toBe(1);
    expect(dbState.appSettings.user_badges['u1']).toBeDefined();
  });

  it('falls back to badge when push fetch throws', async () => {
    process.env.WORLD_APP_PUSH_ENABLED = 'true';
    dbState.activeAgents = [{ user_id: 'u1' }];
    dbState.matchesByUser['u1'] = [{ id: 'm1' }];

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));

    const result = (await handler(makeCtx())) as { sent: number };
    expect(result.sent).toBe(1);
    expect(dbState.appSettings.user_badges['u1']).toBeDefined();
  });
});
