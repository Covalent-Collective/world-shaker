import 'server-only';

import { createClient } from '@supabase/supabase-js';

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
 */
export function getServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
