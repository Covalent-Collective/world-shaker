import 'server-only';

import { SignJWT, jwtVerify } from 'jose';

/**
 * Issue a Supabase-compatible JWT after orb verify succeeds.
 *
 * RLS in supabase/migrations/0002_rls.sql reads the `world_user_id` claim via
 * the public.current_world_user_id() helper. The token must be signed with
 * SUPABASE_JWT_SECRET (the same HS256 secret that Supabase uses to validate
 * JWTs), so passing it to the client as the access_token enables RLS without
 * involving Supabase Auth.
 *
 * Standard claims (`aud='authenticated'`, `role='authenticated'`, `sub`)
 * keep the token interoperable with built-in Supabase server-side checks.
 */

const ALG = 'HS256';
const ISSUER = 'world-shaker';
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getSecret(): Uint8Array {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) throw new Error('SUPABASE_JWT_SECRET missing');
  return new TextEncoder().encode(secret);
}

export interface WorldShakerClaims {
  /** public.users.id — the canonical user identifier in this app. */
  world_user_id: string;
  /** Echo of the World ID nullifier — for audit only. */
  nullifier: string;
}

export async function signWorldUserJwt(
  claims: WorldShakerClaims,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    ...claims,
    role: 'authenticated',
  })
    .setProtectedHeader({ alg: ALG })
    .setIssuer(ISSUER)
    .setAudience('authenticated')
    .setSubject(claims.world_user_id)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(getSecret());
}

export async function verifyWorldUserJwt(token: string): Promise<WorldShakerClaims> {
  const { payload } = await jwtVerify(token, getSecret(), {
    audience: 'authenticated',
    issuer: ISSUER,
  });
  if (typeof payload.world_user_id !== 'string' || typeof payload.nullifier !== 'string') {
    throw new Error('jwt_missing_claims');
  }
  return {
    world_user_id: payload.world_user_id,
    nullifier: payload.nullifier,
  };
}

/** Cookie name used to ship the JWT back to the browser. */
export const SESSION_COOKIE = 'ws_session';
