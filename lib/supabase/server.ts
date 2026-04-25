import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Server-side Supabase client with cookie-based session.
 * Use in route handlers and server components for actions taken on behalf of
 * the currently signed-in user. RLS enforces row-level access.
 *
 * For background jobs and admin operations that need to bypass RLS, use
 * `lib/supabase/service.ts` instead — but only from whitelisted paths:
 *
 * SERVICE-CLIENT WHITELIST (see .omc/plans/service-client-allowlist.txt):
 *   - lib/inngest/**
 *   - app/api/inngest/route.ts
 *   - app/api/verify/route.ts
 *   - app/api/wallet-auth/route.ts
 *   - app/api/conversation/[id]/stream/route.ts
 *   - app/api/user/language/route.ts
 *
 * Adding a new caller requires updating the allowlist file AND getting security review.
 */
export async function getServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            /* called from a Server Component — safe to ignore */
          }
        },
      },
    },
  );
}
