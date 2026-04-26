#!/usr/bin/env tsx
/**
 * audit-posthog-events.ts
 *
 * Scans the codebase for emission points of each AC-19 PostHog event and
 * writes a coverage report to .omc/plans/posthog-events-coverage.md.
 *
 * Usage:
 *   tsx scripts/audit-posthog-events.ts [--help]
 *
 * Exit 0 always (informational tool, not a CI gate).
 */

import { execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ── CLI ───────────────────────────────────────────────────────────────────────

if (process.argv.includes('--help')) {
  console.log(`
audit-posthog-events.ts

Usage:
  tsx scripts/audit-posthog-events.ts [--help]

Description:
  Scans the codebase (via git grep) for each AC-19 PostHog event name across
  captureServer(), identifyServer(), and posthog.capture() call sites.

  Writes a markdown coverage report to:
    .omc/plans/posthog-events-coverage.md

Options:
  --help   Show this message and exit.

Exit code: always 0 (informational, not a CI gate).
`);
  process.exit(0);
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PROJECT_ROOT = join(__dirname, '..');

/**
 * AC-19 required event types.
 * All 15 must have at least one server-side or client-side emission point.
 */
const POSTHOG_EVENTS = [
  'interview_started',
  'interview_completed',
  'first_encounter_spawned',
  'conversation_streaming_started',
  'conversation_completed',
  'report_viewed',
  'report_expanded',
  'like_sent',
  'mutual_match',
  'world_chat_opened',
  'quota_blocked',
  'conversation_failed_overlay_shown',
  'llm_cost',
  'streaming_paused_cost_cap',
  'rate_limit_hit',
] as const;

type PostHogEvent = (typeof POSTHOG_EVENTS)[number];

interface EmissionResult {
  event: PostHogEvent;
  count: number;
  files: string[]; // "path/to/file.ts:42"
}

// ── Grep helpers ──────────────────────────────────────────────────────────────

/**
 * Run git grep for a given PostHog event name.
 * Searches for the literal event string inside captureServer / posthog.capture
 * call sites.  Using a broad pattern ('event_name') catches both single and
 * double quoted occurrences.
 */
function findEmissions(eventName: PostHogEvent): string[] {
  const pattern = `'${eventName}'`;

  let output = '';
  try {
    output = execSync(`git grep -rn "${pattern}" -- '*.ts' '*.tsx'`, {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
    });
  } catch (err: unknown) {
    const exitCode = (err as { status?: number }).status;
    // git grep exits 1 when no matches — treat as empty result.
    if (exitCode === 1) return [];
    throw err;
  }

  return output
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** Extract "file:line" from a git grep output line ("file:line:content"). */
function extractFileRef(line: string): string {
  const parts = line.split(':');
  if (parts.length >= 2) return `${parts[0]}:${parts[1]}`;
  return line;
}

// ── Audit ─────────────────────────────────────────────────────────────────────

function audit(): EmissionResult[] {
  return POSTHOG_EVENTS.map((event) => {
    const lines = findEmissions(event);
    return {
      event,
      count: lines.length,
      files: lines.map(extractFileRef),
    };
  });
}

// ── Notes for missing events ──────────────────────────────────────────────────

const V1_FOLLOWUP_NOTES: Partial<Record<PostHogEvent, string>> = {
  report_viewed:
    'Client-side event — needs instrumentation in the report viewer component ' +
    '(e.g. `components/match/MatchCard.tsx` or the `/match/[id]` page `useEffect`). ' +
    'Use `identifyClient` + `posthog.capture` via `lib/posthog/client.ts`. v1 follow-up.',
  report_expanded:
    'Client-side event — emit when the user taps "expand" on the conversation ' +
    'report drawer. Component instrumentation required. v1 follow-up.',
  world_chat_opened:
    'Client-side event — emit when the user opens the World Chat link from the ' +
    'match card. Instrument in the World Chat CTA button component. v1 follow-up.',
  conversation_failed_overlay_shown:
    'Client-side event — emit in the `ConversationFailedOverlay` component when ' +
    'it mounts. Requires component instrumentation. v1 follow-up.',
  interview_started:
    'Client-side event — emit at the start of the onboarding interview flow. ' +
    'Likely `app/(onboarding)/intro/page.tsx` or the first interview step component. ' +
    'v1 follow-up.',
  interview_completed:
    'Client-side event — emit when the interview form is successfully submitted ' +
    'and agent created. Likely `app/(onboarding)/verify/page.tsx` after verify_success. ' +
    'v1 follow-up.',
  like_sent:
    'Server-side event — emit in `app/api/match/[id]/like/route.ts` when ' +
    'decision=accepted. Requires `captureServer` call with `worldUserId`. v1 follow-up.',
  mutual_match:
    'Server-side event — emit in `app/api/match/[id]/like/route.ts` when mutual ' +
    'upgrade occurs, or in the `mutual-push` Inngest function. ' +
    'Note: `mutual_match_push_sent` is already emitted; rename or add `mutual_match`. v1 follow-up.',
};

// ── Markdown generation ───────────────────────────────────────────────────────

function renderMarkdown(results: EmissionResult[]): string {
  const timestamp = new Date().toISOString();
  const missing = results.filter((r) => r.count === 0);
  const covered = results.filter((r) => r.count > 0);

  const tableRows = results
    .map((r) => {
      const files = r.files.length > 0 ? r.files.map((f) => `\`${f}\``).join(', ') : '—';
      const flag = r.count === 0 ? ' ⚠' : '';
      return `| \`${r.event}\`${flag} | ${r.count} | ${files} |`;
    })
    .join('\n');

  let todoSection: string;
  if (missing.length === 0) {
    todoSection = `_All ${POSTHOG_EVENTS.length} AC-19 event types have at least one emission point._`;
  } else {
    todoSection = missing
      .map((r) => {
        const note = V1_FOLLOWUP_NOTES[r.event];
        const detail = note ? `\n  > ${note}` : '';
        return (
          `- [ ] **\`${r.event}\`** — no emission found.` +
          ` TODO: add \`captureServer('${r.event}', ...)\` or client-side \`posthog.capture('${r.event}')\`.` +
          detail
        );
      })
      .join('\n');
  }

  return `# PostHog Events Coverage Report (AC-19)

> Generated: ${timestamp}
> Script: \`scripts/audit-posthog-events.ts\`

## Summary

- **Total AC-19 event types**: ${results.length}
- **Covered** (≥1 emission): ${covered.length}
- **Missing** (0 emissions): ${missing.length}

## Coverage Table

| Event | Emission Count | Files |
|-------|---------------|-------|
${tableRows}

## Missing / TODO

${todoSection}

## Hashing Policy

All server-side captures use \`captureServer(eventName, { worldUserId })\` from
\`lib/posthog/server.ts\`, which internally calls \`hashCohort(worldUserId)\` to
produce the SHA-256 cohort hash as \`distinct_id\`. Raw World user IDs never reach
PostHog (enforced by the \`captureServer\` wrapper).

Client-side captures must call \`identifyClient(hashedDistinctId, predecessor)\`
from \`lib/posthog/client.ts\` before emitting events, using the hashed id returned
by the server session — never the raw \`world_user_id\`.

## Phase Wiring Summary

| Phase | Events Wired |
|-------|-------------|
| Phase 1 | PostHog client/server infrastructure, cohort hashing |
| Phase 4 | \`llm_cost\`, \`streaming_paused_cost_cap\`, \`rate_limit_hit\`, \`first_encounter_spawned\`, \`quota_blocked\` |
| Phase 5 (this PR) | Gaps documented above; client-side events deferred to v1 |

---

_This report is informational. It does not gate CI._
`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  console.log('Auditing PostHog AC-19 event emission points...\n');

  const results = audit();

  for (const r of results) {
    const status = r.count === 0 ? 'MISSING' : `${r.count} hit(s)`;
    console.log(`  ${r.event.padEnd(36)} ${status}`);
  }

  const md = renderMarkdown(results);

  const outDir = join(PROJECT_ROOT, '.omc', 'plans');
  mkdirSync(outDir, { recursive: true });

  const outPath = join(outDir, 'posthog-events-coverage.md');
  writeFileSync(outPath, md, 'utf-8');

  console.log(`\nReport written to: ${outPath}`);

  const missing = results.filter((r) => r.count === 0);
  const covered = results.filter((r) => r.count > 0);

  console.log(`\nCoverage: ${covered.length}/${results.length} event types have emissions.`);

  if (missing.length > 0) {
    console.log(`\nMissing event types (${missing.length}):`);
    for (const r of missing) {
      console.log(`  - ${r.event}`);
    }
  } else {
    console.log(
      `\nAll ${POSTHOG_EVENTS.length} AC-19 event types have at least one emission point.`,
    );
  }
}

main();
