// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

vi.mock('@/lib/posthog/cohort', () => ({ hashCohort: hashCohortMock }));
vi.mock('@/lib/posthog/server', () => ({
  getPostHogServer: () => ({ capture: posthogCapture, flush: posthogFlush }),
}));

const dbState = {
  appSettings: { user_badges: {} as Record<string, { pending: boolean; last_set_at: string }> },
};

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: () => ({
    from(table: string) {
      if (table === 'app_settings') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: dbState.appSettings, error: null }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            if (payload.user_badges) {
              dbState.appSettings.user_badges = payload.user_badges as Record<
                string,
                { pending: boolean; last_set_at: string }
              >;
            }
            return { eq: () => Promise.resolve({ data: null, error: null }) };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

import { mutualPush } from '../mutual-push';

const handler = (mutualPush as unknown as { handler: (ctx: unknown) => Promise<unknown> }).handler;

function makeCtx(data: Record<string, unknown>) {
  return {
    event: { name: 'match.mutual', data },
    step: {
      run: async <T>(_id: string, fn: () => Promise<T>): Promise<T> => fn(),
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };
}

describe('mutualPush Inngest fn', () => {
  beforeEach(() => {
    posthogCapture.mockClear();
    posthogFlush.mockClear();
    hashCohortMock.mockClear();
    dbState.appSettings = { user_badges: {} };
    delete process.env.WORLD_APP_PUSH_ENABLED;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws when payload missing user ids', async () => {
    await expect(
      handler(makeCtx({ match_id_a: 'ma', match_id_b: 'mb', user_a: '', user_b: '' })),
    ).rejects.toThrow(/user_a or user_b/);
  });

  it('falls back to badge for both users when push disabled', async () => {
    const result = (await handler(
      makeCtx({ match_id_a: 'ma', match_id_b: 'mb', user_a: 'ua', user_b: 'ub' }),
    )) as { results: Array<{ user_id: string; ok: boolean; attempted: boolean }> };

    expect(result.results).toHaveLength(2);
    expect(dbState.appSettings.user_badges['ua']).toBeDefined();
    expect(dbState.appSettings.user_badges['ub']).toBeDefined();

    // Two PostHog captures, one per side, with hashed distinct ids.
    expect(posthogCapture).toHaveBeenCalledTimes(2);
    expect(posthogCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: 'hashed:ua',
        event: 'mutual_match_push_sent',
        properties: expect.objectContaining({ match_id: 'ma', push_ok: false }),
      }),
    );
    expect(posthogCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: 'hashed:ub',
        event: 'mutual_match_push_sent',
        properties: expect.objectContaining({ match_id: 'mb', push_ok: false }),
      }),
    );
  });

  it('skips badge fallback for both users when push succeeds', async () => {
    process.env.WORLD_APP_PUSH_ENABLED = 'true';
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }));

    await handler(makeCtx({ match_id_a: 'ma', match_id_b: 'mb', user_a: 'ua', user_b: 'ub' }));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(dbState.appSettings.user_badges['ua']).toBeUndefined();
    expect(dbState.appSettings.user_badges['ub']).toBeUndefined();
    expect(posthogCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({ push_ok: true }),
      }),
    );
  });

  it('falls back to badge for the side whose push fails', async () => {
    process.env.WORLD_APP_PUSH_ENABLED = 'true';
    let call = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      call += 1;
      // First call (ua) succeeds, second (ub) fails.
      return new Response('x', { status: call === 1 ? 200 : 503 });
    });

    await handler(makeCtx({ match_id_a: 'ma', match_id_b: 'mb', user_a: 'ua', user_b: 'ub' }));

    expect(dbState.appSettings.user_badges['ua']).toBeUndefined();
    expect(dbState.appSettings.user_badges['ub']).toBeDefined();
  });
});
