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
 * Verify an IDKit proof payload against the Developer Portal v4 endpoint.
 *
 * Per Codex review HIGH-2 we explicitly enforce:
 *   - data.action equals our configured WORLD_ACTION
 *   - data.environment matches WORLD_ENVIRONMENT
 *   - At least one result has identifier='orb' AND success=true
 *
 * Without these checks, any proof from any other action / environment / device
 * level would be accepted, breaking the orb-only one-human-one-account gate.
 */
export async function verifyWithDevPortal(
  payload: unknown,
): Promise<
  { ok: true; nullifier: string; verification_level: 'orb' } | { ok: false; error: string }
> {
  if (!WORLD_RP_ID) {
    return { ok: false, error: 'rp_id_missing' };
  }
  const url = `https://developer.world.org/api/v4/verify/${WORLD_RP_ID}`;
  // The client passes the full IDKit result (V3 or V4): it already has
  // protocol_version, nonce, action, responses[], environment. Forward as-is —
  // proofs are bound to the action they were generated against, so we cannot
  // safely override `action` server-side. We instead validate `data.action`
  // against WORLD_ACTION on the response below.
  if (!payload || typeof payload !== 'object' || !('responses' in payload)) {
    return { ok: false, error: 'invalid_idkit_payload' };
  }
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
      success?: boolean;
      action?: string;
      environment?: string;
      nullifier?: string;
      results?: Array<{ identifier?: string; success?: boolean; nullifier?: string }>;
    };

    if (!data.success || typeof data.nullifier !== 'string') {
      return { ok: false, error: 'dev_portal_rejected' };
    }
    if (data.action !== WORLD_ACTION) {
      return { ok: false, error: `action_mismatch_${data.action ?? 'missing'}` };
    }
    if (data.environment !== WORLD_ENVIRONMENT) {
      return { ok: false, error: `environment_mismatch_${data.environment ?? 'missing'}` };
    }
    const orbOk = data.results?.some(
      (r) => r.success === true && r.identifier === REQUIRED_VERIFICATION_LEVEL,
    );
    if (!orbOk) {
      return { ok: false, error: 'orb_credential_required' };
    }

    return {
      ok: true,
      nullifier: data.nullifier,
      verification_level: 'orb',
    };
  } catch (err) {
    return { ok: false, error: `network_${(err as Error).message}` };
  }
}
