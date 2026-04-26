import 'server-only';

import {
  WORLD_ACTION,
  WORLD_ENVIRONMENT,
  WORLD_RP_ID,
  REQUIRED_VERIFICATION_LEVEL,
} from './constants';

/**
 * Verify a MiniKit `verify` finalPayload (ISuccessResult) against Dev Portal v4.
 *
 * Inside the World App, MiniKit produces a flat v3 ISuccessResult. We wrap it
 * into the v4 endpoint's `responses[]` envelope (the v4 endpoint accepts
 * `protocol_version: "3.0"` bodies for legacy proofs). The action and
 * verification level are reasserted on the response so a proof from a
 * different action / device level cannot be accepted.
 *
 * The new Dev Portal (developer.world.org) registers actions only against
 * the v4 registry, so the legacy v2 endpoint (developer.worldcoin.org/v2)
 * returns "Action not found" for newly-created apps. v4 + RP_ID is the
 * correct path.
 */

const VERIFY_TIMEOUT_MS = 8000;

const ORB_IDENTIFIERS = new Set(['orb', 'proof_of_human']);

export async function verifyWithDevPortal(
  payload: unknown,
): Promise<
  { ok: true; nullifier: string; verification_level: 'orb' } | { ok: false; error: string }
> {
  if (!WORLD_RP_ID) {
    return { ok: false, error: 'rp_id_missing' };
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

  const url = `https://developer.world.org/api/v4/verify/${WORLD_RP_ID}`;
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
      identifier: body.responses[0]?.identifier,
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
    // v4 success response: { success, action, environment, nullifier,
    // results: [{ identifier, success, nullifier }] }.
    const data = (await res.json()) as {
      success?: boolean;
      action?: string;
      environment?: string;
      nullifier?: string;
      results?: Array<{ identifier?: string; success?: boolean; nullifier?: string }>;
    };

    // Log only non-sensitive shape signals — never the nullifier itself.
    console.log(
      '[verify] dev portal success',
      JSON.stringify({
        success: data.success,
        action_match: data.action === WORLD_ACTION,
        environment_match: data.environment === WORLD_ENVIRONMENT,
        result_identifiers: data.results?.map((r) => r.identifier),
        result_success: data.results?.map((r) => r.success),
      }),
    );

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
      (r) =>
        r.success === true && typeof r.identifier === 'string' && ORB_IDENTIFIERS.has(r.identifier),
    );
    if (!orbOk) {
      return {
        ok: false,
        error: `orb_credential_required_${data.results?.[0]?.identifier ?? 'missing'}`,
      };
    }

    return {
      ok: true,
      nullifier: data.nullifier,
      verification_level: REQUIRED_VERIFICATION_LEVEL,
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      return { ok: false, error: 'network_timeout' };
    }
    return { ok: false, error: `network_${(err as Error).message}` };
  }
}
