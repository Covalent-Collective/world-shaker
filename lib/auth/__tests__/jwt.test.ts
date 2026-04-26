// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  signWorldUserJwt,
  verifyWorldUserJwt,
  parseLanguagePref,
  type WorldShakerClaims,
} from '../jwt';

// ─── parseLanguagePref ────────────────────────────────────────────────────────

describe('parseLanguagePref', () => {
  it('returns ko for ko-KR', () => {
    expect(parseLanguagePref('ko-KR,ko;q=0.9')).toBe('ko');
  });

  it('returns ko for plain ko', () => {
    expect(parseLanguagePref('ko')).toBe('ko');
  });

  it('returns en for en-US', () => {
    expect(parseLanguagePref('en-US,en;q=0.9')).toBe('en');
  });

  it('returns en for plain en', () => {
    expect(parseLanguagePref('en')).toBe('en');
  });

  it('defaults to en for null', () => {
    expect(parseLanguagePref(null)).toBe('en');
  });

  it('defaults to en for empty string', () => {
    expect(parseLanguagePref('')).toBe('en');
  });

  it('defaults to en for unsupported language (fr)', () => {
    expect(parseLanguagePref('fr-FR,fr;q=0.9')).toBe('en');
  });

  it('is case-insensitive (KO-KR)', () => {
    expect(parseLanguagePref('KO-KR')).toBe('ko');
  });

  it('is case-insensitive (EN-US)', () => {
    expect(parseLanguagePref('EN-US')).toBe('en');
  });
});

// ─── JWT round-trip ───────────────────────────────────────────────────────────

const BASE_CLAIMS: WorldShakerClaims = {
  world_user_id: 'user-abc-123',
  nullifier: 'nullifier-xyz-456',
  language_pref: 'ko',
};

describe('signWorldUserJwt / verifyWorldUserJwt round-trip', () => {
  it('round-trips without language_pref (defaults to ko)', async () => {
    const token = await signWorldUserJwt(BASE_CLAIMS);
    const verified = await verifyWorldUserJwt(token);

    expect(verified.world_user_id).toBe(BASE_CLAIMS.world_user_id);
    expect(verified.nullifier).toBe(BASE_CLAIMS.nullifier);
    expect(verified.language_pref).toBe('ko');
  });

  it('round-trips with language_pref=ko', async () => {
    const claims: WorldShakerClaims = { ...BASE_CLAIMS, language_pref: 'ko' };
    const token = await signWorldUserJwt(claims);
    const verified = await verifyWorldUserJwt(token);

    expect(verified.world_user_id).toBe(BASE_CLAIMS.world_user_id);
    expect(verified.nullifier).toBe(BASE_CLAIMS.nullifier);
    expect(verified.language_pref).toBe('ko');
  });

  it('round-trips with language_pref=en', async () => {
    const claims: WorldShakerClaims = { ...BASE_CLAIMS, language_pref: 'en' };
    const token = await signWorldUserJwt(claims);
    const verified = await verifyWorldUserJwt(token);

    expect(verified.world_user_id).toBe(BASE_CLAIMS.world_user_id);
    expect(verified.nullifier).toBe(BASE_CLAIMS.nullifier);
    expect(verified.language_pref).toBe('en');
  });

  it('defaults missing language_pref claim to ko', async () => {
    // Sign without language_pref
    const token = await signWorldUserJwt(BASE_CLAIMS);
    const verified = await verifyWorldUserJwt(token);

    // verifyWorldUserJwt now always populates language_pref
    expect(verified.language_pref).toBe('ko');
  });

  it('rejects a tampered token', async () => {
    const token = await signWorldUserJwt(BASE_CLAIMS);
    const tampered = token.slice(0, -4) + 'XXXX';
    await expect(verifyWorldUserJwt(tampered)).rejects.toThrow();
  });
});
