import { NextResponse } from 'next/server';
import { createHash, randomBytes } from 'node:crypto';
import { getServiceClient } from '@/lib/supabase/service';

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

// SECURITY STOP-GAP: signature verification is unimplemented. The previous
// handler trusted the client-supplied wallet_address ↔ nullifier pair, which
// would let any HTTP client mutate any user's wallet binding. Returning 501
// until verifySiweMessage (from @worldcoin/minikit-js) and a `siwe_message`
// body field are wired in. Track via wallet-auth implementation PR.
export async function POST() {
  return NextResponse.json({ error: 'not_implemented' }, { status: 501 });
}
