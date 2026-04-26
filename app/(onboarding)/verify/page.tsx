'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MiniKit, VerificationLevel } from '@worldcoin/minikit-js';
import type { ISuccessResult } from '@worldcoin/minikit-js';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n/useT';
import { posthog } from '@/lib/posthog/client';
import { WORLD_ACTION } from '@/lib/world/constants';
import VerifiedHumanBadge from '@/components/world/VerifiedHumanBadge';

export default function VerifyPage(): React.ReactElement {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const handleVerify = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      if (!MiniKit.isInstalled()) {
        posthog.capture('verify_error', { reason: 'not_in_world_app' });
        toast.error(t('verify.error_toast'));
        return;
      }

      const { finalPayload } = await MiniKit.commandsAsync.verify({
        action: WORLD_ACTION,
        verification_level: VerificationLevel.Orb,
      });

      if (finalPayload.status === 'error') {
        posthog.capture('verify_error', {
          reason: 'minikit_error',
          code: (finalPayload as { error_code?: string }).error_code,
        });
        toast.error(t('verify.error_toast'));
        return;
      }

      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalPayload as ISuccessResult),
      });

      if (!res.ok) {
        posthog.capture('verify_error', { reason: 'non_200', status: res.status });
        toast.error(t('verify.error_toast'));
        return;
      }

      posthog.capture('verify_success');
      router.push('/intro');
    } catch (err) {
      posthog.capture('verify_error', {
        reason: 'thrown',
        message: err instanceof Error ? err.message : String(err),
      });
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
          <VerifiedHumanBadge variant="compact" />
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
