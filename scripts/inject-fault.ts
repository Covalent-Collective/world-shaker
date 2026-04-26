#!/usr/bin/env tsx
/**
 * inject-fault.ts
 *
 * QA harness: manually injects a failure mode into a live conversation.
 * Updates conversation status='failed', inserts a synthetic outcome_event,
 * and sends an Inngest 'conversation.failed' event so the SSE route emits
 * the failure to connected clients (triggering FailureOverlay / LiveTranscript).
 *
 * v0 TESTING TOOL ONLY — DO NOT RUN IN PRODUCTION.
 * - Uses SUPABASE_SERVICE_ROLE_KEY (bypasses RLS). No ws_session JWT check.
 * - Operator / QA use only. Production safety relies on service-role key scope.
 * - ws_session check NOT included by design (service-role-equivalent operator use).
 *
 * Usage:
 *   tsx scripts/inject-fault.ts --conversation-id=<uuid> --mode=<timeout|nsfw|hostile|repeat>
 *
 * Flags:
 *   --conversation-id=<uuid>   Target conversation UUID (must have status='live')
 *   --mode=<timeout|nsfw|hostile|repeat>  Failure mode to inject
 *   --help                     Print this usage message and exit 0
 *
 * Required env vars:
 *   SUPABASE_SERVICE_ROLE_KEY   Service-role key (bypasses RLS)
 *   NEXT_PUBLIC_SUPABASE_URL    Supabase project URL
 *
 * Optional env vars:
 *   INNGEST_BASE_URL   Inngest dev server (default: http://localhost:8288)
 */

// ── Types ─────────────────────────────────────────────────────────────────────

type FaultMode = 'timeout' | 'nsfw' | 'hostile' | 'repeat';

const FAULT_REASONS: Record<FaultMode, string> = {
  timeout: 'timeout_inject',
  nsfw: 'nsfw_inject',
  hostile: 'hostile_inject',
  repeat: 'repeat_loop_inject',
};

// ── Help text ─────────────────────────────────────────────────────────────────

const HELP_TEXT = `
inject-fault — QA harness: inject a failure mode into a live conversation

v0 TESTING TOOL ONLY. DO NOT RUN IN PRODUCTION.

USAGE
  tsx scripts/inject-fault.ts --conversation-id=<uuid> --mode=<mode> [--help]

FLAGS
  --conversation-id=<uuid>            Target conversation (must be status='live')
  --mode=<timeout|nsfw|hostile|repeat>  Failure mode to inject
  --help                              Print this usage message and exit 0

MODES
  timeout   Simulates a conversation timeout        (reason: timeout_inject)
  nsfw      Simulates NSFW content detection        (reason: nsfw_inject)
  hostile   Simulates hostile tone detection        (reason: hostile_inject)
  repeat    Simulates repeat-loop detection         (reason: repeat_loop_inject)

ACTIONS (per mode)
  1. UPDATE conversations SET status='failed' WHERE id=<uuid> AND status='live'
  2. INSERT outcome_events with event_type='wont_connect' and metadata.reason=<reason>
  3. POST Inngest event 'conversation.failed' { conversation_id, reason }

REQUIRED ENV VARS
  SUPABASE_SERVICE_ROLE_KEY   Service-role Supabase key (bypasses RLS)
  NEXT_PUBLIC_SUPABASE_URL    Supabase project URL

OPTIONAL ENV VARS
  INNGEST_BASE_URL   Inngest dev server URL (default: http://localhost:8288)

NOTES
  - Conversation must exist with status='live' or the command exits 2.
  - No ws_session check: this is for operator/QA use with service-role access.
  - The Inngest event triggers the SSE route to emit 'failed' to connected clients,
    which causes FailureOverlay and LiveTranscript to render the failure UI.
`.trimStart();

// ── CLI arg parsing ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(HELP_TEXT);
  process.exit(0);
}

function getFlagValue(prefix: string): string | undefined {
  const arg = args.find((a) => a.startsWith(prefix));
  if (!arg) return undefined;
  const value = arg.slice(prefix.length);
  return value.length > 0 ? value : undefined;
}

const conversationId = getFlagValue('--conversation-id=');
const modeRaw = getFlagValue('--mode=');

if (!conversationId) {
  console.error('ERROR: --conversation-id=<uuid> is required.');
  console.error('       Run with --help for usage.');
  process.exit(2);
}

if (!modeRaw) {
  console.error('ERROR: --mode=<timeout|nsfw|hostile|repeat> is required.');
  console.error('       Run with --help for usage.');
  process.exit(2);
}

const VALID_MODES: FaultMode[] = ['timeout', 'nsfw', 'hostile', 'repeat'];

