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
        // TEMP DIAG: surface real error in toast — revert once root cause identified.
        toast.error('NotInWorld');
        return;
      }

      const { finalPayload } = await MiniKit.commandsAsync.verify({
        action: WORLD_ACTION,
        verification_level: VerificationLevel.Orb,
      });

      if (finalPayload.status === 'error') {
        const code = (finalPayload as { error_code?: string }).error_code ?? 'unknown';
        posthog.capture('verify_error', { reason: 'minikit_error', code });
        toast.error(`MK:${code}`);
        return;
      }

      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalPayload as ISuccessResult),
      });

      if (!res.ok) {
        let detail = `${res.status}`;
        try {
          const json = (await res.json()) as { error?: string; detail?: string };
          detail = `${json.error ?? res.status}:${json.detail ?? ''}`.slice(0, 200);
        } catch {
          /* ignore */
        }
        posthog.capture('verify_error', { reason: 'non_200', status: res.status, detail });
        toast.error(`API:${detail}`);
        return;
      }

      posthog.capture('verify_success');
      router.push('/intro');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      posthog.capture('verify_error', { reason: 'thrown', message: msg });
      toast.error(`THROW:${msg.slice(0, 100)}`);
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
