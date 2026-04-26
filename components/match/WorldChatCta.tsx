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
 * The earlier implementation used a plain `<a href>` to a worldcoin.org
 * universal link with `target="_blank"`. Inside the World App's MiniApp
 * WebView, target=_blank links don't escape the WebView (no popup
 * support), so the click was silently no-op'd from the user's POV.
 *
 * Inside the World App we instead drive the official MiniKit
 * `commandsAsync.chat` command (added in MiniKit 1.x), which opens the
 * World Chat mini app on top of ours with the draft pre-filled. `to`
 * is omitted because we don't yet have the partner's World App
 * username (would require a wallet-auth round-trip + getUserByAddress
 * resolve); the user picks the recipient inside the chat composer.
 *
 * Outside the World App we fall back to the universal link, which
 * Worldcoin's CDN will route to the App Store / web profile depending
 * on the user's environment.
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
      className="w-full max-w-sm rounded-xl bg-foreground text-background py-3 px-6 text-sm font-semibold text-center transition-opacity hover:opacity-80 active:opacity-60 disabled:opacity-50"
    >
      {t('success.world_chat_cta')}
    </button>
  );
}
