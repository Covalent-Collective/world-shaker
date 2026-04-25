'use client';

import { createContext, useContext, type ReactNode, createElement } from 'react';
import { messages } from './messages';
import type { Lang, MessageKey } from './types';

interface LangContextValue {
  lang: Lang;
}

const LangContext = createContext<LangContextValue>({ lang: 'ko' });

interface LangProviderProps {
  lang: Lang;
  children: ReactNode;
}

/**
 * Wrap your root layout (or a subtree) with LangProvider to make the current
 * locale available to all client components via useT().
 *
 * Usage in layout.tsx (Server Component):
 *   <LangProvider lang={lang}>{children}</LangProvider>
 */
export function LangProvider({ lang, children }: LangProviderProps): ReactNode {
  return createElement(LangContext.Provider, { value: { lang } }, children);
}

/**
 * Client-side translation hook. Reads locale from the nearest LangProvider.
 *
 * Usage:
 *   const t = useT();
 *   t('common.cancel') // => '취소' or 'Cancel'
 */
export function useT(): (key: MessageKey) => string {
  const { lang } = useContext(LangContext);
  const dict = messages[lang];
  return (key: MessageKey) => dict[key];
}
