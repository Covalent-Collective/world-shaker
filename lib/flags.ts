/**
 * Feature flags. Each flag reads from the corresponding env var first,
 * defaulting to false when the env var is absent or not 'true'.
 *
 * Usage:
 *   import { flags, isEnabled } from '@/lib/flags';
 *   if (isEnabled('BILINGUAL_PROMPTS_V1')) { ... }
 */

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

/**
 * Type-safe flag gate helper. Reads the live env var on each call so that
 * tests can override process.env without module re-import.
 */
export function isEnabled(name: FlagName): boolean {
  return envFlag(name);
}
