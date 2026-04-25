import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { getServiceClient } from '@/lib/supabase/service';
import { WORLD_ACTION } from '@/lib/world/constants';
import { aj, verifyRateLimit } from '@/lib/arcjet';

export const runtime = 'nodejs';

const NONCE_TTL_MS = 5 * 60 * 1000;

function hashNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex');
}

/**
 * GET /api/wallet-auth?action=nonce
 *
 * Returns a fresh nonce for SIWE-style wallet auth. The nonce HASH is
 * persisted in auth_nonces with a 5-minute expiry; the raw nonce returns
 * to the client. POST /api/wallet-auth verifies and consumes it.
 *
 * Codex HIGH-7: replay protection requires server-side state.
 */
export async function GET(req: Request) {
  const decision = await aj.protect(req as never);
  if (decision.isDenied()) {
    return NextResponse.json({ error: 'arcjet_denied' }, { status: 403 });
  }

  const url = new URL(req.url);
  if (url.searchParams.get('action') !== 'nonce') {
    return NextResponse.json({ error: 'unknown_action' }, { status: 400 });
  }

  const nonce = randomBytes(32).toString('hex');
  const hash = hashNonce(nonce);
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS).toISOString();

  const supabase = getServiceClient();
  const { error } = await supabase.from('auth_nonces').insert({
    nonce_hash: hash,
    expires_at: expiresAt,
  });
  if (error) {
    console.error('auth_nonces insert error:', error);
    return NextResponse.json({ error: 'nonce_create_failed' }, { status: 500 });
  }

  return NextResponse.json({ nonce, expires_at: expiresAt });
}

const Body = z.object({
  nullifier: z.string(),
  wallet_address: z.string(),
  world_username: z.string().optional(),
  nonce: z.string(),
  signed_nonce: z.string(),
});

/**
 * POST /api/wallet-auth
 *
 * After IDKit verify succeeds, the client signs the nonce with their wallet
 * and POSTs here to associate the wallet_address + world_username with the
 * user record.
 *
 * Flow:
 *   1. Look up the nonce in auth_nonces, check it is unexpired and unconsumed.
 *   2. Verify the wallet signature (TODO — see below).
 *   3. Mark the nonce consumed (idempotent).
 *   4. Update the user row scoped by (nullifier, action).
 *
 * world_username comes from MiniKit.user.username (auto-populated, never
 * manual). See v3 spec.
 */
export async function POST(req: Request) {
  try {
    const decision = await aj.withRule(verifyRateLimit).protect(req as never, { requested: 1 });
    if (decision.isDenied()) {
      return NextResponse.json(
        { error: 'arcjet_denied', reason: decision.reason.toString() },
        { status: decision.reason.isRateLimit() ? 429 : 403 },
      );
    }

    const body = Body.safeParse(await req.json());
    if (!body.success) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }

    const supabase = getServiceClient();
    const hash = hashNonce(body.data.nonce);

    // Single-statement consume: only succeeds if the nonce row is unconsumed
    // and unexpired. Returns the row on success, or zero rows otherwise.
    const { data: consumed, error: consumeError } = await supabase
      .from('auth_nonces')
      .update({ consumed_at: new Date().toISOString() })
      .eq('nonce_hash', hash)
      .is('consumed_at', null)
      .gt('expires_at', new Date().toISOString())
      .select('nonce_hash')
      .maybeSingle();

    if (consumeError) {
      console.error('nonce consume error:', consumeError);
      return NextResponse.json({ error: 'nonce_check_failed' }, { status: 500 });
    }
    if (!consumed) {
      return NextResponse.json({ error: 'nonce_invalid_or_expired' }, { status: 400 });
    }

    // TODO: verify body.data.signed_nonce against body.data.wallet_address
    // (SIWE / EIP-191 / EIP-1271). This scaffold trusts the request.
    // Replace before production launch.

    const { error: updateError } = await supabase
      .from('users')
      .update({
        wallet_address: body.data.wallet_address,
        world_username: body.data.world_username,
      })
      .eq('nullifier', body.data.nullifier)
      .eq('action', WORLD_ACTION);

    if (updateError) {
      console.error('wallet-auth update error:', updateError);
      return NextResponse.json({ error: 'update_failed' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('wallet-auth error:', err);
    return NextResponse.json({ error: 'wallet_auth_failed' }, { status: 500 });
  }
}
