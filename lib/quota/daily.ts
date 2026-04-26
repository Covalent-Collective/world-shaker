import 'server-only';

import { getServiceClient } from '@/lib/supabase/service';

export const DAILY_QUOTA_MAX = 4;

/**
 * Timezone offset table (hours from UTC).
 * For unlisted timezones we default to UTC and log a warning.
 */
const TZ_OFFSETS: Record<string, number> = {
  'Asia/Seoul': 9,
  'Asia/Tokyo': 9,
  'Asia/Shanghai': 8,
  'Asia/Singapore': 8,
  'Asia/Kolkata': 5.5,
  'Europe/London': 0,
  'Europe/Berlin': 1,
  'Europe/Paris': 1,
  'America/New_York': -5,
  'America/Chicago': -6,
  'America/Denver': -7,
  'America/Los_Angeles': -8,
  UTC: 0,
};

/**
 * Resolves the UTC offset (in minutes) for a given IANA timezone string.
 * Falls back to UTC (0) with a console.warn for unknown timezones.
 */
function getOffsetMinutes(timezone: string): number {
  if (timezone in TZ_OFFSETS) {
    return TZ_OFFSETS[timezone]! * 60;
  }
  // Try Intl.DateTimeFormat to derive the offset for the current moment.
  try {
    const now = Date.now();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
    const localYear = get('year');
    const localMonth = get('month') - 1;
    const localDay = get('day');
    let localHour = get('hour');
    if (localHour === 24) localHour = 0;
    const localMinute = get('minute');
    const localSecond = get('second');
    const localAsUtc = Date.UTC(
      localYear,
      localMonth,
      localDay,
      localHour,
      localMinute,
      localSecond,
    );
    const offsetMs = localAsUtc - now;
    return Math.round(offsetMs / 60000);
  } catch {
    console.warn(`[getDailyQuota] Unknown timezone "${timezone}", defaulting to UTC.`);
    return 0;
  }
}

/**
 * Computes the start and end of the user-local calendar day (in UTC ISO strings).
 *
 * "Start" = 00:00:00 user-local → UTC
 * "End"   = 00:00:00 next user-local day → UTC  (i.e. user-local 24:00:00)
 */
function getUserDayBoundariesUtc(
  nowUtcMs: number,
  offsetMinutes: number,
): { dayStart: Date; dayEnd: Date } {
  // Convert UTC ms to user-local ms.
  const localMs = nowUtcMs + offsetMinutes * 60 * 1000;

  // Compute midnight (00:00:00) of the user-local day in "local ms".
  const localMidnightMs = localMs - (localMs % 86_400_000);

  // Convert back to UTC.
  const dayStartUtcMs = localMidnightMs - offsetMinutes * 60 * 1000;
  const dayEndUtcMs = dayStartUtcMs + 86_400_000;

  return {
    dayStart: new Date(dayStartUtcMs),
    dayEnd: new Date(dayEndUtcMs),
  };
}

export interface DailyQuota {
  used: number;
  max: number;
  nextResetAt: Date;
}

/**
 * Returns the daily quota status for a given world_user_id.
 *
 * Counts outcome_events rows with event_type='viewed' that fall within
 * the user's current local calendar day (derived from users.timezone).
 *
 * Uses the service client (bypasses RLS) — server-side admin op only.
 */
export async function getDailyQuota(world_user_id: string): Promise<DailyQuota> {
  const supabase = getServiceClient();

  // Fetch the user's timezone preference.
  const { data: userRow, error: userErr } = await supabase
    .from('users')
    .select('timezone')
    .eq('id', world_user_id)
    .single();

  if (userErr) {
    console.warn(
      `[getDailyQuota] Could not fetch user timezone for ${world_user_id}: ${userErr.message}. Defaulting to Asia/Seoul.`,
    );
  }

  const timezone: string = userRow?.timezone ?? 'Asia/Seoul';
  const offsetMinutes = getOffsetMinutes(timezone);
  const { dayStart, dayEnd } = getUserDayBoundariesUtc(Date.now(), offsetMinutes);

  // Count viewed events in the user-local day window.
  const { count, error: countErr } = await supabase
    .from('outcome_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', world_user_id)
    .eq('event_type', 'viewed')
    .gte('created_at', dayStart.toISOString())
    .lt('created_at', dayEnd.toISOString());

  if (countErr) {
    throw new Error(`[getDailyQuota] Failed to count outcome_events: ${countErr.message}`);
  }

  return {
    used: count ?? 0,
    max: DAILY_QUOTA_MAX,
    nextResetAt: dayEnd,
  };
}

export interface QuotaCheckResult {
  ok: boolean;
  reason?: 'quota_exceeded';
  used: number;
  max: number;
}

/**
 * Returns whether the user has quota remaining for today.
 * Does NOT consume quota — use this as a guard before actions that consume quota.
 */
export async function assertQuotaAvailable(world_user_id: string): Promise<QuotaCheckResult> {
  const quota = await getDailyQuota(world_user_id);
  if (quota.used >= quota.max) {
    return { ok: false, reason: 'quota_exceeded', used: quota.used, max: quota.max };
  }
  return { ok: true, used: quota.used, max: quota.max };
}