if (!VALID_MODES.includes(modeRaw as FaultMode)) {
  console.error(`ERROR: Invalid mode "${modeRaw}". Must be one of: ${VALID_MODES.join(', ')}.`);
  process.exit(2);
}

const mode = modeRaw as FaultMode;
const reason = FAULT_REASONS[mode];

// ── Env validation ────────────────────────────────────────────────────────────

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const INNGEST_BASE_URL = process.env.INNGEST_BASE_URL ?? 'http://localhost:8288';

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY is not set.');
  console.error('       This script requires service-role access to bypass RLS.');
  console.error('       Set the env var and re-run.');
  process.exit(2);
}

if (!SUPABASE_URL) {
  console.error('ERROR: NEXT_PUBLIC_SUPABASE_URL is not set.');
  console.error('       Set the env var and re-run.');
  process.exit(2);
}

// ── Supabase client ───────────────────────────────────────────────────────────
// Dynamic import after env validation so missing keys are reported cleanly
// before any module resolution occurs.

async function getDb() {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── Inngest event sender ──────────────────────────────────────────────────────

async function sendInngestEvent(name: string, data: Record<string, unknown>): Promise<void> {
  const url = `${INNGEST_BASE_URL}/e/${encodeURIComponent(name)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch (err) {
    console.error(`WARN: Inngest server unreachable at ${INNGEST_BASE_URL}.`);
    console.error(`      Cause: ${String(err)}`);
    console.error(`      Start Inngest dev server: npm run inngest:dev`);
    console.error(`      Continuing without emitting Inngest event (DB changes already applied).`);
    return;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`WARN: Inngest returned HTTP ${res.status}: ${body}`);
    console.error(`      DB changes already applied; Inngest event was not delivered.`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`inject-fault: conversation_id=${conversationId} mode=${mode} reason=${reason}`);
  console.log();

  const db = await getDb();

  // Step 1: Validate the conversation exists and is live.
  console.log('Step 1/3  Validating conversation...');
  const { data: conv, error: lookupErr } = await db
    .from('conversations')
    .select('id, status, user_id')
    .eq('id', conversationId)
    .maybeSingle<{ id: string; status: string; user_id: string }>();

  if (lookupErr) {
    console.error(`ERROR: Failed to fetch conversation: ${lookupErr.message}`);
    process.exit(2);
  }

  if (!conv) {
    console.error(`ERROR: Conversation not found: ${conversationId}`);
    process.exit(2);
  }

  if (conv.status !== 'live') {
    console.error(
      `ERROR: Conversation ${conversationId} has status='${conv.status}', expected 'live'.`,
    );
    console.error(`       inject-fault only operates on live conversations.`);
    process.exit(2);
  }

  console.log(`         Found conversation status='live' user_id=${conv.user_id}`);
  console.log();

  // Step 2: UPDATE status='failed' WHERE status='live' (atomic guard).
  console.log('Step 2/3  Marking conversation failed...');
  const { error: updateErr } = await db
    .from('conversations')
    .update({ status: 'failed' })
    .eq('id', conversationId)
    .eq('status', 'live');

  if (updateErr) {
    console.error(`ERROR: Failed to update conversation status: ${updateErr.message}`);
    process.exit(2);
  }

  // INSERT synthetic outcome_event with the injection reason.
  const { error: insertErr } = await db.from('outcome_events').insert({
    user_id: conv.user_id,
    event_type: 'wont_connect',
    source_screen: 'inject-fault',
    metadata: {
      reason,
      conversation_id: conversationId,
      mode,
      injected_by: 'inject-fault.ts',
      injected_at: new Date().toISOString(),
    },
  });

  if (insertErr) {
    console.error(`WARN: outcome_events INSERT failed: ${insertErr.message}`);
    console.error(`      Conversation status was already set to 'failed'. Continuing.`);
  } else {
    console.log(`         outcome_events INSERT ok  reason=${reason}`);
  }
  console.log();

  // Step 3: Send Inngest 'conversation.failed' event so the SSE route emits
  // the failure to connected clients (triggers FailureOverlay / LiveTranscript).
  console.log('Step 3/3  Sending Inngest conversation.failed event...');
  await sendInngestEvent('conversation.failed', {
    conversation_id: conversationId,
    reason,
  });
  console.log(`         Inngest event sent  conversation.failed`);
  console.log();

  console.log('─'.repeat(60));
  console.log('inject-fault complete.');
  console.log(`  conversation_id : ${conversationId}`);
  console.log(`  mode            : ${mode}`);
  console.log(`  reason          : ${reason}`);
  console.log(`  new status      : failed`);
  console.log('─'.repeat(60));
}

main().catch((err: unknown) => {
  console.error('inject-fault fatal:', err);
  process.exit(1);
});
