import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { messages } from '../messages';
import { getT } from '../getT';
import { useT, LangProvider } from '../useT';
import type { MessageKey } from '../types';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('server-only', () => ({}));

const ALL_KEYS: MessageKey[] = [
  'app_name',
  'common.cancel',
  'common.continue',
  'common.confirm',
  'common.back',
  'quota.tomorrow',
  'conversation.failure_overlay.restart',
  'conversation.failure_overlay.close',
  'badge.verified_human',
];

describe('messages', () => {
  it('has all required keys in ko locale', () => {
    for (const key of ALL_KEYS) {
      expect(messages.ko[key]).toBeTruthy();
    }
  });

  it('has all required keys in en locale', () => {
    for (const key of ALL_KEYS) {
      expect(messages.en[key]).toBeTruthy();
    }
  });

  it('ko and en have same key set', () => {
    const koKeys = Object.keys(messages.ko).sort();
    const enKeys = Object.keys(messages.en).sort();
    expect(koKeys).toEqual(enKeys);
  });

  it('ko locale returns Korean text for common.cancel', () => {
    expect(messages.ko['common.cancel']).toBe('취소');
  });

  it('en locale returns English text for common.cancel', () => {
    expect(messages.en['common.cancel']).toBe('Cancel');
  });

  it('app_name is same in both locales', () => {
    expect(messages.ko['app_name']).toBe('World Shaker');
    expect(messages.en['app_name']).toBe('World Shaker');
  });
});

describe('getT', () => {
  it('returns ko translations when lang=ko is passed explicitly', async () => {
    const t = await getT('ko');
    expect(t('common.cancel')).toBe('취소');
    expect(t('common.continue')).toBe('계속');
  });

  it('returns en translations when lang=en is passed explicitly', async () => {
    const t = await getT('en');
    expect(t('common.cancel')).toBe('Cancel');
    expect(t('common.continue')).toBe('Continue');
  });

  it('falls back to ko when no lang and no cookie', async () => {
    const { cookies } = await import('next/headers');
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue(undefined),
      getAll: vi.fn().mockReturnValue([]),
    } as unknown as Awaited<ReturnType<typeof cookies>>);

    const t = await getT();
    expect(t('common.cancel')).toBe('취소');
  });

  it('uses lang cookie when no explicit lang passed', async () => {
    const { cookies } = await import('next/headers');
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue({ name: 'lang', value: 'en' }),
      getAll: vi.fn().mockReturnValue([{ name: 'lang', value: 'en' }]),
    } as unknown as Awaited<ReturnType<typeof cookies>>);

    const t = await getT();
    expect(t('common.cancel')).toBe('Cancel');
  });
});

describe('copy tone — arcade-gamification anti-patterns', () => {
  const BANNED_WORDS = ['unlock', 'reward', 'streak', 'bonus', 'win', 'level up'];

  it('KR dictionary contains no arcade-gamification words', () => {
    const offending: string[] = [];
    for (const [key, value] of Object.entries(messages.ko)) {
      const lower = value.toLowerCase();
      for (const word of BANNED_WORDS) {
        if (lower.includes(word)) {
          offending.push(`ko["${key}"] contains "${word}": "${value}"`);
        }
      }
    }
    expect(offending).toEqual([]);
  });

  it('EN dictionary contains no arcade-gamification words', () => {
    const offending: string[] = [];
    for (const [key, value] of Object.entries(messages.en)) {
      const lower = value.toLowerCase();
      for (const word of BANNED_WORDS) {
        if (lower.includes(word)) {
          offending.push(`en["${key}"] contains "${word}": "${value}"`);
        }
      }
    }
    expect(offending).toEqual([]);
  });
});

describe('useT', () => {
  it('returns ko translations from LangProvider with lang=ko', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <LangProvider lang="ko">{children}</LangProvider>
    );

    const { result } = renderHook(() => useT(), { wrapper });
    expect(result.current('common.cancel')).toBe('취소');
    expect(result.current('badge.verified_human')).toBe('인증된 인간');
  });

  it('returns en translations from LangProvider with lang=en', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <LangProvider lang="en">{children}</LangProvider>
    );

    const { result } = renderHook(() => useT(), { wrapper });
    expect(result.current('common.cancel')).toBe('Cancel');
    expect(result.current('badge.verified_human')).toBe('Verified Human');
  });

  it('defaults to en without a provider (English is product default)', () => {
    const { result } = renderHook(() => useT());
    expect(result.current('common.cancel')).toBe('Cancel');
  });
});
