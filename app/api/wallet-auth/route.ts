import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { getServiceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';

/**
 * GET /api/wallet-auth?action=nonce
 * Returns a fresh nonce for SIWE-style wallet auth.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get('action') !== 'nonce') {
    return NextResponse.json({ error: 'unknown_action' }, { status: 400 });
  }
  const nonce = randomBytes(16).toString('hex');
  return NextResponse.json({ nonce });
}

const Body = z.object({
  nullifier: z.string(),
  wallet_address: z.string(),
  world_username: z.string().optional(),
  signed_nonce: z.string(),
});

/**
 * POST /api/wallet-auth
 *
 * After IDKit verify succeeds, the client calls Wallet Auth to associate
 * the nullifier with a wallet_address and world_username.
 *
 * world_username comes from MiniKit.user.username (auto-populated).
 * No manual entry — Codex/Wallet Auth path.
 */
export async function POST(req: Request) {
  try {
    const body = Body.safeParse(await req.json());
    if (!body.success) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }

    // TODO: verify signed_nonce against wallet_address (SIWE).
    // For now, scaffold trusts the request — replace before production.

    const supabase = getServiceClient();
    const { error } = await supabase
      .from('users')
      .update({
        wallet_address: body.data.wallet_address,
        world_username: body.data.world_username,
      })
      .eq('nullifier', body.data.nullifier);

    if (error) {
      console.error('wallet-auth update error:', error);
      return NextResponse.json({ error: 'update_failed' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('wallet-auth error:', err);
    return NextResponse.json({ error: 'wallet_auth_failed' }, { status: 500 });
  }
}
