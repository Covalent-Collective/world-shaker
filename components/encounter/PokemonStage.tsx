'use client';

import { useEffect, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/useT';
import { cn } from '@/lib/utils';
import type { ConversationStatus } from '@/types/db';
import { SafetyMenu } from '@/components/safety/SafetyMenu';

import CafeBackdrop from './CafeBackdrop';
import PixelCharacter from './PixelCharacter';
import PokemonDialogueBox from './PokemonDialogueBox';
import FailureOverlay from '../conversation/FailureOverlay';

interface Turn {
  turn_index: number;
  text: string;
  speaker: 'A' | 'B';
}

interface PokemonStageProps {
  conversationId: string;
  initialStatus: ConversationStatus;
  initialLastEventId: number;
}

const WALK_IN_DURATION_MS = 2400;

/**
 * PokemonStage — Pokémon-style encounter. Two pixel characters walk in
 * from opposite edges of a top-down café, sit at a round table, and the
 * Pokémon Gen-2 dialogue box slides up to carry their conversation.
 *
 * SSE behaviour:
 *   • Subscribes to /api/conversation/{id}/stream?lastEventId=N
 *   • Each `turn` event replaces the dialogue box's current line. The box
 *     types out the new text; auto-advances to the next when SSE delivers it.
 *   • `complete` events terminate the scene (FIN strip / failure overlay).
 *
 * Resume: if `initialLastEventId > 0` the user is rejoining a scene already
 * in progress, so we skip the walk-in animation and seat the characters
 * immediately.
 */
export default function PokemonStage({
  conversationId,
  initialStatus,
  initialLastEventId,
}: PokemonStageProps): React.ReactElement {
  const t = useT();
  const [latest, setLatest] = useState<Turn | null>(null);
  const [status, setStatus] = useState<ConversationStatus>(initialStatus);
  const [seated, setSeated] = useState(initialLastEventId > 0);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const lastEventIdRef = useRef<number>(initialLastEventId);
  const sourceRef = useRef<EventSource | null>(null);

  // Walk-in → seated transition
  useEffect(() => {
    if (seated) return;
    const tm = setTimeout(() => setSeated(true), WALK_IN_DURATION_MS);
    return () => clearTimeout(tm);
  }, [seated]);

  // SSE — only after the characters are seated, so text doesn't fight the
  // walk-in animation for attention
  useEffect(() => {
    if (!seated || status !== 'live') return;

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
        setLatest((prev) => {
          // Late-arriving older turn (out-of-order) — keep the newer one.
          if (prev && parsed.turn_index <= prev.turn_index) return prev;
          return parsed;
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
  }, [seated, conversationId, status]);

  const isLive = status === 'live';
  const speakerASpeaking = latest?.speaker === 'A' && isLive;
  const speakerBSpeaking = latest?.speaker === 'B' && isLive;
  const walking = !seated;

  // Dialogue copy: a placeholder while characters greet, the latest turn
  // once one has streamed in. Empty string blanks the typewriter.
  const dialogueText = latest?.text ?? (seated ? t('conversation.preparing') : '');
  const dialogueSpeaker = latest?.speaker ?? null;

  return (
    <main className="fixed inset-0 flex flex-col bg-bg overflow-hidden">
      {/* Header — pixel label + safety button */}
      <header className="relative z-20 flex items-center justify-between px-5 pt-4 pb-2 bg-gradient-to-b from-bg via-bg/90 to-transparent">
        <div className="font-pixel text-[10px] tracking-[0.2em] text-accent-gold">
          ENCOUNTER № 01
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

      {/* Scene — café room with walking pixel characters */}
      <section className="relative flex-1 overflow-hidden">
        <CafeBackdrop />

        {/* Character A (left) — sits on the left stool */}
        <div
          className={cn(
            'absolute z-10 left-[20%] top-[58%]',
            walking ? 'animate-walk-in-left' : '',
          )}
        >
          <PixelCharacter side="A" walking={walking} speaking={speakerASpeaking} />
        </div>

        {/* Character B (right) — sits on the right stool */}
        <div
          className={cn(
            'absolute z-10 right-[20%] top-[58%]',
            walking ? 'animate-walk-in-right' : '',
          )}
        >
          <PixelCharacter side="B" walking={walking} speaking={speakerBSpeaking} />
        </div>

        {/* Heart spark above the table during the silent first beat */}
        {seated && isLive && !latest && (
          <div
            aria-hidden
            className="absolute left-1/2 top-[34%] -translate-x-1/2 font-pixel text-base text-accent-warm animate-shimmer"
          >
            ♡
          </div>
        )}

        {/* FIN strip when the encounter completes — sits between scene and box */}
        {status === 'completed' && (
          <div className="absolute inset-x-0 bottom-2 flex items-center justify-center gap-2 animate-fade-up">
            <span className="h-px w-8 bg-accent-gold/70" />
            <span className="font-pixel text-[10px] tracking-[0.3em] text-accent-gold">FIN</span>
            <span className="h-px w-8 bg-accent-gold/70" />
          </div>
        )}
      </section>

      <SafetyMenu
        surfaceContext={{ conversation_id: conversationId }}
        open={safetyOpen}
        onOpenChange={setSafetyOpen}
      />

      {/* Dialogue box — bottom panel, slides up after the walk-in */}
      <section className="relative z-20">
        {seated ? (
          <PokemonDialogueBox
            speaker={dialogueSpeaker}
            text={dialogueText}
            awaitingNext={isLive && Boolean(latest)}
          />
        ) : null}

        {status === 'failed' ? <FailureOverlay conversationId={conversationId} /> : null}
      </section>
    </main>
  );
}
