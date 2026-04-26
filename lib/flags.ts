// Launch posture: BILINGUAL_PROMPTS_V1 defaults to false at production launch.
// Set to true only after the EN rubric gate passes (Step 5.5 of world-shaker-ux-v1-plan.md v4):
//   aggregate avg >= 7/10 AND no single dimension < 5, scored by 2 independent human reviewers.
// Staging environments may override via env var for pre-launch evaluation runs.
// See .omc/plans/en-rubric-protocol.md for the full gate specification.
function envFlag(name: string): boolean {
  return process.env[name] === 'true';
}

export const flags = {
  /** Enable bilingual (KR+EN) system prompts for LLM conversations. */
  BILINGUAL_PROMPTS_V1: envFlag('BILINGUAL_PROMPTS_V1'),
  /** Enable Stroll World proactive matching feature. */
  STROLL_WORLD_V1: envFlag('STROLL_WORLD_V1'),
} as const;

export type FlagName = keyof typeof flags;

/** Reads the live env var on each call so tests can override process.env without module re-import. */
export function isEnabled(name: FlagName): boolean {
  return envFlag(name);
}
