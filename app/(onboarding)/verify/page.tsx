'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IDKitRequestWidget, orbLegacy } from '@worldcoin/idkit';
import type { IDKitErrorCodes, IDKitResult } from '@worldcoin/idkit';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n/useT';
import { posthog } from '@/lib/posthog/client';
import VerifiedHumanBadge from '@/components/world/VerifiedHumanBadge';

export default function VerifyPage(): React.ReactElement {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [verified, setVerified] = useState(false);

  const handleSuccess = async (result: IDKitResult): Promise<void> => {
    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result),
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
    }
  };

  const handleError = (errorCode: IDKitErrorCodes): void => {
    posthog.capture('verify_error', { reason: 'idkit', code: errorCode });
    toast.error(t('verify.error_toast'));
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

        {/* IDKitRequestWidget renders the QR/modal; open state is controlled externally */}
        <IDKitRequestWidget
          app_id={process.env.NEXT_PUBLIC_WORLD_APP_ID as `app_${string}`}
          action={process.env.NEXT_PUBLIC_WORLD_ACTION as string}
          preset={orbLegacy()}
          allow_legacy_proofs={true}
          // rp_context is populated at runtime by the World App bridge;
          // cast needed because the type requires server-signed values we
          // cannot generate client-side at build time.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          rp_context={undefined as any}
          open={open}
          onOpenChange={setOpen}
          onSuccess={handleSuccess}
          onError={handleError}
        />

        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full rounded-xl bg-foreground text-background py-3 px-6 text-sm font-semibold transition-opacity hover:opacity-80 active:opacity-60"
        >
          {t('verify.cta')}
        </button>
      </div>
    </main>
  );
}
