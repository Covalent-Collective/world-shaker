/**
 * Avatar generation race-condition guard (US-501 one-shot policy).
 *
 * Verifies that two concurrent generateAvatar() calls for the same agent_id:
 *   1. Both return the same avatar URL.
 *   2. Only one DB UPDATE is honoured (atomic .is('avatar_generated_at', null) predicate).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock lib/supabase/service before importing generate.ts ────────────────────

const AGENT_ID = 'agent-uuid-race-test';

// Tracks how many updates succeeded (i.e. .is('avatar_generated_at', null) predicate passed).
let updateSuccessCount = 0;
// The stored avatar_url after first write — captured from the actual update payload.
let storedUrl: string | null = null;

function makeUpdateChain(vals: { avatar_url?: string; [k: string]: unknown }) {
  // Capture the URL being written so the re-select can return it.
  const writtenUrl = vals.avatar_url ?? null;
  let isPredicateCalled = false;
  const chain: Record<string, unknown> = {};

  chain.eq = () => chain;
  chain.is = (_col: string, _val: null) => {
    isPredicateCalled = true;
    return chain;
  };
  chain.select = () => chain;
  // Simulate atomic UPDATE: only the first concurrent call (when storedUrl===null) wins.
  chain.then = (resolve: (v: { data: unknown[]; error: null }) => void) => {
    if (!isPredicateCalled) {
      // .is() was never chained — non-atomic path; should not happen after fix.
      updateSuccessCount++;
      storedUrl = writtenUrl;
      resolve({
        data: [{ avatar_url: storedUrl, avatar_generated_at: new Date().toISOString() }],
        error: null,
      });
      return;
    }
    if (storedUrl === null) {
      // First caller wins.
      updateSuccessCount++;
      storedUrl = writtenUrl;
      resolve({
        data: [{ avatar_url: storedUrl, avatar_generated_at: new Date().toISOString() }],
        error: null,
      });
    } else {
      // Lost the race — predicate filtered out all rows.
      resolve({ data: [], error: null });
    }
  };
  return chain;
}

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: () => ({
    from: (_table: string) => ({
      select: (cols: string) => {
        // Initial one-shot guard SELECT
        if (cols.includes('avatar_generated_at')) {
          return {
            eq: () => ({
              single: () =>
                Promise.resolve({
                  data: { avatar_url: null, avatar_generated_at: null },
                  error: null,
                }),
            }),
          };
        }
        // Re-select after lost race — return the winner's stored URL.
        return {
          eq: () => ({
            single: () => Promise.resolve({ data: { avatar_url: storedUrl }, error: null }),
          }),
        };
      },
      update: (vals: { avatar_url?: string; [k: string]: unknown }) => makeUpdateChain(vals),
    }),
  }),
}));

// ── Import after mocks are registered ────────────────────────────────────────

import { generateAvatar } from '@/lib/avatar/generate';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('generateAvatar — race condition (US-501 atomic guard)', () => {
  beforeEach(() => {
    updateSuccessCount = 0;
    storedUrl = null;
    // Ensure placeholder path (no real image API call).
    delete process.env.OPENROUTER_IMAGE_MODEL;
  });

  it('both concurrent calls return the same URL', async () => {
    const [result1, result2] = await Promise.all([
      generateAvatar({ agent_id: AGENT_ID, extracted_features: { mood: 'calm' } }),
      generateAvatar({ agent_id: AGENT_ID, extracted_features: { mood: 'calm' } }),
    ]);

    expect(result1.url).toBe(result2.url);
    expect(typeof result1.url).toBe('string');
    expect(result1.url.length).toBeGreaterThan(0);
  });

  it('only one UPDATE succeeds (atomic predicate enforced)', async () => {
    await Promise.all([
      generateAvatar({ agent_id: AGENT_ID, extracted_features: { mood: 'calm' } }),
      generateAvatar({ agent_id: AGENT_ID, extracted_features: { mood: 'calm' } }),
    ]);

    expect(updateSuccessCount).toBe(1);
  });
});
