import type { Metadata, Viewport } from 'next';
import { Inter, Crimson_Pro, Noto_Serif_KR, Press_Start_2P } from 'next/font/google';
import { cookies, headers } from 'next/headers';
import './globals.css';
import { Providers } from './providers';
import { Toaster } from '@/components/ui/sonner';
import { LangProvider } from '@/lib/i18n/useT';
import type { Lang } from '@/lib/i18n/types';
import { parseLanguagePref } from '@/lib/auth/jwt';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-inter',
});

const crimsonPro = Crimson_Pro({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-crimson',
});

const notoSerifKR = Noto_Serif_KR({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-noto-serif-kr',
});

const pressStart = Press_Start_2P({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-press-start',
});

export const metadata: Metadata = {
  title: 'World Shaker',
  description: 'Verified humans. Real meetings.',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0A0A0F',
};

function isLang(value: string | undefined): value is Lang {
  return value === 'ko' || value === 'en';
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const rawLang = cookieStore.get('lang')?.value;
  // Priority: explicit `lang` cookie (set by /api/user/language) → Accept-Language
  // header (device/browser locale) → 'en' default (parseLanguagePref). English
  // is the product default for unknown locales; ko users still get ko via the
  // header path.
  let lang: Lang;
  if (isLang(rawLang)) {
    lang = rawLang;
  } else {
    const headerStore = await headers();
    lang = parseLanguagePref(headerStore.get('accept-language'));
  }

  return (
    <html
      lang={lang}
      className={`dark ${inter.variable} ${crimsonPro.variable} ${notoSerifKR.variable} ${pressStart.variable}`}
    >
      <body className="bg-bg text-text font-sans antialiased">
        <LangProvider lang={lang}>
          <Providers>{children}</Providers>
        </LangProvider>
        <Toaster />
      </body>
    </html>
  );
}
