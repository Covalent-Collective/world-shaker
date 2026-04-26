import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyWithDevPortal } from '@/lib/world/verify';
import { getServiceClient } from '@/lib/supabase/service';
import { WORLD_ACTION } from '@/lib/world/constants';
import { signWorldUserJwt, SESSION_COOKIE, parseLanguagePref } from '@/lib/auth/jwt';

export const runtime = 'nodejs';

// MiniKit `verify` finalPayload (ISuccessResult) — flat shape forwarded
// to Dev Portal v2 along with a server-injected `action`.
const Body = z.object({
  proof: z.string(),
  merkle_root: z.string(),
  nullifier_hash: z.string(),
  verification_level: z.enum(['orb', 'device']),
});

/**
 * POST /api/verify
 *
 * Receives the MiniKit proof payload, forwards to Developer Portal v2 verify
 * (with action/level checks enforced in lib/world/verify.ts), then upserts
 * the user with UNIQUE (nullifier, action) to guarantee one-human-one-account.
 *
 * On success, issues a Supabase-compatible JWT and sets it as the
 * `ws_session` cookie. RLS policies read its `world_user_id` claim via
 * public.current_world_user_id().
 *
 * Lookup is scoped by both nullifier AND action so the same human verifying
 * for a different action cannot collide; the select-then-insert race is
 * handled via 23505 (unique violation) catch.
 */
export async function POST(req: Request) {
  try {
    const body = Body.safeParse(await req.json());
    if (!body.success) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }

    const result = await verifyWithDevPortal(body.data);
    if (!result.ok) {
      console.error('[verify] failed', result.error);
      return NextResponse.json({ error: 'verify_failed', detail: result.error }, { status: 400 });
    }

    // Derive language preference from Accept-Language header.
    const languagePref = parseLanguagePref(req.headers.get('accept-language'));

    // Derive timezone:
    // 1. x-timezone header (set by client JS before the call, most reliable).
    // 2. Fallback to 'UTC' — MiniKit does not expose timezone reliably.
    const timezone = req.headers.get('x-timezone') ?? 'UTC';

    const supabase = getServiceClient();

    // Race-safe upsert: try insert first; if (nullifier, action) UNIQUE fires,
    // fetch the existing row.
    const { data: created, error: insertError } = await supabase
      .from('users')
      .insert({
        nullifier: result.nullifier,
        verification_level: result.verification_level,
        action: WORLD_ACTION,
        language_pref: languagePref,
        timezone,
      })
      .select('id, nullifier')
      .single();

    let userId: string;
    let alreadyRegistered = false;

    if (insertError) {
      if (insertError.code !== '23505') {
        console.error('user insert error:', insertError);
        return NextResponse.json({ error: 'user_create_failed' }, { status: 500 });
      }
      // Unique violation — the row exists. Fetch it scoped by (nullifier, action).
      const { data: existing, error: selectError } = await supabase
        .from('users')
        .select('id')
        .eq('nullifier', result.nullifier)
        .eq('action', WORLD_ACTION)
        .single();
      if (selectError || !existing) {
        console.error('user lookup error:', selectError);
        return NextResponse.json({ error: 'user_lookup_failed' }, { status: 500 });
      }
      // Update language_pref and timezone on re-verify so they stay current.
      await supabase
        .from('users')
        .update({ language_pref: languagePref, timezone })
        .eq('id', existing.id);
      userId = existing.id;
      alreadyRegistered = true;
    } else {
      userId = created.id;
    }

    const token = await signWorldUserJwt({
      world_user_id: userId,
      nullifier: result.nullifier,
      language_pref: languagePref,
    });

    const response = NextResponse.json({
      user_id: userId,
      already_registered: alreadyRegistered,
    });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });
    return response;
  } catch (err) {
    console.error('verify error:', err);
    return NextResponse.json({ error: 'verify_failed' }, { status: 500 });
  }
}
