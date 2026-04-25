/**
 * calibrate-match-weights.ts
 *
 * Calibrates cosine vs. structured-feature weights for the agent matching score
 * by running a grid search over a hand-curated eval set and reporting Spearman
 * rank correlations.
 *
 * Usage:
 *   tsx scripts/calibrate-match-weights.ts [--apply] [--help]
 *
 * Eval set expected at: .omc/plans/match-eval-set.jsonl
 * Each JSONL line:
 *   {
 *     pair_id: string,
 *     agent_a: AgentFeatures,
 *     agent_b: AgentFeatures,
 *     embedding_a: number[],
 *     embedding_b: number[],
 *     human_score: 1 | 2 | 3 | 4 | 5
 *   }
 *
 * See plan v4 Step 1.13 (US-015).
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentFeatures {
  interests?: string[];
  age_band?: string; // e.g. "25-30"
  values?: string[];
  lifestyle?: string[];
  [key: string]: unknown;
}

interface EvalRow {
  pair_id: string;
  agent_a: AgentFeatures;
  agent_b: AgentFeatures;
  embedding_a: number[];
  embedding_b: number[];
  human_score: 1 | 2 | 3 | 4 | 5;
}

interface WeightResult {
  w_cosine: number;
  w_struct: number;
  train_rho: number;
  holdout_rho: number;
  ci_lo: number;
  ci_hi: number;
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Jaccard similarity for string arrays.
 */
function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setA = new Set(a.map((s) => s.toLowerCase()));
  const setB = new Set(b.map((s) => s.toLowerCase()));
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Parse age-band string (e.g. "25-30") to its midpoint.
 */
function ageBandMidpoint(band: string): number | null {
  const match = band.match(/^(\d+)-(\d+)$/);
  if (!match) return null;
  return (parseInt(match[1], 10) + parseInt(match[2], 10)) / 2;
}

/**
 * Structured feature score in [0, 1] — mirrors the SQL scoring logic.
 * Bonus: shared interests (Jaccard).
 * Penalty: age-band distance, values/lifestyle contradictions.
 */
function structuredFeatureScore(a: AgentFeatures, b: AgentFeatures): number {
  let score = 0;
  let weight = 0;

  // Interests: Jaccard similarity (weight 0.4)
  const interestScore = jaccard(a.interests ?? [], b.interests ?? []);
  score += 0.4 * interestScore;
  weight += 0.4;

  // Values: Jaccard similarity (weight 0.3)
  const valueScore = jaccard(a.values ?? [], b.values ?? []);
  score += 0.3 * valueScore;
  weight += 0.3;

  // Lifestyle: Jaccard similarity (weight 0.2)
  const lifestyleScore = jaccard(a.lifestyle ?? [], b.lifestyle ?? []);
  score += 0.2 * lifestyleScore;
  weight += 0.2;

  // Age-band proximity: penalise large gaps (weight 0.1)
  // Map age distance to a 0-1 score: 0 years apart → 1.0, >=20 years → 0.0
  if (a.age_band !== undefined && b.age_band !== undefined) {
    const midA = ageBandMidpoint(a.age_band);
    const midB = ageBandMidpoint(b.age_band);
    if (midA !== null && midB !== null) {
      const dist = Math.abs(midA - midB);
      const ageBandScore = Math.max(0, 1 - dist / 20);
      score += 0.1 * ageBandScore;
      weight += 0.1;
    }
  }

  // Normalise by actual weight used (handles missing fields).
  return weight === 0 ? 0.5 : score / weight;
}

/**
 * Rank an array of numbers (1-based, average ties).
 */
function rank(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j < indexed.length && indexed[j].v === indexed[i].v) j++;
    const avgRank = (i + j - 1) / 2 + 1;
    for (let k = i; k < j; k++) {
      ranks[indexed[k].i] = avgRank;
    }
    i = j;
  }
  return ranks;
}

/**
 * Spearman rank correlation between two numeric arrays.
 */
