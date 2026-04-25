import 'server-only';

import { cookies } from 'next/headers';
import { messages } from './messages';
import type { Lang, MessageKey } from './types';

function isLang(value: unknown): value is Lang {
  return value === 'ko' || value === 'en';
}

/**
 * Server-side translation helper. Reads the `lang` cookie as the default
 * locale when no explicit lang is passed. Falls back to 'ko'.
 *
 * Usage in Server Components / Route Handlers:
 *   const t = await getT();
 *   t('common.cancel') // => '취소'
 */
export async function getT(lang?: Lang): Promise<(key: MessageKey) => string> {
  let resolved: Lang = 'ko';

  if (lang !== undefined) {
    resolved = lang;
  } else {
    const cookieStore = await cookies();
    const cookie = cookieStore.get('lang');
    if (cookie && isLang(cookie.value)) {
      resolved = cookie.value;
    }
  }

  const dict = messages[resolved];
  return (key: MessageKey) => dict[key];
}
