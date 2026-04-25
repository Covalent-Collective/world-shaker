import 'server-only';

import { getServiceClient } from '@/lib/supabase/service';

/**
 * Cost-cap pre-flight check (v3 hardened — synchronous Postgres ledger).
 *
 * Source-of-truth = `llm_budget_ledger` (transactional, no ingestion lag).
 * PostHog `llm_cost` events are NOT consulted for enforcement.
 *
 * Bounded-overshoot disclosure (v4): SUM is non-atomic across concurrent
 * conversations, so worst-case overshoot equals
 *   max_concurrent_conversations × max_cost_per_conversation.
 * `cost_cap_usd_daily` MUST be sized with this headroom in mind.
 *
 * Returns `{ ok: false, reason: 'streaming_paused' }` when the global flag
 * is set; `{ ok: false, reason: 'global_cap_exceeded' }` when the rolling
 * 24-hour global ledger sum exceeds the global cap; or
 * `{ ok: false, reason: 'user_cap_exceeded' }` when the per-user 24-hour
 * sum exceeds the per-user cap.
 */
export type BudgetReason = 'global_cap_exceeded' | 'user_cap_exceeded' | 'streaming_paused';

export interface BudgetResult {
  ok: boolean;
  reason?: BudgetReason;
}

function oneDayAgoIso(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

export async function assertBudgetAvailable(user_id: string): Promise<BudgetResult> {
  const client = getServiceClient();

  // Read app_settings (single row, id=1).
  const { data: settings, error: settingsErr } = await client
    .from('app_settings')
    .select('streaming_paused, cost_cap_usd_daily, cost_cap_usd_per_user_daily')
    .eq('id', 1)
    .maybeSingle();

  if (settingsErr) {
    throw new Error(`assertBudgetAvailable: failed to read app_settings: ${settingsErr.message}`);
  }
  if (!settings) {
    throw new Error('assertBudgetAvailable: app_settings row missing');
  }

  if (settings.streaming_paused === true) {
    return { ok: false, reason: 'streaming_paused' };
  }

  const globalCap = Number(settings.cost_cap_usd_daily ?? 0);
  const userCap = Number(settings.cost_cap_usd_per_user_daily ?? 0);
  const since = oneDayAgoIso();

  // Global rolling-24h spend.
  const { data: globalRows, error: globalErr } = await client
    .from('llm_budget_ledger')
    .select('cost_usd')
    .gt('occurred_at', since);

  if (globalErr) {
    throw new Error(`assertBudgetAvailable: global ledger read failed: ${globalErr.message}`);
  }

  const globalSum = (globalRows ?? []).reduce(
    (acc: number, row: { cost_usd: number | string | null }) => acc + Number(row.cost_usd ?? 0),
    0,
  );

  if (globalSum > globalCap) {
    return { ok: false, reason: 'global_cap_exceeded' };
  }

  // Per-user rolling-24h spend.
  const { data: userRows, error: userErr } = await client
    .from('llm_budget_ledger')
    .select('cost_usd')
    .eq('user_id', user_id)
    .gt('occurred_at', since);

  if (userErr) {
    throw new Error(`assertBudgetAvailable: per-user ledger read failed: ${userErr.message}`);
  }

  const userSum = (userRows ?? []).reduce(
    (acc: number, row: { cost_usd: number | string | null }) => acc + Number(row.cost_usd ?? 0),
    0,
  );

  if (userSum > userCap) {
    return { ok: false, reason: 'user_cap_exceeded' };
  }

  return { ok: true };
}
