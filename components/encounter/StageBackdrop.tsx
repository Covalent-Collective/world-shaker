/**
 * StageBackdrop — the cinematic atmosphere behind two agents.
 *
 * Layers (bottom → top):
 *   1. Vertical curtain-to-floor gradient
 *   2. Two warm radial spot pools angled from upper-left and upper-right
 *   3. Floating embers (3 columns, staggered durations) drifting upward
 *   4. Vignette darkening the edges
 *   5. Gold proscenium glow at top
 *   6. Filmic grain (applied at the page level via `.grain` class)
 *
 * Pure presentational; no client interactivity.
 */
export default function StageBackdrop(): React.ReactElement {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden stage-spotlights vignette">
      {/* Proscenium gold glow */}
      <div className="absolute inset-x-0 top-0 h-32 proscenium" />

      {/* Embers — 14 motes across three drift speeds, randomized horizontals */}
      <div className="absolute inset-0">
        {EMBERS.map((e, i) => (
          <span
            key={i}
            className={`absolute bottom-0 block h-1 w-1 rounded-full bg-accent-warm/60 blur-[1px] ${e.cls}`}
            style={{
              left: `${e.left}%`,
              animationDelay: `${e.delay}s`,
            }}
          />
        ))}
      </div>

      {/* Curtain shadow at the very top — pulls the eye toward stage center */}
      <div className="absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-stage-curtain to-transparent" />
    </div>
  );
}

const EMBERS: Array<{ left: number; delay: number; cls: string }> = [
  { left: 8, delay: 0, cls: 'animate-ember-rise' },
  { left: 17, delay: 4, cls: 'animate-ember-rise-2' },
  { left: 24, delay: 1, cls: 'animate-ember-rise-3' },
  { left: 33, delay: 6, cls: 'animate-ember-rise' },
  { left: 41, delay: 2, cls: 'animate-ember-rise-2' },
  { left: 48, delay: 8, cls: 'animate-ember-rise' },
  { left: 55, delay: 3, cls: 'animate-ember-rise-3' },
  { left: 63, delay: 5, cls: 'animate-ember-rise-2' },
  { left: 71, delay: 0.5, cls: 'animate-ember-rise' },
  { left: 78, delay: 7, cls: 'animate-ember-rise-3' },
  { left: 84, delay: 2.5, cls: 'animate-ember-rise-2' },
  { left: 91, delay: 4.5, cls: 'animate-ember-rise' },
  { left: 13, delay: 9, cls: 'animate-ember-rise-3' },
  { left: 88, delay: 6.5, cls: 'animate-ember-rise-2' },
];