function spearman(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 2) return 0;
  const rx = rank(x);
  const ry = rank(y);
  const n = rx.length;
  let meanX = 0;
  let meanY = 0;
  for (let i = 0; i < n; i++) {
    meanX += rx[i];
    meanY += ry[i];
  }
  meanX /= n;
  meanY /= n;
  let num = 0;
  let denomX = 0;
  let denomY = 0;
  for (let i = 0; i < n; i++) {
    const dx = rx[i] - meanX;
    const dy = ry[i] - meanY;
    num += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  const denom = Math.sqrt(denomX * denomY);
  return denom === 0 ? 0 : num / denom;
}

// ---------------------------------------------------------------------------
// Deterministic train/holdout split
// ---------------------------------------------------------------------------

/**
 * Simple djb2 hash for a string → integer.
 */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * Split rows into train (80%) and holdout (20%) deterministically by pair_id hash.
 */
function splitRows(rows: EvalRow[]): { train: EvalRow[]; holdout: EvalRow[] } {
  const sorted = [...rows].sort((a, b) => a.pair_id.localeCompare(b.pair_id));
  const train: EvalRow[] = [];
  const holdout: EvalRow[] = [];
  for (const row of sorted) {
    if (hashString(row.pair_id) % 10 < 8) {
      train.push(row);
    } else {
      holdout.push(row);
    }
  }
  return { train, holdout };
}

// ---------------------------------------------------------------------------
// Bootstrap CI
// ---------------------------------------------------------------------------

/**
 * Bootstrap 95% CI for Spearman rho on a set of rows.
 */
function bootstrapCI(
  rows: EvalRow[],
  wCosine: number,
  wStruct: number,
  iterations: number = 1000,
): { lo: number; hi: number } {
  const n = rows.length;
  const rhos: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const sample: EvalRow[] = [];
    for (let j = 0; j < n; j++) {
      sample.push(rows[Math.floor(Math.random() * n)]);
    }
    const predicted = sample.map(
      (r) =>
        wCosine * cosineSimilarity(r.embedding_a, r.embedding_b) +
        wStruct * structuredFeatureScore(r.agent_a, r.agent_b),
    );
    const human = sample.map((r) => r.human_score);
    rhos.push(spearman(predicted, human));
  }
  rhos.sort((a, b) => a - b);
  const lo = rhos[Math.floor(iterations * 0.025)];
  const hi = rhos[Math.floor(iterations * 0.975)];
  return { lo: lo ?? 0, hi: hi ?? 0 };
}

// ---------------------------------------------------------------------------
// Grid search
// ---------------------------------------------------------------------------

interface GridCandidate {
  w_cosine: number;
  w_struct: number;
  train_rho: number;
}

function gridSearch(train: EvalRow[]): GridCandidate[] {
  const results: GridCandidate[] = [];
  // Iterate w_cosine from 0.30 to 0.80 in steps of 0.05
  for (let wc = 0.3; wc <= 0.805; wc = Math.round((wc + 0.05) * 100) / 100) {
    const ws = Math.round((1.0 - wc) * 100) / 100;
    const predicted = train.map(
      (r) =>
        wc * cosineSimilarity(r.embedding_a, r.embedding_b) +
        ws * structuredFeatureScore(r.agent_a, r.agent_b),
    );
    const human = train.map((r) => r.human_score);
    const rho = spearman(predicted, human);
    results.push({ w_cosine: wc, w_struct: ws, train_rho: rho });
  }
  // Sort descending by train_rho
  results.sort((a, b) => b.train_rho - a.train_rho);
  return results;
}

// ---------------------------------------------------------------------------
// --apply: upsert weights to app_settings
// ---------------------------------------------------------------------------

