// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/inngest/client', () => ({
  inngest: {
    createFunction: (_config: unknown, handler: (ctx: unknown) => Promise<unknown>) => ({
      handler,
    }),
  },
}));

interface DbState {
  staleConversations: Array<{ id: string }>;
  turnsByConversation: Record<string, number>;
  abandonedIds: string[];
}

const dbState: DbState = {
  staleConversations: [],
  turnsByConversation: {},
  abandonedIds: [],
};

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: () => ({
    from(table: string) {
      if (table === 'conversations') {
        return {
          select: () => {
            const builder = {
              eq(_col: string, _val: unknown) {
                return builder;
              },
              lt(_col: string, _val: string) {
                return Promise.resolve({ data: dbState.staleConversations, error: null });
              },
            };
            return builder;
          },
          update: (payload: Record<string, unknown>) => ({
            in(_col: string, ids: string[]) {
              return {
                eq(_col2: string, _val: unknown) {
                  return {
                    select(_cols: string) {
                      // Only ids that were both in the set AND status='live' get returned.
                      // Our mock keeps it simple: every id passed becomes abandoned.
                      const updated = ids.map((id) => ({ id }));
                      if (payload.status === 'abandoned') {
                        dbState.abandonedIds.push(...ids);
                      }
                      return Promise.resolve({ data: updated, error: null });
                    },
                  };
                },
              };
            },
          }),
        };
      }
      if (table === 'conversation_turns') {
        return {
          select: () => ({
            in: (_col: string, ids: string[]) => {
              const rows: Array<{ conversation_id: string }> = [];
              for (const id of ids) {
                const count = dbState.turnsByConversation[id] ?? 0;
                for (let i = 0; i < count; i++) {
                  rows.push({ conversation_id: id });
                }
              }
              return Promise.resolve({ data: rows, error: null });
            },
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

import { cleanupOrphans } from '../cleanup-orphans';

const handler = (cleanupOrphans as unknown as { handler: (ctx: unknown) => Promise<unknown> })
  .handler;

function makeCtx() {
  return {
    step: { run: async <T>(_id: string, fn: () => Promise<T>): Promise<T> => fn() },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };
}

describe('cleanupOrphans Inngest fn', () => {
  beforeEach(() => {
    dbState.staleConversations = [];
    dbState.turnsByConversation = {};
    dbState.abandonedIds = [];
  });

  it('returns 0 when there are no stale conversations', async () => {
    const result = (await handler(makeCtx())) as { abandoned: number };
    expect(result.abandoned).toBe(0);
  });

  it('marks stale live conversations with no turns as abandoned', async () => {
    dbState.staleConversations = [{ id: 'c1' }, { id: 'c2' }];
    dbState.turnsByConversation = {}; // none have turns

    const result = (await handler(makeCtx())) as { abandoned: number };
    expect(result.abandoned).toBe(2);
    expect(dbState.abandonedIds.sort()).toEqual(['c1', 'c2']);
  });

  it('skips conversations that already have at least one turn', async () => {
    dbState.staleConversations = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }];
    dbState.turnsByConversation = { c2: 3 };

    const result = (await handler(makeCtx())) as { abandoned: number };
    expect(result.abandoned).toBe(2);
    expect(dbState.abandonedIds.sort()).toEqual(['c1', 'c3']);
  });

  it('returns 0 when every stale conversation has turns', async () => {
    dbState.staleConversations = [{ id: 'c1' }];
    dbState.turnsByConversation = { c1: 1 };

    const result = (await handler(makeCtx())) as { abandoned: number };
    expect(result.abandoned).toBe(0);
    expect(dbState.abandonedIds).toEqual([]);
  });
});
