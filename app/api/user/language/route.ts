import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const Body = z.object({
  lang: z.enum(['ko', 'en']),
});

/**
 * POST /api/user/language
 *
 * Updates the authenticated user's language_pref in the users table and sets
 * the `lang` cookie so server components can read the locale without a DB
 * round-trip. RLS scopes the UPDATE to the current user via JWT.
 */
export async function POST(req: Request) {
  try {
    const body = Body.safeParse(await req.json());
    if (!body.success) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }

    const { lang } = body.data;
    const supabase = await getServerClient();

    const { error } = await supabase.from('users').update({ language_pref: lang });

    if (error) {
      console.error('language update error:', error);
      return NextResponse.json({ error: 'update_failed' }, { status: 500 });
    }

    const response = NextResponse.json({ ok: true, lang });
    response.cookies.set('lang', lang, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });

    return response;
  } catch (err) {
    console.error('language route error:', err);
    return NextResponse.json({ error: 'language_update_failed' }, { status: 500 });
  }
}
