import 'server-only';

import {
  WORLD_ACTION,
  WORLD_ENVIRONMENT,
  WORLD_APP_ID,
  WORLD_RP_ID,
  REQUIRED_VERIFICATION_LEVEL,
} from './constants';

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
 * Verify a MiniKit `verify` finalPayload (ISuccessResult) against Dev Portal v2.
 *
 * Inside the World App, MiniKit produces a flat ISuccessResult; we forward it
 * along with our server-pinned action so the proof's action binding is checked
 * by Dev Portal, then reassert action and verification_level on the response so
 * a proof from a different action / device level can never be accepted.
 */

const VERIFY_TIMEOUT_MS = 8000;

export async function verifyWithDevPortal(
  payload: unknown,
): Promise<
  { ok: true; nullifier: string; verification_level: 'orb' } | { ok: false; error: string }
> {
  if (!WORLD_APP_ID) {
    return { ok: false, error: 'app_id_missing' };
  }
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'invalid_payload' };
  }
  const p = payload as {
    proof?: string;
    merkle_root?: string;
    nullifier_hash?: string;
    verification_level?: string;
  };
  if (!p.proof || !p.merkle_root || !p.nullifier_hash) {
    return { ok: false, error: 'invalid_idkit_payload' };
  }

  const url = `https://developer.worldcoin.org/api/v2/verify/${WORLD_APP_ID}`;
  const body = {
    merkle_root: p.merkle_root,
    nullifier_hash: p.nullifier_hash,
    proof: p.proof,
    verification_level: p.verification_level ?? REQUIRED_VERIFICATION_LEVEL,
    action: WORLD_ACTION,
  };
  console.log(
    '[verify] forward to dev portal',
    JSON.stringify({
      url,
      action: body.action,
      verification_level: body.verification_level,
    }),
  );

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('[verify] dev portal non-2xx', res.status, text);
      return { ok: false, error: `dev_portal_${res.status}_${text.slice(0, 500)}` };
    }
    // v2 success response is flat: { success, action, nullifier_hash,
    // verification_level, created_at }.
    const data = (await res.json()) as {
      success?: boolean;
      action?: string;
      nullifier_hash?: string;
      verification_level?: string;
    };

    // Log only non-sensitive shape signals — never the nullifier_hash itself.
    console.log(
      '[verify] dev portal success',
      JSON.stringify({
        success: data.success,
        action_match: data.action === WORLD_ACTION,
        verification_level: data.verification_level,
      }),
    );

    if (!data.success || typeof data.nullifier_hash !== 'string') {
      return { ok: false, error: 'dev_portal_rejected' };
    }
    if (data.action !== WORLD_ACTION) {
      return { ok: false, error: `action_mismatch_${data.action ?? 'missing'}` };
    }
    if (data.verification_level !== REQUIRED_VERIFICATION_LEVEL) {
      return {
        ok: false,
        error: `orb_credential_required_${data.verification_level ?? 'missing'}`,
      };
    }

    return {
      ok: true,
      nullifier: data.nullifier_hash,
      verification_level: REQUIRED_VERIFICATION_LEVEL,
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      return { ok: false, error: 'network_timeout' };
    }
    return { ok: false, error: `network_${(err as Error).message}` };
  }
}
