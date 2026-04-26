'use client';

import { useT } from '@/lib/i18n/useT';
import { cn } from '@/lib/utils';

interface EncounterEndPopupProps {
  /** Display name of the OTHER agent's owner — e.g. "Sue". */
  partnerName?: string | null;
  onCta?: () => void;
  onDismiss?: () => void;
}

/**
 * EncounterEndPopup — Pokémon-style modal that appears once the encounter
 * playback finishes (revealComplete === true && status === 'completed').
 *
 * Sits above the stage with a soft dim backdrop, anchors a cream-paper card
 * with a gold double-border, and offers two actions:
 *   • Primary: "{name}님과 직접 대화해보기" — the eventual handoff to a
 *     human-to-human conversation. Wired via `onCta` so the parent decides
 *     where it goes (deep link, /match/[id], no-op for the demo, etc.).
 *   • Secondary: "나중에" — dismiss the popup, keep the stage visible.
 *
 * Pure presentation; the parent owns the gating state.
 */
export default function EncounterEndPopup({
  partnerName,
  onCta,
  onDismiss,
}: EncounterEndPopupProps): React.ReactElement {
  const t = useT();
  const safeName = partnerName?.trim() ?? '';
  const hasName = safeName.length > 0;
  const ctaLabel = hasName
    ? t('encounter.endpopup.cta_named').replace('{name}', safeName)
    : t('encounter.endpopup.cta_unnamed');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="encounter complete"
      className="fixed inset-0 z-40 flex items-center justify-center px-6 animate-fade-up"
    >
      {/* Dim + slight blur so the stage stays readable behind */}
      <div
        aria-hidden
        className="absolute inset-0 bg-black/65 backdrop-blur-[2px]"
        onClick={onDismiss}
      />

      {/* Card — cream paper double-border, anchored top-left name plate */}
      <div className="relative w-full max-w-sm">
        <div
          className="absolute -top-3 left-4 px-3 py-1 font-pixel text-[10px] tracking-[0.2em] bg-[#1a1410] text-[#fffaf0]"
          style={{
            boxShadow:
              '2px 0 0 #1a1410, -2px 0 0 #1a1410, 0 -2px 0 #1a1410, 0 2px 0 #1a1410, 4px 4px 0 rgba(0,0,0,0.4)',
          }}
        >
          {t('encounter.endpopup.tag')}
        </div>

        <div
          className="px-1 pt-1 pb-[5px]"
          style={{
            background: '#1a1410',
            boxShadow: '0 12px 36px rgba(0,0,0,0.55)',
          }}
        >
          <div
            className="px-5 py-6"
            style={{
              background: 'linear-gradient(180deg, #fffaf0 0%, #f0e6d2 100%)',
              boxShadow:
                'inset 0 0 0 2px #9c7a4a, inset 0 0 0 4px #fffaf0, inset 0 -1px 0 rgba(0,0,0,0.15)',
            }}
          >
            <h2 className="font-serif text-[20px] leading-tight text-[#1a1410]">
              {t('encounter.endpopup.title')}
            </h2>
            <p className="mt-2 font-serif text-[14px] leading-relaxed text-[#5a4830] whitespace-pre-line">
              {t('encounter.endpopup.body')}
            </p>

            {/* Primary CTA — the human handoff */}
            <button
              type="button"
              onClick={onCta}
              className={cn(
                'mt-5 w-full font-pixel text-[10px] tracking-[0.18em] uppercase',
                'px-4 py-3 transition-transform active:translate-y-[1px]',
              )}
              style={{
                background: '#1a1410',
                color: '#fffaf0',
                boxShadow:
                  'inset 0 -3px 0 rgba(0,0,0,0.45), 0 3px 0 #9c7a4a, 0 6px 12px rgba(0,0,0,0.35)',
              }}
            >
              {ctaLabel}
            </button>

            {/* Secondary dismiss */}
            <button
              type="button"
              onClick={onDismiss}
              className="mt-3 w-full font-serif italic text-[12px] text-[#5a4830] tracking-wide hover:opacity-70 active:opacity-50"
            >
              {t('encounter.endpopup.dismiss')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
