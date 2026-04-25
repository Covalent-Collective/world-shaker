#!/usr/bin/env tsx
/**
 * eval-safety.ts
 *
 * Safety classifier evaluation scaffold (Phase 1 stub).
 * Corpus and lib/llm/safety.ts are Phase 2 deliverables.
 *
 * Usage:
 *   tsx scripts/eval-safety.ts [--strict] [--help]
 *
 * Flags:
 *   --help    Print this usage message and exit 0.
 *   --strict  Gate failures (NSFW recall < 0.95 or FP > 5%) cause exit 1.
 *             Default: exit 0 with WARN prefix.
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

// ── Types ────────────────────────────────────────────────────────────────────

type Label = 'clean' | 'nsfw' | 'hostile' | 'repeat';
type Lang = 'ko' | 'en';

interface CorpusRow {
  turn_id: string;
  lang: Lang;
  text: string;
  label: Label;
}

interface ClassMetrics {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

interface EvalResult {
  label: Label;
  precision: number;
  recall: number;
  fpRate: number;
}

// ── Safety module shape (Phase 2 contract) ───────────────────────────────────

interface SafetyModule {
  detectNSFW: (text: string) => Promise<boolean> | boolean;
  detectHostileTone: (text: string) => Promise<boolean> | boolean;
  detectRepeatLoop: (text: string) => Promise<boolean> | boolean;
}

// ── CLI flags ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--help')) {
  console.log(`
eval-safety.ts — Safety classifier evaluation scaffold

Usage:
  tsx scripts/eval-safety.ts [--strict] [--help]

Flags:
  --help    Print this usage message and exit 0.
  --strict  Gate failures cause exit 1 (default: exit 0 with WARN).

Corpus:
  .omc/plans/safety-eval-corpus.jsonl
  Each line: { turn_id, lang, text, label }
  Labels: clean | nsfw | hostile | repeat

Gates:
  NSFW recall  >= 0.95
  NSFW FP rate <= 0.05

Phase notes:
  Corpus authoring: Phase 2 (Step 2.9).
  lib/llm/safety.ts: Phase 2 deliverable.
`);
  process.exit(0);
}

const strictMode = args.includes('--strict');

// ── Paths ────────────────────────────────────────────────────────────────────

const ROOT = resolve(process.cwd());
const CORPUS_PATH = resolve(ROOT, '.omc/plans/safety-eval-corpus.jsonl');
const SAFETY_PATH = resolve(ROOT, 'lib/llm/safety.ts');

// ── Guard: corpus missing ────────────────────────────────────────────────────

if (!existsSync(CORPUS_PATH)) {
  console.log(
    'Safety eval corpus not yet authored. ' +
      'Expected at .omc/plans/safety-eval-corpus.jsonl. ' +
      'See plan v4 Step 1.14 + 2.9 (deferred to Phase 2).',
  );
  process.exit(0);
}

// ── Guard: safety module missing ─────────────────────────────────────────────

if (!existsSync(SAFETY_PATH)) {
  console.log('lib/llm/safety.ts not yet implemented (Phase 2 deliverable). Skipping evaluation.');
  process.exit(0);
}

// ── Main evaluation (runs only when both corpus and safety.ts exist) ──────────

async function main(): Promise<void> {
  // 1. Parse corpus
  const lines = readFileSync(CORPUS_PATH, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0);

  const corpus: CorpusRow[] = lines.map((line, idx) => {
    try {
      return JSON.parse(line) as CorpusRow;
    } catch {
      throw new Error(`Corpus parse error at line ${idx + 1}: ${line}`);
    }
  });

  // 2. Deterministic 70/30 split (sort by turn_id, take last 30%)
  const sorted = [...corpus].sort((a, b) => a.turn_id.localeCompare(b.turn_id));
  const holdoutStart = Math.floor(sorted.length * 0.7);
  const holdout = sorted.slice(holdoutStart);

  console.log(`Corpus: ${corpus.length} rows  |  Holdout: ${holdout.length} rows\n`);

  // 3. Load safety module (dynamic import guarded above by existsSync).
  // Use a runtime-computed path so tsc does not attempt static module resolution
  // on a file that does not exist until Phase 2.
  const safetyModulePath = resolve(ROOT, 'lib/llm/safety.ts');
  let safety: SafetyModule;
  try {
    safety = (await import(safetyModulePath)) as SafetyModule;
  } catch {
    console.log(
      'lib/llm/safety.ts not yet implemented (Phase 2 deliverable). Skipping evaluation.',
    );
    process.exit(0);
  }

  // 4. Run predictions
  const labels: Label[] = ['clean', 'nsfw', 'hostile', 'repeat'];
  const metrics: Record<Label, ClassMetrics> = {
    clean: { tp: 0, fp: 0, fn: 0, tn: 0 },
    nsfw: { tp: 0, fp: 0, fn: 0, tn: 0 },
    hostile: { tp: 0, fp: 0, fn: 0, tn: 0 },
    repeat: { tp: 0, fp: 0, fn: 0, tn: 0 },
  };

  for (const row of holdout) {
    const isNSFW = await Promise.resolve(safety.detectNSFW(row.text));
    const isHostile = await Promise.resolve(safety.detectHostileTone(row.text));
    const isRepeat = await Promise.resolve(safety.detectRepeatLoop(row.text));

    const predicted: Label = isNSFW
      ? 'nsfw'
      : isHostile
        ? 'hostile'
        : isRepeat
          ? 'repeat'
          : 'clean';

    for (const cls of labels) {
      const actual = row.label === cls;
      const pred = predicted === cls;
      if (actual && pred) metrics[cls].tp++;
      else if (!actual && pred) metrics[cls].fp++;
      else if (actual && !pred) metrics[cls].fn++;
      else metrics[cls].tn++;
    }
  }

  // 5. Compute per-class metrics
  const results: EvalResult[] = labels.map((cls) => {
    const m = metrics[cls];
    const precision = m.tp + m.fp > 0 ? m.tp / (m.tp + m.fp) : 0;
    const recall = m.tp + m.fn > 0 ? m.tp / (m.tp + m.fn) : 0;
    const fpRate = m.fp + m.tn > 0 ? m.fp / (m.fp + m.tn) : 0;
    return { label: cls, precision, recall, fpRate };
  });

  // 6. Print markdown table
  const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

  console.log('## Safety Eval Results\n');
  console.log('| Label   | Precision | Recall | FP Rate |');
  console.log('|---------|-----------|--------|---------|');
  for (const r of results) {
    console.log(
      `| ${r.label.padEnd(7)} | ${pct(r.precision).padStart(9)} | ${pct(r.recall).padStart(6)} | ${pct(r.fpRate).padStart(7)} |`,
    );
  }
  console.log();

  // 7. Gate checks
  const nsfwResult = results.find((r) => r.label === 'nsfw')!;
  let gateFailed = false;

  if (nsfwResult.recall < 0.95) {
    const msg = `WARN  NSFW recall ${pct(nsfwResult.recall)} < 95% gate (Phase 2 must fix this before production)`;
    console.log(msg);
    gateFailed = true;
  }

  if (nsfwResult.fpRate > 0.05) {
    const msg = `WARN  NSFW FP rate ${pct(nsfwResult.fpRate)} > 5% gate (Phase 2 must fix this before production)`;
    console.log(msg);
    gateFailed = true;
  }

  if (!gateFailed) {
    console.log('All gates passed.');
  }

  if (strictMode && gateFailed) {
    console.log('\n--strict: exiting 1 due to gate failure(s).');
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('eval-safety fatal:', err);
  process.exit(1);
});
