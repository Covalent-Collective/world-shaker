import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyWithDevPortal } from '@/lib/world/verify';
import { getServiceClient } from '@/lib/supabase/service';
import { WORLD_ACTION } from '@/lib/world/constants';

export const runtime = 'nodejs';

const Body = z.object({
  proof: z.unknown(),
  nullifier_hash: z.string().optional(),
  merkle_root: z.string().optional(),
  verification_level: z.string().optional(),
});

/**
 * POST /api/verify
 *
 * Receives the IDKit proof payload, forwards to Developer Portal v4 verify,
 * then enforces UNIQUE (nullifier, action) at the DB layer to guarantee
 * one-human-one-account.
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

    const supabase = getServiceClient();

    // Idempotent insert — UNIQUE on (nullifier, action) blocks duplicates.
    const { data: existing } = await supabase
      .from('users')
      .select('id, world_username')
      .eq('nullifier', result.nullifier)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({
        user_id: existing.id,
        already_registered: true,
      });
    }

    const { data: created, error: insertError } = await supabase
      .from('users')
      .insert({
        nullifier: result.nullifier,
        verification_level: result.verification_level ?? 'orb',
        action: WORLD_ACTION,
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('user insert error:', insertError);
      return NextResponse.json({ error: 'user_create_failed' }, { status: 500 });
    }

    return NextResponse.json({ user_id: created.id, already_registered: false });
  } catch (err) {
    console.error('verify error:', err);
    return NextResponse.json({ error: 'verify_failed' }, { status: 500 });
  }
}
