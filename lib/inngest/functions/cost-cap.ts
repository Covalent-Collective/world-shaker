import { inngest } from '../client';
import { getServiceClient } from '@/lib/supabase/service';
import { getPostHogServer } from '@/lib/posthog/server';

/**
 * Cost-cap backstop (US-408).
 *
 * Two cron schedules:
 *   - Settlement '1 0 * * *' (00:01 UTC nightly): Sum yesterday's
 *     llm_budget_ledger; if under cap, reset app_settings.streaming_paused=false
 *     so the new day starts unblocked.
 *   - Alert '0 4,8,12,16,20 * * *' (every 4h): Sum the current UTC day's
 *     ledger; if >80% of cost_cap_usd_daily, fire PostHog alert and POST to
 *     SLACK_WEBHOOK_URL when configured.
 */

export interface LedgerSpendRow {
  cost_usd: number | string | null;
}

/** Aggregate llm_budget_ledger.cost_usd within [start, end). */
export async function aggregateLedgerSpend(
  client: ReturnType<typeof getServiceClient>,
  startIso: string,
  endIso: string,
): Promise<number> {
  const { data, error } = await client
    .from('llm_budget_ledger')
    .select('cost_usd')
    .gte('occurred_at', startIso)
    .lt('occurred_at', endIso);
  if (error) throw new Error(`aggregateLedgerSpend failed: ${error.message}`);
  return ((data ?? []) as LedgerSpendRow[]).reduce(
    (acc, row) => acc + Number(row.cost_usd ?? 0),
    0,
  );
}

function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export const costCapSettlement = inngest.createFunction(
  {
    id: 'cost-cap-settlement',
    name: 'Cost-Cap Daily Settlement',
    triggers: [{ cron: '1 0 * * *' }], // 00:01 UTC daily
  },
  async ({ step, logger }) => {
    const supabase = getServiceClient();

    const settings = await step.run('load-settings', async () => {
      const { data, error } = await supabase
        .from('app_settings')
        .select('cost_cap_usd_daily, streaming_paused')
        .eq('id', 1)
        .maybeSingle();
      if (error) throw new Error(`app_settings load failed: ${error.message}`);
      if (!data) throw new Error('app_settings row missing');
      return data as { cost_cap_usd_daily: string | number; streaming_paused: boolean };
    });

    const now = new Date();
    const todayStart = utcDayStart(now);
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);

    const yesterdaySpend = await step.run('aggregate-yesterday', async () =>
      aggregateLedgerSpend(supabase, yesterdayStart.toISOString(), todayStart.toISOString()),
    );

    const cap = Number(settings.cost_cap_usd_daily ?? 0);
    const underCap = yesterdaySpend <= cap;

    if (underCap && settings.streaming_paused) {
      await step.run('reset-paused', async () => {
        const { error } = await supabase
          .from('app_settings')
          .update({ streaming_paused: false })
          .eq('id', 1);
        if (error) throw new Error(`reset streaming_paused failed: ${error.message}`);
      });
      logger.info(
        `[cost-cap-settlement] yesterday_spend=${yesterdaySpend} cap=${cap} flag_reset=true`,
      );
    } else {
      logger.info(
        `[cost-cap-settlement] yesterday_spend=${yesterdaySpend} cap=${cap} flag_reset=false`,
      );
    }

    return { yesterday_spend: yesterdaySpend, cap, under_cap: underCap };
  },
);

export const costCapAlert = inngest.createFunction(
  {
    id: 'cost-cap-alert',
    name: 'Cost-Cap 80% Alert',
    triggers: [{ cron: '0 4,8,12,16,20 * * *' }], // every 4h offset
  },
  async ({ step, logger }) => {
    const supabase = getServiceClient();

    const settings = await step.run('load-settings', async () => {
      const { data, error } = await supabase
        .from('app_settings')
        .select('cost_cap_usd_daily')
        .eq('id', 1)
        .maybeSingle();
      if (error) throw new Error(`app_settings load failed: ${error.message}`);
      if (!data) throw new Error('app_settings row missing');
      return data as { cost_cap_usd_daily: string | number };
    });

    const cap = Number(settings.cost_cap_usd_daily ?? 0);
    if (cap <= 0) {
      logger.warn('[cost-cap-alert] cost_cap_usd_daily is 0 — skipping');
      return { spend: 0, cap, percent: 0, fired: false };
    }

    const now = new Date();
    const todayStart = utcDayStart(now);
    const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    const todaySpend = await step.run('aggregate-today', async () =>
      aggregateLedgerSpend(supabase, todayStart.toISOString(), tomorrowStart.toISOString()),
    );

    const percent = todaySpend / cap;

    if (percent <= 0.8) {
      logger.info(
        `[cost-cap-alert] spend=${todaySpend} cap=${cap} percent=${(percent * 100).toFixed(1)}%`,
      );
      return { spend: todaySpend, cap, percent, fired: false };
    }

    // Fire PostHog alert.
    await step.run('posthog-alert', async () => {
      const ph = getPostHogServer();
      if (!ph) return;
      ph.capture({
        distinctId: 'system:cost-cap-alert',
        event: 'cost_cap_warning_80pct',
        properties: { spend: todaySpend, cap, percent },
      });
      await ph.flush();
    });

    // Post to Slack if configured.
    const slackUrl = process.env.SLACK_WEBHOOK_URL;
    if (slackUrl) {
      await step.run('slack-alert', async () => {
        try {
          await fetch(slackUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              text: `World Shaker cost cap warning: ${(percent * 100).toFixed(1)}% of daily budget consumed ($${todaySpend.toFixed(2)} / $${cap.toFixed(2)}).`,
            }),
          });
        } catch (err) {
          // Webhook failure must not crash the cron.
          logger.warn(
            `[cost-cap-alert] Slack webhook failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      });
    }

    logger.warn(
      `[cost-cap-alert] WARNING spend=${todaySpend} cap=${cap} percent=${(percent * 100).toFixed(1)}%`,
    );
    return { spend: todaySpend, cap, percent, fired: true };
  },
);
