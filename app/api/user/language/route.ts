import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { verifyWorldUserJwt, SESSION_COOKIE } from '@/lib/auth/jwt';
import { getServiceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';

const Body = z.object({
  lang: z.enum(['ko', 'en']),
});

/**
 * POST /api/user/language
 *
 * Updates the authenticated user's language_pref in the users table and sets
 * the `lang` cookie so server components can read the locale without a DB
 * round-trip.
 *
 * Why raw Route Handler instead of next-safe-action:
 *   next-safe-action's auth middleware assumes Supabase Auth session cookies.
 *   This route authenticates via our custom `ws_session` JWT (issued by
 *   lib/auth/jwt.ts), which next-safe-action cannot unwrap. Using a raw Route
 *   Handler keeps the auth path explicit and avoids bridging two incompatible
 *   session systems.
 *
 * Why getServiceClient() instead of getServerClient():
 *   The custom JWT is not a Supabase Auth token, so getServerClient() would
 *   treat the request as unauthenticated and RLS would reject the UPDATE (or
 *   worse, apply it to zero rows silently). We verify the JWT ourselves, then
 *   use the service client scoped to the extracted world_user_id via an
 *   explicit .eq() filter — this is the correct pattern for custom-JWT routes.
 */
export async function POST(req: Request) {
  // 1. Extract and verify the custom session JWT.
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (!token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let claims: Awaited<ReturnType<typeof verifyWorldUserJwt>>;
  try {
    claims = await verifyWorldUserJwt(token);
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // 2. Validate request body.
  const body = Body.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const { lang } = body.data;

  // 3. Update language_pref scoped explicitly to the authenticated user.
  const supabase = getServiceClient();
  const { error } = await supabase
    .from('users')
    .update({ language_pref: lang })
    .eq('id', claims.world_user_id);

  if (error) {
    console.error('language update error:', error);
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }

  // 4. Set the lang cookie and return.
  const response = NextResponse.json({ ok: true, lang });
  response.cookies.set('lang', lang, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });

  return response;
}
