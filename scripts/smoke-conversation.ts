#!/usr/bin/env tsx
/**
 * smoke-conversation.ts
 *
 * CLI smoke test for the full Phase 2 conversation pipeline end-to-end.
 * Triggers Inngest events, polls for completion, dumps transcripts as JSON.
 * Output is used as the Phase 2 rubric input for 2-reviewer human eval.
 *
 * REQUIREMENTS:
 *   - Real OPENROUTER_API_KEY and SUPABASE_SERVICE_ROLE_KEY env vars set
 *   - NEXT_PUBLIC_SUPABASE_URL env var set
 *   - INNGEST_BASE_URL env var set (default: http://localhost:8288)
 *   - All migrations applied (through Phase 4 seed pool migration 0007)
 *   - Seed agent pool populated (is_seed=true rows in agents table)
 *
 * Usage:
 *   tsx scripts/smoke-conversation.ts [--pairs <N>] [--out <dir>] [--help]
 *
 * Flags:
 *   --pairs <N>   Number of agent pairs to test (default: 10)
 *   --out <dir>   Output directory for JSON dumps (default: /tmp)
 *   --help        Print this usage message and exit 0
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AgentRow {
  id: string;
  user_id: string;
}

interface ConversationRow {
  id: string;
  status: string;
}

interface ConversationTurnRow {
  id: number;
  conversation_id: string;
  turn_index: number;
  speaker_agent_id: string;
  text: string;
  moderation_status: string;
  token_count: number | null;
  created_at: string;
}

interface MatchRow {
  id: string;
  user_id: string;
  candidate_user_id: string;
  conversation_id: string | null;
  compatibility_score: number;
  why_click: string | null;
  watch_out: string | null;
  highlight_quotes: Array<{ speaker: 'A' | 'B'; text: string }>;
  rendered_transcript: Array<{ speaker: 'A' | 'B'; text: string }>;
  status: string;
  created_at: string;
}

interface SmokeResult {
  pair_key: string;
  conversation_id: string;
  turns: ConversationTurnRow[];
  match: MatchRow | null;
  duration_ms: number;
}

// ── CLI flags ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

const HELP_TEXT = `
smoke-conversation — Phase 2 end-to-end conversation pipeline smoke test

USAGE
  tsx scripts/smoke-conversation.ts [--pairs <N>] [--out <dir>] [--help]

FLAGS
  --pairs <N>   Number of agent pairs to exercise (default: 10)
  --out <dir>   Directory for JSON transcript dumps (default: /tmp)
  --help        Print this usage message and exit 0

OUTPUT
  Per-pair JSON at <out>/smoke-<pair_key>.json:
    { pair_key, conversation_id, turns, match, duration_ms }
  Summary line at end: N pairs attempted, M completed, K timed out.

REQUIREMENTS
  - OPENROUTER_API_KEY, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL
  - INNGEST_BASE_URL (default: http://localhost:8288)
  - Migration 0007 applied (Phase 4 seed pool)
  - Seed agents populated (is_seed=true in agents table)

NOTES
  Polls every 5s, max 5 minutes per pair.
  Waits additional 30s after completion for generate-report to fire.
  This output is the Phase 2 rubric input for the 2-reviewer human eval.
`.trimStart();

if (args.includes('--help')) {
  process.stdout.write(HELP_TEXT);
  process.exit(0);
}

function getFlag(flag: string, defaultValue: string): string {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return defaultValue;
}

const pairsArg = parseInt(getFlag('--pairs', '10'), 10);
const N = isNaN(pairsArg) || pairsArg < 1 ? 10 : pairsArg;
const outDir = getFlag('--out', '/tmp');

// ── Env validation ────────────────────────────────────────────────────────────

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const INNGEST_BASE_URL = process.env.INNGEST_BASE_URL ?? 'http://localhost:8288';

if (!OPENROUTER_API_KEY) {
  console.error('ERROR: OPENROUTER_API_KEY is not set. Exiting.');
  process.exit(2);
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY is not set. Exiting.');
  process.exit(2);
}

if (!SUPABASE_URL) {
  console.error('ERROR: NEXT_PUBLIC_SUPABASE_URL is not set. Exiting.');
  process.exit(2);
}

// ── Supabase client (service role) ────────────────────────────────────────────

// Dynamic import to avoid pulling server-only into the --help path.
// We import after env validation so missing keys are reported cleanly.
async function getDb() {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── Inngest event sender ──────────────────────────────────────────────────────

interface InngestEventPayload {
  name: string;
  data: Record<string, unknown>;
}

async function sendInngestEvent(event: InngestEventPayload): Promise<void> {
  const url = `${INNGEST_BASE_URL}/e/${encodeURIComponent(event.name)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event.data),
    });
  } catch (err) {
    console.error(`ERROR: Inngest server unreachable at ${INNGEST_BASE_URL}.`);
    console.error(`       Cause: ${String(err)}`);
    console.error(`       Start Inngest dev server: npm run inngest:dev`);
    process.exit(2);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`ERROR: Inngest returned HTTP ${res.status}: ${body}`);
    process.exit(2);
  }
}

// ── Poll helpers ──────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 5_000;
const POLL_MAX_MS = 5 * 60 * 1_000; // 5 minutes
const REPORT_WAIT_MS = 30_000; // wait for generate-report after completion

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollConversationCompletion(
  db: Awaited<ReturnType<typeof getDb>>,
  pairKey: string,
): Promise<string | null> {
  const deadline = Date.now() + POLL_MAX_MS;
  while (Date.now() < deadline) {
    const { data, error } = await db
      .from('conversations')
      .select('id, status')
      .eq('surface', 'dating')
      .eq('pair_key', pairKey)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<ConversationRow>();

    if (error) {
      console.error(`  WARN poll error for ${pairKey}:`, error.message);
    } else if (data?.status === 'completed') {
      return data.id;
    }

    await sleep(POLL_INTERVAL_MS);
  }
  return null; // timed out
}

async function fetchTurns(
  db: Awaited<ReturnType<typeof getDb>>,
  conversationId: string,
): Promise<ConversationTurnRow[]> {
  const { data, error } = await db
    .from('conversation_turns')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('turn_index', { ascending: true });

  if (error) {
    console.error(`  WARN could not fetch turns for ${conversationId}:`, error.message);
    return [];
  }
  return (data ?? []) as ConversationTurnRow[];
}

async function fetchMatch(
  db: Awaited<ReturnType<typeof getDb>>,
  conversationId: string,
): Promise<MatchRow | null> {
  const { data, error } = await db
    .from('matches')
    .select('*')
    .eq('conversation_id', conversationId)
    .maybeSingle<MatchRow>();

  if (error) {
    console.error(`  WARN could not fetch match for ${conversationId}:`, error.message);
    return null;
  }
  return data ?? null;
}

// ── Pair key computation ──────────────────────────────────────────────────────

function computePairKey(aId: string, bId: string): string {
  return aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`smoke-conversation: pairs=${N}, out=${outDir}`);
  console.log();

  // Ensure output directory exists.
  mkdirSync(outDir, { recursive: true });

  const db = await getDb();

  // Check seed agent count first.
  const { count: seedCount, error: countErr } = await db
    .from('agents')
    .select('id', { count: 'exact', head: true })
    .eq('is_seed', true);

  if (countErr) {
    console.error('ERROR: Failed to query agents table:', countErr.message);
    process.exit(2);
  }

  const needed = 2 * N;
  if ((seedCount ?? 0) < needed) {
    console.error(
      `ERROR: Not enough seed agents. Found ${seedCount ?? 0}, need ${needed} (2 × --pairs ${N}).`,
    );
    console.error(
      `       Apply migration 0007 and populate the seed pool before running this script.`,
    );
    console.error(`       See Phase 4 seed pool setup in the plan.`);
    process.exit(2);
  }

  // Select 2*N seed agents.
  const { data: seedAgents, error: agentsErr } = await db
    .from('agents')
    .select('id, user_id')
    .eq('is_seed', true)
    .limit(needed);

  if (agentsErr || !seedAgents) {
    console.error('ERROR: Failed to fetch seed agents:', agentsErr?.message ?? 'no data');
    process.exit(2);
  }

  const agents = seedAgents as AgentRow[];
  console.log(`Fetched ${agents.length} seed agents. Forming ${N} pairs.`);
  console.log();

  // Verify Inngest reachability before starting pairs.
  try {
    const healthRes = await fetch(`${INNGEST_BASE_URL}/health`, { method: 'GET' });
    if (!healthRes.ok) {
      throw new Error(`HTTP ${healthRes.status}`);
    }
  } catch (err) {
    console.error(`ERROR: Inngest server unreachable at ${INNGEST_BASE_URL}.`);
    console.error(`       Cause: ${String(err)}`);
    console.error(`       Start Inngest dev server: npm run inngest:dev`);
    process.exit(2);
  }

  const results: SmokeResult[] = [];
  let completedCount = 0;
  let timedOutCount = 0;

  for (let i = 0; i < N; i++) {
    const a = agents[2 * i];
    const b = agents[2 * i + 1];
    const pairKey = computePairKey(a.id, b.id);

    console.log(`[${i + 1}/${N}] pair_key=${pairKey}`);
    const startMs = Date.now();

    // Send conversation/start event.
    await sendInngestEvent({
      name: 'conversation/start',
      data: {
        user_id: a.user_id,
        surface: 'dating',
        agent_a_id: a.id,
        agent_b_id: b.id,
        pair_key: pairKey,
        language: 'ko',
      },
    });
    console.log(`  Sent conversation/start`);

    // Poll for completion (up to 5 min).
    const conversationId = await pollConversationCompletion(db, pairKey);

    if (!conversationId) {
      timedOutCount++;
      console.log(`  TIMEOUT after 5 minutes`);
      console.log();
      continue;
    }

    console.log(`  Completed: conversation_id=${conversationId}`);

    // Wait 30s for generate-report to fire.
    console.log(`  Waiting 30s for generate-report...`);
    await sleep(REPORT_WAIT_MS);

    // Fetch turns and match.
    const turns = await fetchTurns(db, conversationId);
    const match = await fetchMatch(db, conversationId);

    const durationMs = Date.now() - startMs;
    const result: SmokeResult = {
      pair_key: pairKey,
      conversation_id: conversationId,
      turns,
      match,
      duration_ms: durationMs,
    };

    results.push(result);
    completedCount++;

    // Dump per-pair JSON.
    const outPath = join(outDir, `smoke-${pairKey.replace(/\|/g, '_')}.json`);
    writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`  Dumped: ${outPath}`);
    console.log(`  Turns: ${turns.length}, Match: ${match ? match.id : 'none'}`);
    console.log();
  }

  // Summary.
  console.log('─'.repeat(60));
  console.log(`Summary:`);
  console.log(`  Pairs attempted : ${N}`);
  console.log(`  Completed       : ${completedCount}`);
  console.log(`  Timed out       : ${timedOutCount}`);
  console.log(`  Dump directory  : ${outDir}`);
  console.log('─'.repeat(60));
}

main().catch((err: unknown) => {
  console.error('smoke-conversation fatal:', err);
  process.exit(1);
});
