'use client';

import { useEffect, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/useT';
import { cn } from '@/lib/utils';
import type { ConversationStatus } from '@/types/db';
import { SafetyMenu } from '@/components/safety/SafetyMenu';

import CafeBackdrop from './CafeBackdrop';
import PixelCharacter from './PixelCharacter';
import PokemonDialogueBox from './PokemonDialogueBox';
import EncounterEndPopup from './EncounterEndPopup';
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
  /** Display name of the OTHER agent's owner (the one the user will be
   *  invited to message after the encounter ends). Optional; the popup
   *  falls back to a name-less CTA when unknown. */
  partnerName?: string | null;
}

const WALK_IN_DURATION_MS = 2400;

/**
 * Reveal cadence — every N ms, dequeue one turn and show it. Tunes the
 * "live" feel: too fast and the typewriter blurs, too slow and the demo
 * drags. 5 s/turn ≈ 2 minutes for a full 25-turn encounter.
 */
const REVEAL_INTERVAL_MS = 5000;

/**
 * PokemonStage — Pokémon-style encounter. Two pixel characters walk in,
 * sit at a café table, and the dialogue box plays back the turns at a
 * controlled cadence so the encounter feels live even when the
 * conversation has already finished generating server-side.
 *
 * Playback model:
 *   • All `turn` SSE events are pushed onto a queue (refs, not state, so
 *     bursty replay traffic doesn't trigger N renders).
 *   • A reveal timer pulls one turn from the queue every
 *     REVEAL_INTERVAL_MS, calls setLatest, and re-arms only if more turns
 *     are pending.
 *   • The `complete` SSE event flips a `streamEnded` flag but does NOT
 *     end the scene immediately — playback finishes draining the queue
 *     first.
 *   • Once the queue empties AND streamEnded is true, the EncounterEnd
 *     popup appears.
 *
 * SSE subscription is opened once the characters are seated and the
 * conversation isn't terminally failed/abandoned. Status changes during
 * the stream do not re-subscribe (the source closes itself on complete).
 */
