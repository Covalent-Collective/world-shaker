'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MiniKit, VerificationLevel } from '@worldcoin/minikit-js';
import type { ISuccessResult } from '@worldcoin/minikit-js';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n/useT';
import { posthog } from '@/lib/posthog/client';
import VerifiedHumanBadge from '@/components/world/VerifiedHumanBadge';

interface DebugState {
  clicks: number;
  installed: boolean | null;
  lastStep: string;
  lastError: string;
}

export default function VerifyPage(): React.ReactElement {
  const t = useT();
  const router = useRouter();
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dbg, setDbg] = useState<DebugState>({
    clicks: 0,
    installed: null,
    lastStep: 'idle',
    lastError: '',
  });

  useEffect(() => {
    // SSR-safe one-shot probe of the MiniKit injection state. Debug pane only.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDbg((s) => ({ ...s, installed: MiniKit.isInstalled() }));
  }, []);

  const handleVerify = async (): Promise<void> => {
    setDbg((s) => ({ ...s, clicks: s.clicks + 1, lastStep: 'click', lastError: '' }));
    setBusy(true);
    try {
      const installed = MiniKit.isInstalled();
      setDbg((s) => ({ ...s, installed, lastStep: 'isInstalled-checked' }));
      if (!installed) {
        toast.error('Not in World App');
        return;
      }

      const action = process.env.NEXT_PUBLIC_WORLD_ACTION as string;
      setDbg((s) => ({ ...s, lastStep: `calling-verify(${action})` }));
      const { finalPayload } = await MiniKit.commandsAsync.verify({
        action,
        verification_level: VerificationLevel.Orb,
      });
      setDbg((s) => ({
        ...s,
        lastStep: `payload-status-${finalPayload.status}`,
      }));

      if (finalPayload.status === 'error') {
        const code = (finalPayload as { error_code?: string }).error_code ?? 'unknown';
        setDbg((s) => ({ ...s, lastError: `MiniKit:${code}` }));
        posthog.capture('verify_error', { reason: 'minikit_error', code });
        toast.error(`MiniKit: ${code}`);
        return;
      }

      setDbg((s) => ({ ...s, lastStep: 'fetching-/api/verify' }));
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalPayload as ISuccessResult),
      });

      if (res.ok) {
        setVerified(true);
        setDbg((s) => ({ ...s, lastStep: 'success-redirect' }));
        posthog.capture('verify_success');
        router.push('/intro');
      } else {
        let detail = `${res.status}`;
        try {
          const json = (await res.json()) as { error?: string; detail?: string };
          detail = `${json.error ?? res.status}: ${json.detail ?? ''}`.slice(0, 240);
        } catch {
          // ignore
        }
        setDbg((s) => ({ ...s, lastError: `Server:${detail}` }));
        posthog.capture('verify_error', { reason: 'non_200', status: res.status });
        toast.error(`Server: ${detail}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setDbg((s) => ({ ...s, lastError: `throw:${msg}` }));
      posthog.capture('verify_error', { reason: 'thrown', message: msg });
      toast.error(`Threw: ${msg.slice(0, 200)}`);
    } finally {
      setBusy(false);
      setDbg((s) => ({ ...s, lastStep: `done (busy=false)` }));
    }
  };

  return (
    <main className="min-h-dvh flex items-center justify-center p-6">
      <div className="max-w-sm w-full text-center space-y-6">
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

        {/* DEBUG pane — remove once verify is stable. */}
        <pre className="text-[10px] text-left text-text-2 bg-black/40 rounded-md p-3 leading-tight whitespace-pre-wrap break-all">
          {`clicks: ${dbg.clicks}
installed: ${dbg.installed === null ? '?' : dbg.installed}
busy: ${busy}
step: ${dbg.lastStep}
err: ${dbg.lastError || '-'}`}
        </pre>
      </div>
    </main>
  );
}
