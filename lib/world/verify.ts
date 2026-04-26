import 'server-only';

import {
  WORLD_ACTION,
  WORLD_ENVIRONMENT,
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
 * Verify a MiniKit `verify` finalPayload (ISuccessResult) against Dev Portal
 * v2. The MiniApp context delivers proofs through MiniKit, not IDKit web flow,
 * so v2 (flat body, app_id in path) is the matching endpoint shape.
 *
 * Per Codex review HIGH-2 we still enforce:
 *   - data.action equals our configured WORLD_ACTION
 *   - data.verification_level === 'orb' (REQUIRED_VERIFICATION_LEVEL)
 *
 * Without these checks, any proof from any other action / device level would
 * be accepted, breaking the orb-only one-human-one-account gate.
 */
export async function verifyWithDevPortal(
  payload: unknown,
): Promise<
  { ok: true; nullifier: string; verification_level: 'orb' } | { ok: false; error: string }
> {
  if (!WORLD_RP_ID) {
    return { ok: false, error: 'rp_id_missing' };
  }
  // Dev Portal v4 verify endpoint — accepts v3 protocol bodies for legacy
  // proofs. MiniKit v1 `verify` finalPayload is flat (ISuccessResult);
  // wrap into the v3 protocol body shape for forwarding.
  const url = `https://developer.world.org/api/v4/verify/${WORLD_RP_ID}`;
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
  const body = {
    protocol_version: '3.0',
    nonce: crypto.randomUUID(),
    action: WORLD_ACTION,
    environment: WORLD_ENVIRONMENT,
    responses: [
      {
        identifier: p.verification_level === 'orb' ? 'orb' : 'device',
        proof: p.proof,
        merkle_root: p.merkle_root,
        nullifier: p.nullifier_hash,
      },
    ],
  };
  console.log(
    '[verify] forward to dev portal',
    JSON.stringify({
      url,
      action: body.action,
      environment: body.environment,
      protocol_version: body.protocol_version,
      response_count: body.responses.length,
      identifier: body.responses[0]?.identifier,
    }),
  );
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

    console.log('[verify] dev portal success', JSON.stringify(data).slice(0, 600));

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
      verification_level: 'orb',
    };
  } catch (err) {
    return { ok: false, error: `network_${(err as Error).message}` };
  }
}
