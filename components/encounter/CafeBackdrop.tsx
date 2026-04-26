/**
 * CafeBackdrop — the room the two pixel characters meet in.
 *
 * Layered:
 *   1. Wall: warm brown vertical gradient (top dark → mid lighter)
 *   2. Floor: 4-tile diagonal-ish wood checker via repeating linear-gradient
 *      (no PNG — the seam is part of the look)
 *   3. Hanging lamp: warm pendant + soft radial glow pool on the floor
 *   4. Round table + two stools centered between the two character seats
 *   5. Couple of motes drifting like dust under the lamp
 *
 * Pure presentational; no client-side state. Sized to fill its parent.
 */
export default function CafeBackdrop(): React.ReactElement {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden">
      {/* Wall */}
      <div
        className="absolute inset-x-0 top-0 h-[58%]"
        style={{
          background: 'linear-gradient(180deg, #2a1a10 0%, #3a2418 60%, #4a2e1c 100%)',
        }}
      />
      {/* Wallpaper rule — subtle horizontal trim near the floor join */}
      <div
        className="absolute inset-x-0 top-[57%] h-[2px]"
        style={{ background: 'rgba(201,169,97,0.55)' }}
      />
      <div
        className="absolute inset-x-0 top-[58%] h-[1px]"
        style={{ background: 'rgba(0,0,0,0.4)' }}
      />

      {/* Floor — checker pattern via two layered backgrounds */}
      <div
        className="absolute inset-x-0 top-[58%] bottom-0"
        style={{
          background:
            // Diagonal wood-plank checker:
            'repeating-linear-gradient(135deg, #a07254 0 22px, #8a5d3f 22px 44px),' +
            'linear-gradient(180deg, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0) 30%)',
        }}
      />
      {/* Floor scanlines for a slight CRT pixel feel */}
      <div
        className="absolute inset-x-0 top-[58%] bottom-0 mix-blend-overlay opacity-25"
        style={{
          background:
            'repeating-linear-gradient(0deg, rgba(0,0,0,0.35) 0 1px, transparent 1px 3px)',
        }}
      />

      {/* Hanging lamp — pendant + warm pool */}
      <div className="absolute left-1/2 -translate-x-1/2 top-0 flex flex-col items-center">
        <div className="h-6 w-[2px] bg-black/70" />
        <div
          className="h-3 w-6 rounded-b-full"
          style={{
            background: 'linear-gradient(180deg, #2a1a10, #5a3018)',
            boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.6), 0 0 18px 4px rgba(255,217,168,0.45)',
          }}
        />
      </div>

      {/* Light pool on the floor */}
      <div
        className="absolute left-1/2 -translate-x-1/2 top-[40%] h-[55%] w-[78%] rounded-[50%] pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at 50% 30%, rgba(255,233,176,0.45) 0%, rgba(255,217,168,0.18) 35%, transparent 70%)',
        }}
      />

      {/* Round table + two stools, dead-centre between the seat marks */}
      <div className="absolute left-1/2 -translate-x-1/2 top-[68%] flex items-center justify-center">
        {/* Stool left */}
        <div className="relative" aria-hidden>
          <div
            className="h-3 w-7 rounded-full"
            style={{
              background: '#4a2e1c',
              boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.4), 0 4px 0 #1a0e08',
            }}
          />
        </div>
        {/* Table — taller round disc with rim highlight */}
        <div
          className="relative mx-3 h-7 w-24 rounded-[50%]"
          style={{
            background:
              'radial-gradient(ellipse at 50% 30%, #7a4a28 0%, #5a3520 60%, #3a2010 100%)',
            boxShadow:
              'inset 0 2px 0 rgba(255,217,168,0.35), 0 6px 0 #1a0e08, 0 12px 16px rgba(0,0,0,0.45)',
          }}
        >
          {/* Coffee cup hint, left */}
          <div className="absolute left-3 top-1 h-2 w-2 rounded-sm bg-white/80" />
          <div className="absolute left-3 top-0 h-1 w-2 bg-white/30 blur-[1px]" />
          {/* Coffee cup hint, right */}
          <div className="absolute right-3 top-1 h-2 w-2 rounded-sm bg-[#d4a85a]" />
          <div className="absolute right-3 top-0 h-1 w-2 bg-white/30 blur-[1px]" />
        </div>
        {/* Stool right */}
        <div className="relative" aria-hidden>
          <div
            className="h-3 w-7 rounded-full"
            style={{
              background: '#4a2e1c',
              boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.4), 0 4px 0 #1a0e08',
            }}
          />
        </div>
      </div>

      {/* Dust motes under the light pool */}
      <span
        className="absolute left-[34%] top-[55%] h-1 w-1 rounded-full bg-accent-warm/60 blur-[1px] animate-drift-slow"
        style={{ animationDelay: '1s' }}
      />
      <span
        className="absolute left-[56%] top-[63%] h-1 w-1 rounded-full bg-accent-warm/50 blur-[1px] animate-drift"
        style={{ animationDelay: '3s' }}
      />
      <span
        className="absolute left-[64%] top-[50%] h-1 w-1 rounded-full bg-accent-warm/55 blur-[1px] animate-drift-slow"
        style={{ animationDelay: '5s' }}
      />
    </div>
  );
}
