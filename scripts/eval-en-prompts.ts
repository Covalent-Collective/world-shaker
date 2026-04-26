#!/usr/bin/env tsx
/**
 * eval-en-prompts.ts
 *
 * EN prompt rendering evaluation scaffold (Phase 5, Step 5.5).
 * Reads an EN feature-pair eval set (JSONL), calls the three bilingual prompt
 * builders with language='en', and prints the generated system prompts to
 * stdout for human review and rubric scoring.
 *
 * Usage:
 *   tsx scripts/eval-en-prompts.ts [--help] [--input <path>]
 *
 * Flags:
 *   --help           Print this usage message and exit 0.
 *   --input <path>   Path to JSONL eval set.
 *                    Default: .omc/plans/en-eval-set-placeholder.jsonl
 *                    Override via env: EN_EVAL_SET_PATH
 *
 * Output:
 *   Human-readable system prompts for each pair, emitted to stdout.
 *   Exit 0 always — this is informational; humans score via rubric.
 *   See .omc/plans/en-rubric-protocol.md for scoring instructions.
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { buildPersonaPrompt } from '../lib/llm/prompts/persona';
import { buildDialoguePrompt } from '../lib/llm/prompts/agent-dialogue';
import { buildReportPrompt } from '../lib/llm/prompts/report';
import type { ExtractedFeatures, PersonaProfile } from '../lib/llm/prompts/types';

// ── Types ────────────────────────────────────────────────────────────────────

interface EvalPersona {
  voice: string;
  interests: string[];
  values: string[];
  age_band: string;
}

interface EvalPair {
  pair_id: string;
  persona_a: EvalPersona;
  persona_b: EvalPersona;
}

// ── CLI flags ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--help')) {
  console.log(`
eval-en-prompts.ts — EN prompt rendering evaluation scaffold

Usage:
  tsx scripts/eval-en-prompts.ts [--help] [--input <path>]

Flags:
  --help           Print this usage message and exit 0.
  --input <path>   Path to JSONL eval set (default: .omc/plans/en-eval-set-placeholder.jsonl).
                   Override via env: EN_EVAL_SET_PATH

Output:
  Prints persona, dialogue, and report system prompts for each pair.
  Exit 0 always. Humans score output via rubric in .omc/plans/en-rubric-protocol.md.

Pre-conditions (per Step 5.5):
  - 200-pair match-eval set must exist (Step 1.13)
  - 200KR + 100EN safety corpus must exist (Step 1.14)

Gate:
  Aggregate rubric avg >= 7/10 AND no single dimension < 5
  => flip BILINGUAL_PROMPTS_V1=true in production.
`);
  process.exit(0);
}

// ── Paths ─────────────────────────────────────────────────────────────────────

const ROOT = resolve(process.cwd());

const inputArgIdx = args.indexOf('--input');
const EVAL_SET_PATH =
  inputArgIdx !== -1 && args[inputArgIdx + 1]
    ? resolve(args[inputArgIdx + 1])
    : resolve(ROOT, process.env['EN_EVAL_SET_PATH'] ?? '.omc/plans/en-eval-set-placeholder.jsonl');

// ── Guard: eval set missing ───────────────────────────────────────────────────

if (!existsSync(EVAL_SET_PATH)) {
  console.log(
    `EN eval set not found at: ${EVAL_SET_PATH}\n` +
      'Expected: .omc/plans/en-eval-set-placeholder.jsonl (placeholder) or a full 200-pair set.\n' +
      'See .omc/plans/en-rubric-protocol.md for authoring instructions.',
  );
  process.exit(0);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function evalPersonaToFeatures(p: EvalPersona): ExtractedFeatures {
  return {
    voice: p.voice,
    interests: p.interests,
    values: p.values,
    life_stage: p.age_band,
  };
}

function evalPersonaToProfile(p: EvalPersona, label: string): PersonaProfile {
  return {
    name: label,
    extracted_features: evalPersonaToFeatures(p),
  };
}

function separator(title: string): void {
  const line = '─'.repeat(72);
  console.log(`\n${line}`);
  console.log(`  ${title}`);
  console.log(`${line}\n`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  const raw = readFileSync(EVAL_SET_PATH, 'utf8');
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const pairs: EvalPair[] = lines.map((line, idx) => {
    try {
      return JSON.parse(line) as EvalPair;
    } catch {
      throw new Error(`Parse error at line ${idx + 1}: ${line.slice(0, 80)}`);
    }
  });

  console.log(`EN Prompt Rendering Evaluation`);
  console.log(`Eval set: ${EVAL_SET_PATH}`);
  console.log(`Pairs loaded: ${pairs.length}`);
  console.log(`\nScore each pair using the rubric in .omc/plans/en-rubric-protocol.md`);
  console.log(`Gate: aggregate avg >= 7/10 AND no single dimension < 5\n`);

  for (const pair of pairs) {
    separator(`Pair: ${pair.pair_id}`);

    const profileA = evalPersonaToProfile(pair.persona_a, 'Agent A');
    const profileB = evalPersonaToProfile(pair.persona_b, 'Agent B');

    // 1. Persona prompt for A
    const personaPromptA = buildPersonaPrompt({
      extracted_features: evalPersonaToFeatures(pair.persona_a),
      language: 'en',
    });
    console.log(`[PERSONA PROMPT — Agent A]\n`);
    console.log(personaPromptA);

    // 2. Persona prompt for B
    const personaPromptB = buildPersonaPrompt({
      extracted_features: evalPersonaToFeatures(pair.persona_b),
      language: 'en',
    });
    console.log(`\n[PERSONA PROMPT — Agent B]\n`);
    console.log(personaPromptB);

    // 3. Dialogue prompt (opening stage, Agent A's turn)
    const dialogueResult = buildDialoguePrompt({
      persona_a: profileA,
      persona_b: profileB,
      history: [],
      stage: 'opening',
      language: 'en',
      whose_turn: 'a',
    });
    console.log(`\n[DIALOGUE PROMPT — opening stage, Agent A's turn]\n`);
    console.log(dialogueResult.system);

    // 4. Report prompt (baseline 0.7)
    const reportResult = buildReportPrompt({
      transcript: [],
      persona_a: profileA,
      persona_b: profileB,
      baseline_score: 0.7,
      language: 'en',
    });
    console.log(`\n[REPORT PROMPT — baseline 0.70]\n`);
    console.log(reportResult.system);
  }

  separator('End of evaluation output');
  console.log(`Total pairs rendered: ${pairs.length}`);
  console.log(`Next step: two independent reviewers score each pair (see rubric).`);
  console.log(`Rubric: .omc/plans/en-rubric-protocol.md`);
}

main();