async function applyWeights(best: GridCandidate): Promise<void> {
  // Dynamic import avoids pulling server-only into --help/missing-corpus paths.
  const { getServiceClient } = await import('@/lib/supabase/service');
  const client = getServiceClient();

  const { error } = await client.from('app_settings').upsert(
    [
      { key: 'match_weight_cosine', value: String(best.w_cosine) },
      { key: 'match_weight_struct', value: String(best.w_struct) },
    ],
    { onConflict: 'key' },
  );

  if (error) {
    console.error('Failed to upsert weights:', error.message);
    process.exit(1);
  }
  console.error(`Applied: w_cosine=${best.w_cosine}, w_struct=${best.w_struct}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const EVAL_SET_PATH = join(process.cwd(), '.omc/plans/match-eval-set.jsonl');
const HELP_TEXT = `
calibrate-match-weights — calibrate cosine/structured-feature weights for agent matching

USAGE
  tsx scripts/calibrate-match-weights.ts [--apply] [--help]

OPTIONS
  --apply   After calibration, UPSERT the best weights into app_settings (Supabase).
            Default is dry-run (prints JSON to stdout only).
  --help    Print this help message and exit.

EVAL SET
  Expected at: .omc/plans/match-eval-set.jsonl
  Each line is a JSON object with shape:
    {
      pair_id:     string,
      agent_a:     { interests?: string[], age_band?: string, values?: string[], lifestyle?: string[] },
      agent_b:     { same shape as agent_a },
      embedding_a: number[],
      embedding_b: number[],
      human_score: 1 | 2 | 3 | 4 | 5
    }

OUTPUT (stdout, JSON)
  { best: [ { w_cosine, w_struct, train_rho, holdout_rho, ci_lo, ci_hi }, ... ] }
  Top-3 candidates ordered by train Spearman rho, with holdout rho and bootstrap 95% CI.

NOTES
  - Train/holdout split is 80/20, deterministic by pair_id hash.
  - Grid search: w_cosine in [0.30, 0.35, ..., 0.80] (step 0.05), w_struct = 1 - w_cosine.
  - Bootstrap CI uses 1000 resamples of the holdout set.
  - See plan v4 Step 1.13 (US-015). Eval set authored in Phase 2.
`.trimStart();

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help')) {
    process.stdout.write(HELP_TEXT);
    process.exit(0);
  }

  const applyFlag = args.includes('--apply');

  // --- Missing corpus case ---
  if (!existsSync(EVAL_SET_PATH)) {
    console.log(
      'Eval set not yet authored. Expected at .omc/plans/match-eval-set.jsonl. See plan v4 Step 1.13 (deferred to Phase 2).',
    );
    process.exit(0);
  }

  // --- Parse JSONL ---
  const raw = readFileSync(EVAL_SET_PATH, 'utf-8');
  const rows: EvalRow[] = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, idx) => {
      try {
        return JSON.parse(line) as EvalRow;
      } catch (err) {
        console.error(`Failed to parse line ${idx + 1}: ${String(err)}`);
        process.exit(1);
      }
    });

  if (rows.length < 5) {
    console.error(`Eval set too small (${rows.length} rows). Need at least 5.`);
    process.exit(1);
  }

  // --- Split ---
  const { train, holdout } = splitRows(rows);
  console.error(`Split: ${train.length} train / ${holdout.length} holdout`);

  // --- Grid search on train ---
  const candidates = gridSearch(train);
  const top3 = candidates.slice(0, 3);

  // --- Holdout evaluation + bootstrap CI ---
  const results: WeightResult[] = top3.map((c) => {
    const holdoutPredicted = holdout.map(
      (r) =>
        c.w_cosine * cosineSimilarity(r.embedding_a, r.embedding_b) +
        c.w_struct * structuredFeatureScore(r.agent_a, r.agent_b),
    );
    const holdoutHuman = holdout.map((r) => r.human_score);
    const holdout_rho = spearman(holdoutPredicted, holdoutHuman);
    const { lo, hi } = bootstrapCI(holdout, c.w_cosine, c.w_struct);
    return {
      w_cosine: c.w_cosine,
      w_struct: c.w_struct,
      train_rho: c.train_rho,
      holdout_rho,
      ci_lo: lo,
      ci_hi: hi,
    };
  });

  // --- Output ---
  process.stdout.write(JSON.stringify({ best: results }, null, 2) + '\n');

  // --- Apply if requested ---
  if (applyFlag) {
    if (top3.length === 0) {
      console.error('No candidates to apply.');
      process.exit(1);
    }
    await applyWeights(top3[0]);
  }
}

main().catch((err: unknown) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
