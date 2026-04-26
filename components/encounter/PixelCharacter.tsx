import { cn } from '@/lib/utils';

interface PixelCharacterProps {
  /** Left side (A) walks in from the left and gets the warm palette;
   *  right side (B) walks in from the right and gets the cool/gold palette. */
  side: 'A' | 'B';
  /** True during the walk-in phase — drives the walk bob animation. After
   *  the seat-arrival timeline finishes, idle bob takes over. */
  walking?: boolean;
  /** True when this character is the active speaker — adds halo + lift. */
  speaking?: boolean;
}

const PX = 4; // SVG units per pixel block
const COLS = 14;
const ROWS = 22;

// Single shared pixel grid for both characters. Cell letters reference a
// per-side palette so we can recolour without redrawing. Spaces (' ') are
// transparent. The drawing is intentionally chunky and slightly asymmetric
// so each frame still reads at ~80px wide on a phone.
//
// Legend:  H=hair  S=skin  E=eye  M=mouth  B=shirt  P=pants  F=shoe
//          Z=hair-shade (back of head)
//          R=shirt-shade (under-arm)
const PIXELS: string[] = [
  '    HHHHHH    ',
  '   HHHHHHHH   ',
  '  HHHHHHHHHH  ',
  '  HZZHHHHHHHH ',
  '  HSSSSSSSSSH ',
  '  HSESSSSESH H',
  '   SSSSSSSS   ',
  '    SSMMSS    ',
  '     SSSS     ',
  '    SSSSSS    ',
  '   SBBBBBBS   ',
  '  SBBBBBBBBS  ',
  ' SBBBBBBBBBBS ',
  ' SBBRBBBBRBBS ',
  '  BBBBBBBBBB  ',
  '   BBBBBBBB   ',
  '   PPPPPPPP   ',
  '   PPP  PPP   ',
  '   PPP  PPP   ',
  '   PPP  PPP   ',
  '   FFF  FFF   ',
  '   FFF  FFF   ',
];

interface Palette {
  H: string;
  Z: string;
  S: string;
  E: string;
  M: string;
  B: string;
  R: string;
  P: string;
  F: string;
}

const PAL_A: Palette = {
  // Warm — auburn hair, deep cinnabar shirt
  H: '#7d3a1c',
  Z: '#5a2a14',
  S: '#f3d3a8',
  E: '#1a1410',
  M: '#5a2a14',
  B: '#c0413a',
  R: '#902f2c',
  P: '#3a4862',
  F: '#1a1410',
};

const PAL_B: Palette = {
  // Cool — ink-dark hair, gold shirt
  H: '#1f1a18',
  Z: '#0d0a08',
  S: '#f3d3a8',
  E: '#1a1410',
  M: '#3a2818',
  B: '#c9a455',
  R: '#9a7c38',
  P: '#3a4862',
  F: '#1a1410',
};

/**
 * PixelCharacter — chunky 14×22 pixel-art bust drawn entirely in SVG <rect>s.
 *
 * Two palettes (A warm, B cool/gold) share the same outline so the pair reads
 * as the same world but distinct people. The walk/idle/speaking states are
 * applied to the wrapper, not the SVG, so the animation library never needs
 * to remount the rect tree.
 */
export default function PixelCharacter({
  side,
  walking = false,
  speaking = false,
}: PixelCharacterProps): React.ReactElement {
  const palette = side === 'A' ? PAL_A : PAL_B;
  const flip = side === 'B';

  const cellsForLetter = (letter: keyof Palette): React.ReactElement[] => {
    const out: React.ReactElement[] = [];
    for (let r = 0; r < ROWS; r++) {
      const row = PIXELS[r] ?? '';
      for (let c = 0; c < COLS; c++) {
        if (row[c] === letter) {
          out.push(
            <rect key={`${letter}-${r}-${c}`} x={c * PX} y={r * PX} width={PX} height={PX} />,
          );
        }
      }
    }
    return out;
  };

  return (
    <div
      className={cn(
        'relative pointer-events-none select-none',
        walking ? 'animate-walk-bob' : 'animate-idle-bob',
        speaking && 'z-10',
      )}
      style={{ width: COLS * PX, height: ROWS * PX }}
    >
      {/* Soft warm halo for the active speaker */}
      {speaking && (
        <div
          aria-hidden
          className="absolute -inset-3 rounded-full blur-md animate-speaker-halo"
          style={{ background: 'radial-gradient(circle, rgba(255,217,168,0.85), transparent 70%)' }}
        />
      )}

      {/* Floor shadow — flattens during walk-bob, stable during idle */}
      <div
        aria-hidden
        className="absolute left-1/2 -translate-x-1/2 -bottom-2 h-1.5 w-[78%] rounded-full bg-black/55 blur-[2px]"
      />

      <svg
        viewBox={`0 0 ${COLS * PX} ${ROWS * PX}`}
        width={COLS * PX}
        height={ROWS * PX}
        shapeRendering="crispEdges"
        style={{ transform: flip ? 'scaleX(-1)' : undefined }}
        className="relative"
      >
        {/* Drop shadow under the pixel rects to give the bust weight */}
        <g style={{ fill: palette.Z }}>{cellsForLetter('Z')}</g>
        <g style={{ fill: palette.H }}>{cellsForLetter('H')}</g>
        <g style={{ fill: palette.S }}>{cellsForLetter('S')}</g>
        <g style={{ fill: palette.E }}>{cellsForLetter('E')}</g>
        <g style={{ fill: palette.M }}>{cellsForLetter('M')}</g>
        <g style={{ fill: palette.R }}>{cellsForLetter('R')}</g>
        <g style={{ fill: palette.B }}>{cellsForLetter('B')}</g>
        <g style={{ fill: palette.P }}>{cellsForLetter('P')}</g>
        <g style={{ fill: palette.F }}>{cellsForLetter('F')}</g>
      </svg>

      {/* Floating "..." while speaking */}
      {speaking && (
        <div
          aria-hidden
          className="absolute -top-4 left-1/2 -translate-x-1/2 font-pixel text-[8px] text-accent-warm tracking-widest animate-blink"
        >
          • • •
        </div>
      )}
    </div>
  );
}
