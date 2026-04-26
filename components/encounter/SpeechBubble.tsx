import { cn } from '@/lib/utils';

interface SpeechBubbleProps {
  speaker: 'A' | 'B';
  text: string;
  /** Stagger reveals — caller increments by 80ms per bubble. */
  delayMs?: number;
}

/**
 * SpeechBubble — paper-textured dialogue bubble.
 *
 * Each turn is its own bubble. Side A bubbles stack on the left
 * column with a warm-cream paper texture. Side B bubbles stack on the
 * right with a gold-edged variant — distinguishes voices without
 * relying on color alone.
 *
 * The little tail near the speaker's silhouette is a CSS triangle
 * built from a clipped square, scaled to feel hand-cut rather than
 * geometric.
 */
export default function SpeechBubble({
  speaker,
  text,
  delayMs = 0,
}: SpeechBubbleProps): React.ReactElement {
  const isA = speaker === 'A';

  return (
    <div
      className={cn(
        'flex w-full animate-bubble-pop opacity-0',
        isA ? 'justify-start pl-1 pr-10' : 'justify-end pl-10 pr-1',
      )}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="relative max-w-[82%]">
        {/* Speaker tag — italic gold serif marker tucked near the bubble */}
        <div
          className={cn(
            'absolute -top-3 font-serif italic text-[10px] tracking-widest text-accent-gold',
            isA ? 'left-3' : 'right-3',
          )}
        >
          {isA ? '·  A' : 'B  ·'}
        </div>

        <div
          className={cn(
            'rounded-[18px] px-4 py-3 text-[15px] leading-relaxed font-serif',
            isA ? 'bubble-paper rounded-tl-md' : 'bubble-paper-gold rounded-tr-md',
          )}
        >
          {text}
        </div>

        {/* Tail — small triangle anchored to the speaker's side */}
        <div
          aria-hidden
          className={cn(
            'absolute top-3 h-3 w-3 rotate-45',
            isA
              ? 'left-[-5px] bg-[#f4ece2]'
              : 'right-[-5px] bg-[#e8dcc4] border-r border-b border-accent-gold/55',
          )}
        />
      </div>
    </div>
  );
}
