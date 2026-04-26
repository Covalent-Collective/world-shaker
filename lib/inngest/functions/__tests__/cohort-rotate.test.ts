// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';

const { posthogCapture, posthogFlush } = vi.hoisted(() => ({
  posthogCapture: vi.fn(),
  posthogFlush: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/inngest/client', () => ({
  inngest: {
    createFunction: (_config: unknown, handler: (ctx: unknown) => Promise<unknown>) => ({
      handler,
    }),
  },
}));

vi.mock('@/lib/posthog/server', () => ({
  getPostHogServer: () => ({ capture: posthogCapture, flush: posthogFlush }),
}));

interface DbState {
  appSettingsUpdates: Array<Record<string, unknown>>;
  users: Array<{ id: string }>;
  userUpdates: Array<{ id: string; posthog_cohort: string }>;
}

const dbState: DbState = {
  appSettingsUpdates: [],
  users: [],
  userUpdates: [],
};

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: () => ({
    from(table: string) {
      if (table === 'app_settings') {
        return {
          update: (payload: Record<string, unknown>) => {
            dbState.appSettingsUpdates.push(payload);
            return { eq: () => Promise.resolve({ data: null, error: null }) };
          },
        };
      }
      if (table === 'users') {
        return {
          select: () => ({
            order: () => ({
              range: (start: number, end: number) => {
                const slice = dbState.users.slice(start, end + 1);
                return Promise.resolve({ data: slice, error: null });
              },
            }),
          }),
          update: (payload: Record<string, unknown>) => ({
            eq: (_col: string, val: string) => {
              dbState.userUpdates.push({
                id: val,
                posthog_cohort: payload.posthog_cohort as string,
              });
              return Promise.resolve({ data: null, error: null });
            },
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

import { cohortRotate } from '../cohort-rotate';

const handler = (cohortRotate as unknown as { handler: (ctx: unknown) => Promise<unknown> })
  .handler;

function makeCtx() {
  return {
    step: { run: async <T>(_id: string, fn: () => Promise<T>): Promise<T> => fn() },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };
}

describe('cohortRotate Inngest fn', () => {
  beforeEach(() => {
    posthogCapture.mockClear();
    posthogFlush.mockClear();
    dbState.appSettingsUpdates = [];
    dbState.users = [];
    dbState.userUpdates = [];
  });

  it('rotates salt and emits PostHog event when no users to backfill', async () => {
    const result = (await handler(makeCtx())) as { rotation_at: string; user_count: number };
    expect(result.user_count).toBe(0);

    // app_settings updated with a new 64-char hex salt + rotated_at.
    expect(dbState.appSettingsUpdates).toHaveLength(1);
    const update = dbState.appSettingsUpdates[0]!;
    expect(typeof update.posthog_cohort_salt).toBe('string');
    expect((update.posthog_cohort_salt as string).length).toBe(64);
    expect(update.posthog_cohort_salt_rotated_at).toBe(result.rotation_at);

    expect(posthogCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'posthog_cohort_rotated',
        properties: expect.objectContaining({ user_count: 0 }),
      }),
    );
  });

  it('backfills users.posthog_cohort with sha256(id || ":" || salt)', async () => {
    dbState.users = [{ id: 'user-1' }, { id: 'user-2' }, { id: 'user-3' }];

    const result = (await handler(makeCtx())) as { user_count: number };
    expect(result.user_count).toBe(3);
    expect(dbState.userUpdates).toHaveLength(3);

    const newSalt = dbState.appSettingsUpdates[0]!.posthog_cohort_salt as string;

    for (const upd of dbState.userUpdates) {
      const expected = createHash('sha256').update(`${upd.id}:${newSalt}`).digest('hex');
      expect(upd.posthog_cohort).toBe(expected);
    }
  });

  it('paginates correctly across multiple batches', async () => {
    // Build 1500 users to exercise the 1000-batch pagination.
    dbState.users = Array.from({ length: 1500 }, (_, i) => ({ id: `u${i}` }));
    const result = (await handler(makeCtx())) as { user_count: number };
    expect(result.user_count).toBe(1500);
    expect(dbState.userUpdates).toHaveLength(1500);
  });

  it('produces a different salt on each invocation', async () => {
    await handler(makeCtx());
    const first = dbState.appSettingsUpdates[0]!.posthog_cohort_salt as string;

    dbState.appSettingsUpdates = [];
    await handler(makeCtx());
    const second = dbState.appSettingsUpdates[0]!.posthog_cohort_salt as string;

    expect(first).not.toBe(second);
  });
});
