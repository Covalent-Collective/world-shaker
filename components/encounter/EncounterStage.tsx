'use client';

import { useEffect, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/useT';
import { cn } from '@/lib/utils';
import type { ConversationStatus } from '@/types/db';
import { SafetyMenu } from '@/components/safety/SafetyMenu';

import StageBackdrop from './StageBackdrop';
import AgentSilhouette from './AgentSilhouette';
import SpeechBubble from './SpeechBubble';
import TitleCard from './TitleCard';
import FailureOverlay from '../conversation/FailureOverlay';

interface Turn {
  turn_index: number;
  text: string;
  speaker: 'A' | 'B';
}

interface EncounterStageProps {
  conversationId: string;
  initialStatus: ConversationStatus;
  initialLastEventId: number;
}

/**
 * EncounterStage — cinematic theatre layout for an agent-vs-agent encounter.
 *
 * Composition:
 *   • Top deck (≈45dvh): two AgentSilhouettes facing each other across a
 *     gilded table line, lit by warm radial spots, embers drifting up.
 *   • Bottom deck: dialogue panel of paper-textured speech bubbles. Latest
 *     turn at the bottom; auto-scrolls to follow streaming.
 *   • Title card: a one-shot intro overlay (gold serif "ENCOUNTER №1")
 *     that fades in/out before the curtain rises. Skipped on resume
 *     (lastEventId > 0 indicates the user has watched some of this scene
 *     already, so we go straight to the stage).
 *
 * SSE behaviour mirrors the prior LiveTranscript:
 *   • Subscribes to /api/conversation/{id}/stream?lastEventId=N
 *   • Listens for 'turn' and 'complete' events
 *   • Pass lastEventId both via the URL and (implicitly via EventSource)
 *     the Last-Event-ID header for resume
 */
export default function EncounterStage({
  conversationId,
  initialStatus,
  initialLastEventId,
}: EncounterStageProps): React.ReactElement {
  const t = useT();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState<ConversationStatus>(initialStatus);
  const [showTitleCard, setShowTitleCard] = useState(initialLastEventId === 0);
  const [stageReady, setStageReady] = useState(initialLastEventId > 0);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const lastEventIdRef = useRef<number>(initialLastEventId);
  const sourceRef = useRef<EventSource | null>(null);
  const dialogueEndRef = useRef<HTMLDivElement | null>(null);

  // SSE subscription — only after stage is ready (post title-card).
  useEffect(() => {
    if (!stageReady || status !== 'live') return;

    const url = `/api/conversation/${conversationId}/stream?lastEventId=${lastEventIdRef.current}`;
    const source = new EventSource(url);
    sourceRef.current = source;

    const handleTurn = (ev: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(ev.data) as Turn;
        if (typeof parsed.turn_index !== 'number') return;
        const id = Number(ev.lastEventId);
        if (Number.isFinite(id) && id > lastEventIdRef.current) {
          lastEventIdRef.current = id;
        }
        setTurns((prev) => {
          if (prev.some((t) => t.turn_index === parsed.turn_index)) return prev;
          const next = [...prev, parsed];
          next.sort((a, b) => a.turn_index - b.turn_index);
          return next;
        });
      } catch {
        /* malformed payload — drop silently */
      }
    };

    const handleComplete = (ev: MessageEvent<string>) => {
      try {
        const data = JSON.parse(ev.data) as { status: string };
        if (data.status === 'failed') setStatus('failed');
        else if (data.status === 'abandoned') setStatus('abandoned');
        else setStatus('completed');
      } catch {
        setStatus('completed');
      }
      source.close();
    };

    source.addEventListener('turn', handleTurn);
    source.addEventListener('complete', handleComplete);

    return () => {
      source.removeEventListener('turn', handleTurn);
      source.removeEventListener('complete', handleComplete);
      source.close();
      sourceRef.current = null;
    };
  }, [stageReady, conversationId, status]);

  // Auto-scroll dialogue panel to follow streaming.
  useEffect(() => {
    dialogueEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns.length]);

  // Most recent speaker — used to highlight that silhouette as "speaking".
  const currentSpeaker = turns.length > 0 ? turns[turns.length - 1]?.speaker : null;

  return (
    <div className="grain relative min-h-dvh w-full overflow-hidden bg-bg flex flex-col">
      {showTitleCard ? (
        <TitleCard
          label={t('encounter.titlecard.label')}
          subtitle={t('encounter.titlecard.subtitle')}
          onDone={() => {
            setShowTitleCard(false);
            // Tiny delay before stage reveal lets the title fade fully out.
            setTimeout(() => setStageReady(true), 120);
          }}
        />
      ) : null}

      {/* ── Top deck: stage scene ──────────────────────────────────── */}
      <section
        className={cn(
          'relative h-[44dvh] min-h-[300px] w-full',
          stageReady ? 'animate-iris-open' : 'opacity-0',
        )}
      >
        <StageBackdrop />

        {/* Header — minimal: Encounter mark + safety button */}
        <header className="relative z-10 flex items-center justify-between px-6 pt-5">
          <div className="font-serif italic text-[11px] tracking-[0.35em] uppercase text-accent-gold animate-fade-up">
            {t('encounter.header')}
          </div>
          <button
            type="button"
            aria-label={t('safety.report')}
            onClick={() => setSafetyOpen(true)}
            className="rounded-full p-1.5 text-text-3 transition-opacity hover:opacity-70 active:opacity-50"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </button>
        </header>

        {/* Two figures + table line */}
        <div className="relative z-10 mt-4 flex items-end justify-between px-6">
          <div className="animate-fade-up [animation-delay:200ms]">
            <AgentSilhouette side="A" tint="warm" speaking={currentSpeaker === 'A'} />
          </div>
          <div className="animate-fade-up [animation-delay:380ms]">
            <AgentSilhouette side="B" tint="gold" speaking={currentSpeaker === 'B'} />
          </div>
        </div>

        {/* Gilded table line + drifting glints */}
        <div className="absolute inset-x-8 bottom-6 z-10">
          <div className="h-px table-line animate-fade-up [animation-delay:560ms]" />
          <div className="mt-3 flex items-center justify-center gap-2 opacity-70">
            <span className="h-1 w-1 rounded-full bg-accent-gold/60" />
            <span className="font-serif italic text-[10px] tracking-[0.4em] uppercase text-accent-gold/70">
              {t('encounter.scenelabel')}
            </span>
            <span className="h-1 w-1 rounded-full bg-accent-gold/60" />
          </div>
        </div>
      </section>

      {/* ── Bottom deck: dialogue panel ─────────────────────────────── */}
      <section
        aria-label="conversation dialogue"
        className="relative flex-1 w-full px-5 py-6 overflow-y-auto bg-gradient-to-b from-bg to-bg-1"
      >
        <SafetyMenu
          surfaceContext={{ conversation_id: conversationId }}
          open={safetyOpen}
          onOpenChange={setSafetyOpen}
        />

        {turns.length === 0 && status === 'live' ? (
          <div className="flex flex-col items-center pt-6 gap-2 animate-fade-up [animation-delay:760ms]">
            <div className="h-1 w-1 rounded-full bg-accent-gold animate-shimmer" />
            <p className="text-text-3 text-xs font-serif italic">{t('conversation.preparing')}</p>
          </div>
        ) : null}

        <div className="space-y-4">
          {turns.map((turn, i) => (
            <SpeechBubble
              key={turn.turn_index}
              speaker={turn.speaker}
              text={turn.text}
              delayMs={Math.min(i * 60, 240)}
            />
          ))}
          <div ref={dialogueEndRef} />
        </div>

        {status === 'completed' ? (
          <div className="mt-8 flex flex-col items-center gap-2 animate-fade-up">
            <div className="h-px w-10 bg-accent-gold/60" />
            <p className="font-serif italic text-accent-gold text-sm tracking-[0.3em] uppercase">
              {t('encounter.fin')}
            </p>
            <div className="h-px w-10 bg-accent-gold/60" />
          </div>
        ) : null}

        {status === 'abandoned' ? (
          <p className="mt-8 text-text-3 text-xs font-serif italic text-center">
            {t('encounter.abandoned')}
          </p>
        ) : null}

        {status === 'failed' ? <FailureOverlay conversationId={conversationId} /> : null}
      </section>
    </div>
  );
}
