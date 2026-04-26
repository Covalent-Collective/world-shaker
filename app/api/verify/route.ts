import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyWithDevPortal } from '@/lib/world/verify';
import { getServiceClient } from '@/lib/supabase/service';
import { WORLD_ACTION } from '@/lib/world/constants';
import { signWorldUserJwt, SESSION_COOKIE, parseLanguagePref } from '@/lib/auth/jwt';

export const runtime = 'nodejs';

// IDKit returns IDKitResultV3 | IDKitResultV4 | IDKitResultSession with
// protocol_version, nonce, action, responses[], environment. The full result
// is forwarded to the Dev Portal verify endpoint untouched — proofs are bound
// to the action and other fields they were generated against. Passthrough so
// no fields are stripped before forwarding.
const Body = z
  .object({
    protocol_version: z.string().optional(),
    action: z.string().optional(),
    responses: z.array(z.unknown()).optional(),
  })
  .passthrough();

/**
 * POST /api/verify
 *
 * Receives the IDKit proof payload, forwards to Developer Portal v4 verify
 * (with action/environment/orb checks enforced in lib/world/verify.ts),
 * then upserts the user with UNIQUE (nullifier, action) to guarantee
 * one-human-one-account.
 *
 * On success, issues a Supabase-compatible JWT and sets it as the
 * `ws_session` cookie. RLS policies read its `world_user_id` claim via
 * public.current_world_user_id().
 *
 * Codex MEDIUM-3: lookup is scoped by both nullifier AND action; the
 * select-then-insert race is handled via 23505 (unique violation) catch.
 */
export async function POST(req: Request) {
  try {
    const body = Body.safeParse(await req.json());
    if (!body.success) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }

    const result = await verifyWithDevPortal(body.data);
    if (!result.ok) {
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
