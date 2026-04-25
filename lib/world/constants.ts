/**
 * World ID action — fixed at deployment time.
 *
 * IMPORTANT: This string scopes the nullifier. Same human + same action = same
 * nullifier across all sessions. Changing this value after launch invalidates
 * all existing user accounts (they would all need to re-register and would be
 * issued NEW nullifiers).
 *
 * Decision log: see /Users/jyong/projects/.omc/specs/deep-interview-cupid-proxy-product-v3.md
 */
export const WORLD_ACTION = process.env.NEXT_PUBLIC_WORLD_ACTION ?? 'create-profile';

export const WORLD_APP_ID = process.env.NEXT_PUBLIC_WORLD_APP_ID ?? '';
export const WORLD_RP_ID = process.env.WORLD_RP_ID ?? '';
export const WORLD_ENVIRONMENT = (process.env.NEXT_PUBLIC_WORLD_ENVIRONMENT ?? 'staging') as
  | 'staging'
  | 'production';

/** Required verification level. Static — orb only. Device level rejected. */
export const REQUIRED_VERIFICATION_LEVEL = 'orb' as const;
