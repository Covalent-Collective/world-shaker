import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Service-role Supabase client. BYPASSES RLS.
 *
 * SECURITY: Only use in:
 *   - Inngest jobs (server-only context)
 *   - /api/verify, /api/wallet-auth, /api/inngest (server-only)
 *   - Admin tools
 *
 * Never import this from a client component or expose its key to the browser.
 *
 * Per-user data access from the browser must use the anon client + RLS, with
 * the JWT issued by lib/auth/jwt.ts attached so RLS policies can resolve
 * world_user_id via the current_world_user_id() helper.
 *
 * Callers must be listed in .omc/plans/service-client-allowlist.txt.
 * In dev/test, a runtime assertion verifies this. See US-009 / AC-20.
 */

/**
 * Parse allowlist from .omc/plans/service-client-allowlist.txt.
 * Returns an array of RegExp patterns derived from the path globs.
 */
function loadAllowlistPatterns(): RegExp[] {
  try {
    const allowlistPath = join(process.cwd(), '.omc/plans/service-client-allowlist.txt');
    const raw = readFileSync(allowlistPath, 'utf-8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      .map((glob) => {
        // Convert glob to regex:
        // - "lib/inngest/**" → matches anything starting with lib/inngest/
        // - "app/api/foo/route.ts" → exact match (after normalising slashes)
        // Escape special regex chars except * which we handle explicitly.
        const escaped = glob
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*\*/g, '.+') // ** → one or more characters
          .replace(/\*/g, '[^/]+'); // * → non-separator chars
        return new RegExp(escaped);
      });
  } catch {
    // If the allowlist file is missing in production/CI we fail open (skip check).
    return [];
  }
}

/**
 * Extract the caller's file path from a stack trace line.
 * Returns the normalised relative path (forward slashes, cwd stripped).
 */
function extractCallerPath(stack: string): string {
  const lines = stack.split('\n');
  const cwd = process.cwd().replace(/\\/g, '/');

  for (const line of lines) {
    // Skip frames inside this file and node internals.
    if (line.includes('service.ts') || line.includes('node:') || line.includes('node_modules')) {
      continue;
    }
    // Extract file path from "at ... (/.../file.ts:N:N)" or "at /.../file.ts:N:N"
    const match = line.match(/\((.+?):\d+:\d+\)/) ?? line.match(/at (.+?):\d+:\d+/);
    if (match) {
      const filePath = match[1].replace(/\\/g, '/');
      // Strip cwd prefix and leading slash to get a relative path.
      const relative = filePath.startsWith(cwd)
        ? filePath.slice(cwd.length).replace(/^\//, '')
        : filePath;
      return relative;
    }
  }
  return '';
}

/**
 * In dev/test environments, assert that the caller's file is on the
 * service-client allowlist. Throws if the caller is not whitelisted.
 * Skipped in production to avoid stack inspection overhead.
 */
function assertAllowlistedCaller(): void {
  if (process.env.NODE_ENV === 'production') return;

  const patterns = loadAllowlistPatterns();
  if (patterns.length === 0) return; // allowlist file missing — skip

  const stack = new Error().stack ?? '';
  const caller = extractCallerPath(stack);

  if (!caller) return; // can't determine caller — fail open

  const allowed = patterns.some((pattern) => pattern.test(caller));
  if (!allowed) {
    throw new Error(`getServiceClient called from non-whitelisted path: ${caller}`);
  }
}

export function getServiceClient() {
  assertAllowlistedCaller();

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
