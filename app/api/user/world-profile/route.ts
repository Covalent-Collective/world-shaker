import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { verifyWorldUserJwt, SESSION_COOKIE } from '@/lib/auth/jwt';
import { getServiceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';

/**
 * POST /api/user/world-profile
 *
 * Captures the current user's World App identity (username + wallet
 * address) so we can pre-fill recipient pickers in cross-app handoffs
 * (notably the World Chat composer, which keys recipients by World App
 * username and not by display name).
 *
 * Inside the World App, the MiniApp provider exposes
 * `MiniKit.user.username` and `MiniKit.user.walletAddress` synchronously
 * once the user has opened the mini app — no wallet-auth round trip is
 * required. The client reads those values and POSTs here.
 *
 * For schema-stability we stash both fields onto the user's active
 * agent's `interview_answers` jsonb (keys `q0_world_username` and
 * `q0_wallet_address`). When we add proper user-profile columns the
 * read sites will switch over without a client change.
 */
const Body = z.object({
  username: z.string().trim().min(1).max(64).optional(),
  walletAddress: z
    .string()
    .trim()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'wallet_address must be a 0x-prefixed 20-byte hex')
    .optional(),
});

export async function POST(req: Request): Promise<Response> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let claims: Awaited<ReturnType<typeof verifyWorldUserJwt>>;
  try {
    claims = await verifyWorldUserJwt(token);
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const { username, walletAddress } = parsed.data;
  if (!username && !walletAddress) {
    return NextResponse.json({ ok: true, updated: false });
  }

  const supabase = getServiceClient();

  const { data: agent } = await supabase
    .from('agents')
    .select('id, interview_answers')
    .eq('user_id', claims.world_user_id)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  if (!agent) {
    return NextResponse.json({ error: 'no_active_agent' }, { status: 404 });
  }

  const existing = (agent.interview_answers as Record<string, unknown> | null) ?? {};
  const merged: Record<string, unknown> = { ...existing };
  if (username) merged.q0_world_username = username;
  if (walletAddress) merged.q0_wallet_address = walletAddress.toLowerCase();

  const { error } = await supabase
    .from('agents')
    .update({ interview_answers: merged })
    .eq('id', agent.id);
  if (error) {
    console.error('[user/world-profile] update failed', error);
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, updated: true });
}
