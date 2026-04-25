import { WORLD_ACTION, WORLD_ENVIRONMENT, WORLD_RP_ID } from './constants';

/**
 * Generate the rp_context that the client passes to IDKit.
 *
 * SECURITY: This must run server-side only. WORLD_SIGNING_KEY must never
 * be exposed to the browser. See app/api/rp-context/route.ts.
 *
 * NOTE: This is a scaffold. Replace with the actual signing implementation
 * once the Worldcoin SDK helper for rp_context generation is wired in.
 */
export async function generateRpContext({ signal }: { signal?: string }) {
  const signingKey = process.env.WORLD_SIGNING_KEY;
  if (!signingKey) {
    throw new Error('WORLD_SIGNING_KEY missing — server env not configured');
  }

  const now = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID();

  // TODO: replace with proper signed RP context per
  // https://docs.world.org/api-reference/developer-portal/verify
  return {
    rp_id: WORLD_RP_ID,
    action: WORLD_ACTION,
    signal,
    environment: WORLD_ENVIRONMENT,
    nonce,
    created_at: now,
    expires_at: now + 600,
    // sig: <hmac of the above using signingKey>
    sig: 'TODO_SCAFFOLD',
  };
}

/**
 * Verify an IDKit proof payload against the Developer Portal v4 endpoint.
 * Returns the validated nullifier on success.
 */
export async function verifyWithDevPortal(
  payload: unknown,
): Promise<
  { ok: true; nullifier: string; verification_level: string } | { ok: false; error: string }
> {
  if (!WORLD_RP_ID) {
    return { ok: false, error: 'rp_id_missing' };
  }
  const url = `https://developer.world.org/api/v4/verify/${WORLD_RP_ID}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `dev_portal_${res.status}_${text.slice(0, 100)}` };
    }
    const data = (await res.json()) as {
      success: boolean;
      nullifier: string;
      results?: Array<{ identifier: string; success: boolean; nullifier: string }>;
    };
    if (!data.success) {
      return { ok: false, error: 'dev_portal_rejected' };
    }
    const result = data.results?.[0];
    return {
      ok: true,
      nullifier: data.nullifier,
      verification_level: result?.identifier ?? 'orb',
    };
  } catch (err) {
    return { ok: false, error: `network_${(err as Error).message}` };
  }
}
