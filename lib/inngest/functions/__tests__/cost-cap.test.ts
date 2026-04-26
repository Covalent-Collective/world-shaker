// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  appSettings: {
    cost_cap_usd_daily: string | number;
    streaming_paused: boolean;
  };
  ledgerRows: Array<{ cost_usd: number | string; occurred_at: string }>;
  appSettingsUpdates: Array<Record<string, unknown>>;
}

const dbState: DbState = {
  appSettings: { cost_cap_usd_daily: 100, streaming_paused: false },
  ledgerRows: [],
  appSettingsUpdates: [],
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
            dbState.appSettingsUpdates.push(payload);
            Object.assign(dbState.appSettings, payload);
            return { eq: () => Promise.resolve({ data: null, error: null }) };
          },
        };
      }
      if (table === 'llm_budget_ledger') {
        return {
          select: () => {
            const filters: { gte?: string; lt?: string } = {};
            const builder = {
              gte(_col: string, val: string) {
                filters.gte = val;
                return builder;
              },
              lt(_col: string, val: string) {
                filters.lt = val;
                const out = dbState.ledgerRows.filter((r) => {
                  if (filters.gte && r.occurred_at < filters.gte) return false;
                  if (filters.lt && r.occurred_at >= filters.lt) return false;
                  return true;
                });
                return Promise.resolve({ data: out, error: null });
              },
            };
            return builder;
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

import { costCapSettlement, costCapAlert } from '../cost-cap';

type Handler = (ctx: unknown) => Promise<unknown>;
const settlementHandler = (costCapSettlement as unknown as { handler: Handler }).handler;
const alertHandler = (costCapAlert as unknown as { handler: Handler }).handler;

function makeCtx() {
  return {
    step: { run: async <T>(_id: string, fn: () => Promise<T>): Promise<T> => fn() },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };
}

function isoForOffsetDays(days: number): string {
  // Build an iso timestamp for the middle of the day `days` offset from today UTC.
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return new Date(
    todayStart.getTime() + days * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000,
  ).toISOString();
}

describe('costCapSettlement', () => {
  beforeEach(() => {
    posthogCapture.mockClear();
    posthogFlush.mockClear();
    dbState.appSettings = { cost_cap_usd_daily: 100, streaming_paused: true };
    dbState.ledgerRows = [];
    dbState.appSettingsUpdates = [];
  });

  it('resets streaming_paused to false when yesterday spend was under cap', async () => {
    dbState.ledgerRows = [
      { cost_usd: 10, occurred_at: isoForOffsetDays(-1) },
      { cost_usd: 5, occurred_at: isoForOffsetDays(-1) },
    ];

    const result = (await settlementHandler(makeCtx())) as {
      yesterday_spend: number;
      cap: number;
      under_cap: boolean;
    };

    expect(result.yesterday_spend).toBe(15);
    expect(result.under_cap).toBe(true);
    expect(dbState.appSettingsUpdates).toEqual(
      expect.arrayContaining([expect.objectContaining({ streaming_paused: false })]),
    );
  });

  it('does not reset flag when yesterday spend was over cap', async () => {
    dbState.appSettings = { cost_cap_usd_daily: 10, streaming_paused: true };
    dbState.ledgerRows = [{ cost_usd: 50, occurred_at: isoForOffsetDays(-1) }];

    const result = (await settlementHandler(makeCtx())) as { under_cap: boolean };
    expect(result.under_cap).toBe(false);
    expect(dbState.appSettingsUpdates).toHaveLength(0);
  });

  it('skips reset when streaming_paused already false', async () => {
    dbState.appSettings = { cost_cap_usd_daily: 100, streaming_paused: false };
    dbState.ledgerRows = [{ cost_usd: 5, occurred_at: isoForOffsetDays(-1) }];

    await settlementHandler(makeCtx());
    expect(dbState.appSettingsUpdates).toHaveLength(0);
  });
});

describe('costCapAlert', () => {
  beforeEach(() => {
    posthogCapture.mockClear();
    posthogFlush.mockClear();
    dbState.appSettings = { cost_cap_usd_daily: 100, streaming_paused: false };
    dbState.ledgerRows = [];
    dbState.appSettingsUpdates = [];
    delete process.env.SLACK_WEBHOOK_URL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not fire when current spend is below 80%', async () => {
    dbState.ledgerRows = [{ cost_usd: 50, occurred_at: isoForOffsetDays(0) }];
    const result = (await alertHandler(makeCtx())) as { fired: boolean };
    expect(result.fired).toBe(false);
    expect(posthogCapture).not.toHaveBeenCalled();
  });

  it('fires PostHog warning when spend exceeds 80%', async () => {
    dbState.ledgerRows = [{ cost_usd: 85, occurred_at: isoForOffsetDays(0) }];
    const result = (await alertHandler(makeCtx())) as { fired: boolean; percent: number };
    expect(result.fired).toBe(true);
    expect(result.percent).toBeGreaterThan(0.8);
    expect(posthogCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'cost_cap_warning_80pct',
        properties: expect.objectContaining({ spend: 85, cap: 100 }),
      }),
    );
  });

  it('POSTs to Slack webhook when configured and over threshold', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.test/abc';
    dbState.ledgerRows = [{ cost_usd: 90, occurred_at: isoForOffsetDays(0) }];

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }));

    await alertHandler(makeCtx());

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://hooks.slack.test/abc',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('World Shaker cost cap warning'),
      }),
    );
  });

  it('does not crash when Slack webhook fails', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.test/abc';
    dbState.ledgerRows = [{ cost_usd: 90, occurred_at: isoForOffsetDays(0) }];

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('boom'));

    const result = (await alertHandler(makeCtx())) as { fired: boolean };
    expect(result.fired).toBe(true);
  });

  it('returns early when cap is 0', async () => {
    dbState.appSettings = { cost_cap_usd_daily: 0, streaming_paused: false };
    const result = (await alertHandler(makeCtx())) as { fired: boolean };
    expect(result.fired).toBe(false);
  });
});
