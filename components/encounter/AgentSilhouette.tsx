import { cn } from '@/lib/utils';

interface AgentSilhouetteProps {
  /** Which side of the stage. 'A' is left-facing-right; 'B' mirrors. */
  side: 'A' | 'B';
  /** Active speaker — head leans inward, halo intensifies. */
  speaking?: boolean;
  /** Distinguishes the two characters by accent without gendering. */
  tint?: 'warm' | 'gold';
}

/**
 * AgentSilhouette — a stylized portrait bust rendered in SVG.
 *
 * Two heads face each other across the stage. Each is a soft 3/4 profile —
 * head, neck, shoulder line, and a single hair-curve. The halo behind the
 * head is a layered radial gradient that pulses faster when speaking.
 *
 * Design intent: NOT photoreal, NOT cartoon. A theatrical silhouette that
 * reads as "a person" without committing to any face — leaves room for
 * the viewer's imagination of their own clone.
 */
export default function AgentSilhouette({
  side,
  speaking = false,
  tint = 'warm',
}: AgentSilhouetteProps): React.ReactElement {
  const haloHex = tint === 'gold' ? '#C9A961' : '#FFB57B';
  const ringHex = tint === 'gold' ? 'rgba(201,169,97,0.55)' : 'rgba(255,181,123,0.55)';
  const flip = side === 'B';

  return (
    <div
      className={cn(
        'relative flex flex-col items-center select-none',
        'transition-transform duration-700 ease-out',
        speaking ? (flip ? '-translate-x-1.5' : 'translate-x-1.5') : '',
      )}
    >
      {/* Halo — soft warm glow behind the head. Pulses with breathe. */}
      <div
        aria-hidden
        className={cn(
          'absolute -top-3 left-1/2 -translate-x-1/2 h-32 w-32 rounded-full blur-2xl',
          speaking ? 'animate-shimmer' : 'animate-breathe',
        )}
        style={{
          background: `radial-gradient(circle at 50% 50%, ${haloHex}66, transparent 70%)`,
        }}
      />

      {/* Faint ring — gilded ornament that catches the spotlight. */}
      <div
        aria-hidden
        className="absolute top-2 left-1/2 -translate-x-1/2 h-24 w-24 rounded-full"
        style={{
          boxShadow: `inset 0 0 0 1px ${ringHex}, 0 0 12px ${ringHex}`,
        }}
      />

      {/* The bust itself — SVG portrait silhouette in 3/4 profile */}
      <svg
        viewBox="0 0 120 140"
        width="112"
        height="130"
        aria-hidden
        className="relative animate-breathe"
        style={{ transform: flip ? 'scaleX(-1)' : undefined }}
      >
        <defs>
          <linearGradient id={`bust-${side}-${tint}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#1f1f2a" />
            <stop offset="60%" stopColor="#14141c" />
            <stop offset="100%" stopColor="#0a0a0f" />
          </linearGradient>
          <linearGradient id={`rim-${side}-${tint}`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor={haloHex} stopOpacity="0" />
            <stop offset="35%" stopColor={haloHex} stopOpacity="0.65" />
            <stop offset="100%" stopColor={haloHex} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Shoulders + neck — wide trapezoid with subtle curve */}
        <path
          d="M 12 138 C 28 110, 36 100, 50 96 L 72 96 C 86 100, 94 110, 110 138 Z"
          fill={`url(#bust-${side}-${tint})`}
        />

        {/* Neck — narrower transition to head */}
        <path
          d="M 50 96 C 50 88, 50 84, 52 78 L 70 78 C 72 84, 72 88, 72 96 Z"
          fill={`url(#bust-${side}-${tint})`}
        />

        {/* Head — slightly narrowed jaw, oval */}
        <path
          d="
            M 38 56
            C 38 36, 50 22, 62 22
            C 76 22, 86 36, 86 56
            C 86 70, 80 80, 72 82
            L 50 82
            C 42 80, 38 70, 38 56 Z
          "
          fill={`url(#bust-${side}-${tint})`}
        />

        {/* Hair curve — single sweeping shape that reads as silhouette form */}
        <path
          d="
            M 36 50
            C 36 28, 52 18, 64 18
            C 80 18, 88 32, 88 48
            C 84 38, 76 30, 64 30
            C 52 30, 42 36, 38 50
            Z
          "
          fill="#0a0a0f"
        />

        {/* Rim light — warm catch on the outer cheek/jaw */}
        <path
          d="
            M 84 36
            C 87 44, 88 54, 86 64
            C 84 70, 80 76, 76 80
            L 76 64
            C 80 58, 82 50, 82 42 Z
          "
          fill={`url(#rim-${side}-${tint})`}
          opacity="0.85"
        />

        {/* Tiny eye glint — single dot for life. */}
        <circle cx="74" cy="54" r="1.5" fill="#f4ece2" opacity="0.85" />
      </svg>

      {/* Floor shadow — anchors the figure to the stage. */}
      <div aria-hidden className="mt-1 h-1.5 w-20 rounded-full bg-black/60 blur-sm" />
    </div>
  );
}