export default function PokemonStage({
  conversationId,
  initialStatus,
  initialLastEventId,
  partnerName,
}: PokemonStageProps): React.ReactElement {
  const t = useT();
  const [latest, setLatest] = useState<Turn | null>(null);
  const [status, setStatus] = useState<ConversationStatus>(initialStatus);
  const [seated, setSeated] = useState(initialLastEventId > 0);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [revealComplete, setRevealComplete] = useState(false);
  const [popupDismissed, setPopupDismissed] = useState(false);

  const lastEventIdRef = useRef<number>(initialLastEventId);
  const sourceRef = useRef<EventSource | null>(null);

  // Playback queue + timer
  const queueRef = useRef<Turn[]>([]);
  const firstShownRef = useRef(false);
  const streamEndedRef = useRef(false);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Walk-in → seated transition
  useEffect(() => {
    if (seated) return;
    const tm = setTimeout(() => setSeated(true), WALK_IN_DURATION_MS);
    return () => clearTimeout(tm);
  }, [seated]);

  // SSE — subscribe once seated, regardless of live/completed status. The
  // server replays existing turns first, then emits `complete` for terminal
  // statuses. Only `failed` / `abandoned` short-circuit the subscription.
  useEffect(() => {
    if (!seated) return;
    if (status === 'failed' || status === 'abandoned') return;

    const reveal = (): void => {
      const next = queueRef.current.shift();
      if (next) {
        setLatest(next);
        firstShownRef.current = true;
        if (next.turn_index > lastEventIdRef.current) {
          lastEventIdRef.current = next.turn_index;
        }
      }
      revealTimerRef.current = null;
      if (queueRef.current.length > 0) {
        revealTimerRef.current = setTimeout(reveal, REVEAL_INTERVAL_MS);
      } else if (streamEndedRef.current) {
        setRevealComplete(true);
      }
    };

    const ensureRevealKicked = (): void => {
      if (revealTimerRef.current) return;
      if (queueRef.current.length === 0) return;
      if (!firstShownRef.current) {
        // First turn shows immediately so the user isn't staring at an
        // empty box for the first REVEAL_INTERVAL.
        reveal();
      } else {
        revealTimerRef.current = setTimeout(reveal, REVEAL_INTERVAL_MS);
      }
    };

    const url = `/api/conversation/${conversationId}/stream?lastEventId=${lastEventIdRef.current}`;
    const source = new EventSource(url);
    sourceRef.current = source;

    const handleTurn = (ev: MessageEvent<string>): void => {
      try {
        const parsed = JSON.parse(ev.data) as Turn;
        if (typeof parsed.turn_index !== 'number') return;
        // Drop already-emitted turns (resume safety).
        if (parsed.turn_index <= lastEventIdRef.current && firstShownRef.current) {
          return;
        }
        // Drop in-queue duplicates.
        if (queueRef.current.some((q) => q.turn_index === parsed.turn_index)) return;
        queueRef.current.push(parsed);
        // Keep the queue sorted so out-of-order replays still play in turn order.
        queueRef.current.sort((a, b) => a.turn_index - b.turn_index);
        ensureRevealKicked();
      } catch {
        /* malformed payload — drop silently */
      }
    };

    const handleComplete = (ev: MessageEvent<string>): void => {
      try {
        const data = JSON.parse(ev.data) as { status: string };
        if (data.status === 'failed') setStatus('failed');
        else if (data.status === 'abandoned') setStatus('abandoned');
        else setStatus('completed');
      } catch {
        setStatus('completed');
      }
      streamEndedRef.current = true;
      // If the queue is already empty and no reveal is mid-flight, the
      // playback has caught up to the stream and we can fire revealComplete
      // without waiting for the next reveal callback to notice.
      if (queueRef.current.length === 0 && !revealTimerRef.current) {
        setRevealComplete(true);
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
      if (revealTimerRef.current) {
        clearTimeout(revealTimerRef.current);
        revealTimerRef.current = null;
      }
    };
    // Intentionally omit `status` from deps — status changes happen INSIDE
    // this effect via handleComplete; resubscribing on every change would
    // tear down + recreate the EventSource for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seated, conversationId]);

  const isLive = status === 'live';
  const speakerASpeaking = latest?.speaker === 'A' && (isLive || !revealComplete);
  const speakerBSpeaking = latest?.speaker === 'B' && (isLive || !revealComplete);
  const walking = !seated;
  const showEndPopup = revealComplete && status === 'completed' && !popupDismissed;
  const showFinStrip = revealComplete && status === 'completed';

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

        <div
          className={cn(
            'absolute z-10 left-[20%] top-[58%]',
            walking ? 'animate-walk-in-left' : '',
          )}
        >
          <PixelCharacter side="A" walking={walking} speaking={speakerASpeaking} />
        </div>

        <div
          className={cn(
            'absolute z-10 right-[20%] top-[58%]',
            walking ? 'animate-walk-in-right' : '',
          )}
        >
          <PixelCharacter side="B" walking={walking} speaking={speakerBSpeaking} />
        </div>

        {/* Heart spark above the table during the silent first beat */}
        {seated && !latest && (
          <div
            aria-hidden
            className="absolute left-1/2 top-[34%] -translate-x-1/2 font-pixel text-base text-accent-warm animate-shimmer"
          >
            ♡
          </div>
        )}

        {showFinStrip && (
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

      <section className="relative z-20">
        {seated ? (
          <PokemonDialogueBox
            speaker={dialogueSpeaker}
            text={dialogueText}
            awaitingNext={!revealComplete && Boolean(latest)}
          />
        ) : null}

        {status === 'failed' ? <FailureOverlay conversationId={conversationId} /> : null}
      </section>

      {showEndPopup ? (
        <EncounterEndPopup
          partnerName={partnerName ?? null}
          onDismiss={() => setPopupDismissed(true)}
          onCta={() => {
            // Demo stub — real handoff (World Chat / wallet-bound DM) ships
            // in a follow-up. Dismiss for now so the user can reopen the
            // popup by reloading.
            setPopupDismissed(true);
          }}
        />
      ) : null}
    </main>
  );
}
