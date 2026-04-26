#!/usr/bin/env tsx
/**
 * audit-outcome-events.ts
 *
 * Scans the codebase for emission points of each outcome_event_type enum value
 * and writes a coverage report to .omc/plans/outcome-events-coverage.md.
 *
 * Usage:
 *   tsx scripts/audit-outcome-events.ts [--help]
 *
 * Exit 0 always (informational tool, not a gate).
 */

import { execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ── CLI ───────────────────────────────────────────────────────────────────────

if (process.argv.includes('--help')) {
  console.log(`
audit-outcome-events.ts

Usage:
  tsx scripts/audit-outcome-events.ts [--help]

Description:
  Scans the codebase (via git grep) for every insertion of each
  outcome_event_type enum value into the outcome_events table.

  Writes a markdown coverage report to:
    .omc/plans/outcome-events-coverage.md

Options:
  --help   Show this message and exit.

Exit code: always 0 (informational, not a CI gate).
`);
  process.exit(0);
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PROJECT_ROOT = join(__dirname, '..');

const OUTCOME_TYPES = [
  'viewed',
  'accepted',
  'skipped',
  'mutual',
  'chat_opened',
  'replied_24h',
  'met_confirmed',
  'safety_yes',
  'safety_mixed',
  'safety_no',
  'wont_connect',
  'vouched',
  'report_filed',
] as const;

type OutcomeType = (typeof OUTCOME_TYPES)[number];

interface EmissionResult {
  type: OutcomeType;
  count: number;
  files: string[]; // "path/to/file.ts:42"
}

// ── Grep helpers ──────────────────────────────────────────────────────────────

/**
 * Run git grep to find lines containing `event_type: '<type>'` or
 * `event_type:'<type>'` inside outcome_events insert/upsert contexts.
 * Falls back to a plain string search so test files are also included.
 */
function findEmissions(eventType: OutcomeType): string[] {
  // Match both quoted styles:  event_type: 'viewed'  and  event_type:'viewed'
  const pattern = `event_type[: ]*'${eventType}'`;

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
  return OUTCOME_TYPES.map((type) => {
    const lines = findEmissions(type);
    return {
      type,
      count: lines.length,
      files: lines.map(extractFileRef),
    };
  });
}

// ── Markdown generation ───────────────────────────────────────────────────────

function renderMarkdown(results: EmissionResult[]): string {
  const timestamp = new Date().toISOString();
  const missing = results.filter((r) => r.count === 0);
  const covered = results.filter((r) => r.count > 0);

  const tableRows = results
    .map((r) => {
      const files = r.files.length > 0 ? r.files.map((f) => `\`${f}\``).join(', ') : '—';
      const flag = r.count === 0 ? ' ⚠' : '';
      return `| \`${r.type}\`${flag} | ${r.count} | ${files} |`;
    })
    .join('\n');

  const todoSection =
    missing.length === 0
      ? '_All 13 event types have at least one emission point._'
      : missing
          .map(
            (r) =>
              `- [ ] **\`${r.type}\`** — no emission found.` +
              ` TODO: add an INSERT into \`outcome_events\` with \`event_type = '${r.type}'\`.`,
          )
          .join('\n');

  return `# Outcome Events Coverage Report

> Generated: ${timestamp}
> Script: \`scripts/audit-outcome-events.ts\`

## Summary

- **Total event types**: ${results.length}
- **Covered** (≥1 emission): ${covered.length}
- **Missing** (0 emissions): ${missing.length}

## Coverage Table

| Event Type | Emission Count | Files |
|------------|---------------|-------|
${tableRows}

## Missing / TODO

${todoSection}

---

_This report is informational. It does not gate CI._
`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  console.log('Auditing outcome_events emission points...');

  const results = audit();

  for (const r of results) {
    const status = r.count === 0 ? 'MISSING' : `${r.count} hit(s)`;
    console.log(`  ${r.type.padEnd(16)} ${status}`);
  }

  const md = renderMarkdown(results);

  const outDir = join(PROJECT_ROOT, '.omc', 'plans');
  mkdirSync(outDir, { recursive: true });

  const outPath = join(outDir, 'outcome-events-coverage.md');
  writeFileSync(outPath, md, 'utf-8');

  console.log(`\nReport written to: ${outPath}`);

  const missing = results.filter((r) => r.count === 0);
  if (missing.length > 0) {
    console.log(`\nMissing event types (${missing.length}):`);
    for (const r of missing) {
      console.log(`  - ${r.type}`);
    }
  } else {
    console.log('\nAll 13 event types have at least one emission point.');
  }
}

main();
