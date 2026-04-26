'use client';

import { useT } from '@/lib/i18n/useT';
import HomeRecoveryProbe from './HomeRecoveryProbe';
import AgentSilhouette from '@/components/encounter/AgentSilhouette';
import StageBackdrop from '@/components/encounter/StageBackdrop';

interface AgentRevealCardProps {
  agentId: string;
}

/**
 * AgentRevealCard — replaces the bare "Preparing your first encounter"
 * text on the home page when the user is past the interview but the
 * first encounter has not yet spawned.
 *
 * Visually frames the wait as a clone-awakening moment rather than a
 * loading screen: stage atmosphere behind, a single silhouette under a
 * warm spot, gold serif copy with a shimmer pulse, and the silent
 * HomeRecoveryProbe nested at the bottom (still triggers on mount).
 */
export default function AgentRevealCard({ agentId }: AgentRevealCardProps): React.ReactElement {
  const t = useT();

  return (
    <main className="relative grain min-h-dvh w-full overflow-hidden bg-bg">
      <StageBackdrop />

      <div className="relative z-10 min-h-dvh flex flex-col items-center justify-center px-6">
        {/* Top hairline — gold rule announcing the act */}
        <div className="h-px w-12 bg-accent-gold/70 animate-fade-up" />
        <p className="mt-5 font-serif italic text-accent-gold text-[11px] tracking-[0.4em] uppercase animate-fade-up [animation-delay:140ms]">
          {t('home.preparing.label')}
        </p>

        {/* Silhouette under the spot — the user's clone, awakening */}
        <div className="mt-8 animate-fade-up [animation-delay:280ms]">
          <AgentSilhouette side="A" tint="gold" />
        </div>

        {/* Headline + body. Headline copy contains a literal \n; preserve it. */}
        <div className="mt-8 max-w-xs text-center space-y-3 animate-fade-up [animation-delay:480ms]">
          <h1 className="font-serif text-3xl leading-tight whitespace-pre-line">
            {t('home.preparing.title')}
          </h1>
          <p className="font-serif italic text-text-2 text-sm leading-relaxed animate-shimmer">
            {t('home.preparing.body')}
          </p>
        </div>

        {/* Triple-dot orb pulse — a heartbeat under the body */}
        <div className="mt-8 flex items-center gap-2 animate-fade-up [animation-delay:720ms]">
          <span className="h-1.5 w-1.5 rounded-full bg-accent-gold/70 animate-shimmer" />
          <span
            className="h-1.5 w-1.5 rounded-full bg-accent-gold/70 animate-shimmer"
            style={{ animationDelay: '0.4s' }}
          />
          <span
            className="h-1.5 w-1.5 rounded-full bg-accent-gold/70 animate-shimmer"
            style={{ animationDelay: '0.8s' }}
          />
        </div>

        {/* Bottom hairline — closing rule */}
        <div className="mt-10 h-px w-12 bg-accent-gold/70 animate-fade-up [animation-delay:900ms]" />
      </div>

      <HomeRecoveryProbe agentId={agentId} />
    </main>
  );
}
