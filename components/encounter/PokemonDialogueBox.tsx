'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface PokemonDialogueBoxProps {
  speaker: 'A' | 'B' | null;
  /** Display name of the current speaker — usually each agent's q0_name
   *  (e.g. "bigJY"). When null, falls back to the legacy "AGENT A/B" plate. */
  speakerName?: string | null;
  text: string;
  /** Drives the typewriter rate. Lower = faster. */
  charIntervalMs?: number;
  /** When true, the ▼ next-indicator pulses, signalling the turn is settled. */
  awaitingNext?: boolean;
  /** Tap anywhere on the box to skip the typewriter to the end. */
  onSkip?: () => void;
}

/**
 * PokemonDialogueBox — bottom-of-screen dialogue panel modelled on the
 * Pokémon Gen-2 textbox: cream-paper fill, double border with a darker
 * outer line and a thinner gold inner rule, sharp corners, name plate tab
 * floating above the top-left edge, and a blinking ▼ indicator at the
 * bottom-right when the line is settled.
 *
 * Text fills via a typewriter (one glyph per `charIntervalMs`) so each turn
 * arriving from SSE has a felt pacing rather than snapping in. Tapping the
 * panel skips the typewriter to the end.
 */
export default function PokemonDialogueBox({
  speaker,
  speakerName,
  text,
  charIntervalMs = 28,
  awaitingNext = false,
  onSkip,
}: PokemonDialogueBoxProps): React.ReactElement {
  const [shown, setShown] = useState('');
  const targetRef = useRef(text);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset + retype whenever the underlying turn text changes.
  //
  // The synchronous `setShown('')` reset on each text change is intentional:
  // a typewriter MUST clear before it can re-type. The cascading render lint
  // rule is a generic guardrail aimed at deriving-state-from-props mistakes,
  // which this isn't.
  useEffect(() => {
    targetRef.current = text;
    if (timerRef.current) clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- typewriter restart on text-prop change
    setShown('');

    if (!text) return;

    let i = 0;
    timerRef.current = setInterval(() => {
      i += 1;
      setShown(text.slice(0, i));
      if (i >= text.length && timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }, charIntervalMs);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [text, charIntervalMs]);

  const isComplete = shown.length === text.length && text.length > 0;

  const handleTap = (): void => {
    if (!isComplete) {
      // Snap to the end on first tap.
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      setShown(targetRef.current);
      return;
    }
    onSkip?.();
  };

  // Plate text: speaker's chosen name (q0_name) when available, else fall
  // back to the legacy AGENT A/B label. Trimmed at 14 chars so longer
  // handles don't overflow the pixel-styled tab.
  const cleanName = (speakerName ?? '').trim();
  const fallbackLabel = speaker === 'A' ? 'AGENT  A' : speaker === 'B' ? 'AGENT  B' : '— —';
  const speakerLabel = cleanName.length > 0 ? cleanName.slice(0, 14) : fallbackLabel;
  const speakerColor =
    speaker === 'A'
      ? 'bg-[#c0413a] text-[#fffaf0]'
      : speaker === 'B'
        ? 'bg-[#c9a455] text-[#1a1410]'
        : 'bg-[#3a2418] text-[#fffaf0]';

  return (
    <div
      role="region"
      aria-label="dialogue"
      onClick={handleTap}
      className="relative w-full animate-dialog-slide-up cursor-pointer"
    >
      {/* Name plate — floats above the top-left edge of the box */}
      <div
        className={cn(
          'absolute -top-3 left-4 px-3 py-1 font-pixel text-[10px] tracking-[0.2em]',
          speakerColor,
        )}
        style={{
          boxShadow:
            '2px 0 0 #1a1410, -2px 0 0 #1a1410, 0 -2px 0 #1a1410, 0 2px 0 #1a1410, 4px 4px 0 rgba(0,0,0,0.35)',
        }}
      >
        {speakerLabel}
      </div>

      {/* Outer dark border via padding + inner gold rule via a nested div */}
      <div
        className="px-1 pt-1 pb-[5px]"
        style={{
          background: '#1a1410',
          boxShadow: '0 -8px 24px rgba(0,0,0,0.55)',
        }}
      >
        <div
          className="px-4 py-4 pb-6 min-h-[150px]"
          style={{
            background: 'linear-gradient(180deg, #fffaf0 0%, #f0e6d2 100%)',
            boxShadow:
              'inset 0 0 0 2px #9c7a4a, inset 0 0 0 4px #fffaf0, inset 0 -1px 0 rgba(0,0,0,0.15)',
          }}
        >
          {/* Body text — Korean serif reads at this size; mono fallback for
              latin so it still feels typewritten when EN locale is on. */}
          <p className="font-serif text-[15px] leading-relaxed text-[#1a1410] whitespace-pre-wrap">
            {shown}
            {/* Inline cursor while typing */}
            {!isComplete && (
              <span className="ml-0.5 inline-block h-[14px] w-[2px] -translate-y-[1px] bg-[#1a1410] align-middle animate-blink" />
            )}
          </p>

          {/* ▼ next indicator */}
          <div
            className={cn(
              'absolute right-5 bottom-3 font-pixel text-[10px] text-[#1a1410]',
              isComplete && awaitingNext ? 'animate-blink' : 'opacity-0',
            )}
          >
            ▼
          </div>
        </div>
      </div>
    </div>
  );
}
