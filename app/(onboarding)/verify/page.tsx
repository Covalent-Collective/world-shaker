'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MiniKit, VerificationLevel } from '@worldcoin/minikit-js';
import type { ISuccessResult } from '@worldcoin/minikit-js';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n/useT';
import { posthog } from '@/lib/posthog/client';
import VerifiedHumanBadge from '@/components/world/VerifiedHumanBadge';

export default function VerifyPage(): React.ReactElement {
  const t = useT();
  const router = useRouter();
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleVerify = async (): Promise<void> => {
    setBusy(true);
    try {
      if (!MiniKit.isInstalled()) {
        posthog.capture('verify_error', { reason: 'not_in_world_app' });
        toast.error(t('verify.error_toast'));
        return;
      }

      const action = process.env.NEXT_PUBLIC_WORLD_ACTION as string;
      const { finalPayload } = await MiniKit.commandsAsync.verify({
        action,
        verification_level: VerificationLevel.Orb,
      });

      if (finalPayload.status === 'error') {
        posthog.capture('verify_error', {
          reason: 'minikit_error',
          code: finalPayload.error_code,
        });
        toast.error(t('verify.error_toast'));
        return;
      }

      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalPayload as ISuccessResult),
      });

      if (res.ok) {
        setVerified(true);
        posthog.capture('verify_success');
        router.push('/intro');
      } else {
        posthog.capture('verify_error', { reason: 'non_200', status: res.status });
        toast.error(t('verify.error_toast'));
      }
    } catch {
      posthog.capture('verify_error', { reason: 'network' });
      toast.error(t('verify.error_toast'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-dvh flex items-center justify-center p-6">
      <div className="max-w-sm w-full text-center space-y-8">
        <div className="space-y-3">
          <h1 className="font-serif text-3xl leading-tight">{t('verify.title')}</h1>
          <p className="text-text-2 text-sm">{t('verify.subtitle')}</p>
        </div>

        <div className="flex justify-center">
          <VerifiedHumanBadge variant={verified ? 'full' : 'compact'} />
        </div>

        <button
          type="button"
          onClick={handleVerify}
          disabled={busy}
          className="w-full rounded-xl bg-foreground text-background py-3 px-6 text-sm font-semibold transition-opacity hover:opacity-80 active:opacity-60 disabled:opacity-50"
        >
          {t('verify.cta')}
        </button>
      </div>
    </main>
  );
}
