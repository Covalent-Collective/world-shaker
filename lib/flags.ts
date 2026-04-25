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
