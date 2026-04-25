/**
 * CI guard: verifies every caller of getServiceClient() is on the allowlist.
 *
 * Run via: npm test -- whitelist
 *
 * This test uses execSync to shell out to git grep so it operates on the
 * actual working tree (same as a developer or CI runner would see).
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = join(__dirname, '..', '..');
const ALLOWLIST_PATH = join(PROJECT_ROOT, '.omc/plans/service-client-allowlist.txt');

/** Parse the allowlist file into an array of glob strings (comments stripped). */
function parseAllowlist(): string[] {
  const raw = readFileSync(ALLOWLIST_PATH, 'utf-8');
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}

/** Convert an allowlist glob to a RegExp for matching relative file paths. */
function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '.+')
    .replace(/\*/g, '[^/]+');
  return new RegExp(`^${escaped}$`);
}

/** Return relative paths (from project root) of all files calling getServiceClient(). */
function findCallers(): string[] {
  // Search lib/ and app/ for TypeScript files calling getServiceClient(.
  // Exclude the service.ts definition itself.
  let output = '';
  try {
    output = execSync(
      `git grep -l 'getServiceClient(' -- 'lib/**/*.ts' 'app/**/*.ts' 'lib/**/*.tsx' 'app/**/*.tsx'`,
      { cwd: PROJECT_ROOT, encoding: 'utf-8' },
    );
  } catch (err: unknown) {
    // git grep exits with code 1 when no matches — that's fine (no callers found).
    const exitCode = (err as { status?: number }).status;
    if (exitCode === 1) return [];
    throw err;
  }

  return (
    output
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      // Exclude the service.ts definition itself — it references getServiceClient by name.
      .filter((l) => !l.endsWith('lib/supabase/service.ts'))
  );
}

describe('service-client caller whitelist (US-009 / AC-20)', () => {
  it('allowlist file exists and contains at least one entry', () => {
    const entries = parseAllowlist();
    expect(entries.length).toBeGreaterThan(0);
  });

  it('every caller of getServiceClient() is on the allowlist', () => {
    const allowlist = parseAllowlist();
    const patterns = allowlist.map(globToRegex);
    const callers = findCallers();

    const violations: string[] = [];
    for (const caller of callers) {
      const allowed = patterns.some((p) => p.test(caller));
      if (!allowed) {
        violations.push(caller);
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `getServiceClient() called from non-whitelisted path(s):\n` +
          violations.map((v) => `  - ${v}`).join('\n') +
          `\n\nTo allow a new caller, add its path to:\n  .omc/plans/service-client-allowlist.txt`,
      );
    }

    expect(violations).toHaveLength(0);
  });

  it('allowlist contains no duplicate entries', () => {
    const entries = parseAllowlist();
    const unique = new Set(entries);
    expect(entries.length).toBe(unique.size);
  });
});
