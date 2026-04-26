'use client';

import { useState } from 'react';
import { MiniKit } from '@worldcoin/minikit-js';

import { useT } from '@/lib/i18n/useT';

interface WorldChatCtaProps {
  /** Partner's display name (q0_name); used to seed the chat draft. */
  partnerName?: string | null;
  /** Partner's actual World App username (captured from MiniKit.user at
   *  page load and persisted on the partner's agent). When present, this
   *  resolves to a real recipient inside the World Chat composer. */
  partnerWorldUsername?: string | null;
  /** Universal-link fallback when MiniKit is unavailable (i.e. the user
   *  is browsing this page outside the World App, on a regular browser). */
  fallbackUrl?: string;
}

/**
 * WorldChatCta — handoff button that drops the user into the World Chat
 * mini app with a draft message ready to send.
 *
 * Uses MiniKit `commandsAsync.chat` inside the World App (target=_blank
 * universal links don't escape the MiniApp WebView). Falls back to the
 * universal link for browser-based viewers.
 */
export default function WorldChatCta({
  partnerName,
  partnerWorldUsername,
  fallbackUrl,
}: WorldChatCtaProps): React.ReactElement {
  const t = useT();
  const [busy, setBusy] = useState(false);

  const handleClick = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const displayName = partnerName?.trim() ?? '';
    const worldUsername = partnerWorldUsername?.trim() ?? '';
    const message = displayName
      ? `Hey ${displayName} — saw our agents click. Up for a real chat?`
      : 'Saw our agents click. Up for a real chat?';

    try {
      if (MiniKit.isInstalled()) {
        // Recipient resolution preference:
        //   1. Partner's actual World App username (captured at page-load
        //      via MiniKit.user → /api/user/world-profile). Resolves to a
        //      real handle in the Select Conversations sheet.
        //   2. Partner's q0_name display name as a soft fallback. Almost
        //      never matches a real World App handle, but lets the user
        //      see who the chat is meant for.
        //   3. undefined → composer opens unaddressed and the user picks.
        const candidate = worldUsername.length > 0 ? worldUsername : displayName;
        const to = candidate.length > 0 ? [candidate] : undefined;
        const result = await MiniKit.commandsAsync.chat({ to, message });
        if (result.finalPayload.status === 'success') {
          // World Chat composer took over; the World App handles the rest.
          // Nothing more for this view to do — leave busy so the button
          // stays visually pressed if the user comes back.
          return;
        }
        // Soft failure: the user closed the composer / picked no recipient.
        // Fall through to the fallback only if we have one; otherwise just
        // re-enable the button.
      }
    } catch (err) {
      console.error('[world-chat-cta] MiniKit chat command failed', err);
    }

    if (fallbackUrl) {
      window.location.href = fallbackUrl;
      return;
    }

    setBusy(false);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      aria-busy={busy}
      className="group relative w-full max-w-sm overflow-hidden rounded-full px-7 py-4 bg-gradient-to-r from-accent-gold via-amber-400 to-accent-ember text-zinc-900 text-base font-semibold tracking-wide shadow-[0_10px_30px_-8px_rgba(255,138,76,0.55)] ring-1 ring-white/20 transition-transform duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_40px_-8px_rgba(255,138,76,0.75)] active:translate-y-0 active:scale-[0.98] disabled:opacity-70 disabled:hover:translate-y-0 disabled:cursor-not-allowed"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full"
      />
      <span className="relative flex items-center justify-center gap-2.5">
        <span>{t('success.world_chat_cta')}</span>
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="transition-transform duration-200 ease-out group-hover:translate-x-0.5"
        >
          <path d="M22 2 11 13" />
          <path d="m22 2-7 20-4-9-9-4z" />
        </svg>
      </span>
    </button>
  );
}
