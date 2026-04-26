'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface TitleCardProps {
  label: string;
  subtitle: string;
  /** Total time the card is visible before fading out. ms. */
  durationMs?: number;
  onDone?: () => void;
}

/**
 * TitleCard — old-film opening title. Black void, gold serif label
 * fading in for ~1.4s, sits for 1.0s, fades out for 0.7s. Then unmounts
 * and the stage curtain rises.
 *
 * Used once at the top of an encounter to set the theatrical frame.
 */
export default function TitleCard({
  label,
  subtitle,
  durationMs = 3100,
  onDone,
}: TitleCardProps): React.ReactElement | null {
  const [phase, setPhase] = useState<'in' | 'hold' | 'out' | 'done'>('in');

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('hold'), 1400);
    const t2 = setTimeout(() => setPhase('out'), durationMs - 700);
    const t3 = setTimeout(() => {
      setPhase('done');
      onDone?.();
    }, durationMs);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [durationMs, onDone]);

  if (phase === 'done') return null;

  return (
    <div
      aria-hidden
      className={cn(
        'fixed inset-0 z-40 flex flex-col items-center justify-center bg-bg',
        'transition-opacity',
        phase === 'in' && 'opacity-100 duration-[1400ms]',
        phase === 'hold' && 'opacity-100',
        phase === 'out' && 'opacity-0 duration-700',
      )}
    >
      {/* Hairline gold rule above the label — old-cinema typesetting */}
      <div className="h-px w-12 bg-accent-gold/70" />

      <div className="mt-5 font-serif italic text-accent-gold text-sm tracking-[0.4em] uppercase">
        {label}
      </div>

      <div className="mt-4 font-serif text-text text-2xl leading-tight text-center px-8 max-w-xs">
        {subtitle}
      </div>

      <div className="mt-5 h-px w-12 bg-accent-gold/70" />
    </div>
  );
}
