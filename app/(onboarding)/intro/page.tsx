'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { posthog } from '@/lib/posthog/client';
import { useT } from '@/lib/i18n/useT';

export default function IntroPage(): React.JSX.Element {
  const [showSkip, setShowSkip] = useState(false);
  const router = useRouter();
  const t = useT();

  useEffect(() => {
    const timer = setTimeout(() => setShowSkip(true), 5000);
    return () => clearTimeout(timer);
  }, []);

  function handleComplete(): void {
    posthog.capture('onboarding_video_completed');
    router.push('/interview');
  }

  return (
    <main className="relative flex h-screen w-full items-center justify-center bg-black">
      <h1 className="sr-only">{t('intro.title')}</h1>
      <video
        src="/intro.mp4"
        autoPlay
        playsInline
        className="h-full w-full object-cover"
        onEnded={handleComplete}
      />
      {showSkip && (
        <button
          type="button"
          onClick={handleComplete}
          className="absolute bottom-8 right-6 rounded-full bg-white/20 px-5 py-2 text-sm font-medium text-white backdrop-blur-sm transition hover:bg-white/30"
        >
          {t('intro.skip')}
        </button>
      )}
    </main>
  );
}
