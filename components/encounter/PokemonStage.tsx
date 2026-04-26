'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

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
  /** Display name of the CURRENT user's own agent (their q0_name). Used
   *  to render "{name}" on the dialogue plate when this agent is speaking,
   *  in place of the legacy "AGENT A/B" label. */
  selfName?: string | null;
  /** Which side (A or B) the current viewer's own agent occupies in this
   *  conversation. Determined server-side from agent_a_id ownership. */
  selfSide?: 'A' | 'B';
}

const WALK_IN_DURATION_MS = 2400;

/**
 * PokemonStage — Pokémon-style encounter. Two pixel characters walk in,
 * sit at a café table, and the dialogue box plays back the turns at a
 * controlled cadence so the encounter feels live even when the
 * conversation has already finished generating server-side.
 *
 * Playback model (tap-to-advance):
 *   • All `turn` SSE events are pushed onto a queue (refs, not state, so
 *     bursty replay traffic doesn't trigger N renders).
 *   • The first turn auto-shows so the user is never staring at an empty
 *     dialogue box. Subsequent turns advance ONLY when the user taps the
 *     dialogue box — reading pace stays in the user's hands.
 *   • PokemonDialogueBox tap behaviour: tap mid-typewriter snaps to the
 *     end; tap when settled fires `onSkip`, which we wire to `advance()`.
 *   • The `complete` SSE event flips a `streamEnded` flag but does NOT
 *     end the scene immediately — playback finishes draining the queue
 *     first via tapping.
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
  selfName,
  selfSide,
}: PokemonStageProps): React.ReactElement {
  const t = useT();
  const [latest, setLatest] = useState<Turn | null>(null);
  const [status, setStatus] = useState<ConversationStatus>(initialStatus);
  const [seated, setSeated] = useState(initialLastEventId > 0);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [revealComplete, setRevealComplete] = useState(false);
  const [popupDismissed, setPopupDismissed] = useState(false);
  const [handoffPending, setHandoffPending] = useState(false);
  const router = useRouter();

  const lastEventIdRef = useRef<number>(initialLastEventId);
  const sourceRef = useRef<EventSource | null>(null);

  // Playback queue
  const queueRef = useRef<Turn[]>([]);
  const firstShownRef = useRef(false);
  const streamEndedRef = useRef(false);

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

    const showFirstIfReady = (): void => {
      if (firstShownRef.current) return;
      const next = queueRef.current.shift();
      if (!next) return;
      setLatest(next);
      firstShownRef.current = true;
      if (next.turn_index > lastEventIdRef.current) {
        lastEventIdRef.current = next.turn_index;
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
        // Auto-show only the very first turn. Subsequent turns wait for tap.
        showFirstIfReady();
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
      // If the user has already drained every queued turn (queue empty)
      // before the stream's terminal event arrived, the handoff popup
      // should fire immediately. Otherwise advance() will trip the
      // revealComplete flag once the queue empties.
      if (queueRef.current.length === 0 && firstShownRef.current) {
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
    };
    // Intentionally omit `status` from deps — status changes happen INSIDE
    // this effect via handleComplete; resubscribing on every change would
    // tear down + recreate the EventSource for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seated, conversationId]);

  // Tap-to-advance: pulls the next turn off the queue. Caller is the
  // dialogue box's onSkip (fires when the user taps after the typewriter
  // has settled). When the queue drains AND the stream has ended, flip
  // revealComplete so the end popup can mount.
  const advance = (): void => {
    const next = queueRef.current.shift();
    if (next) {
      setLatest(next);
      firstShownRef.current = true;
      if (next.turn_index > lastEventIdRef.current) {
        lastEventIdRef.current = next.turn_index;
      }
    }
    if (queueRef.current.length === 0 && streamEndedRef.current) {
      setRevealComplete(true);
    }
  };

  const handleHandoff = async (): Promise<void> => {
    if (handoffPending) return;
    setHandoffPending(true);
    try {
      const res = await fetch(`/api/encounter/${conversationId}/handoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) throw new Error(`handoff_${res.status}`);
      const data = (await res.json()) as { match_id?: string };
      if (data.match_id) {
        router.push(`/match/${data.match_id}/success`);
        return;
      }
      throw new Error('handoff_missing_match_id');
    } catch (err) {
      console.error('[encounter] handoff failed', err);
      setHandoffPending(false);
    }
  };

  const isLive = status === 'live';
  const speakerASpeaking = latest?.speaker === 'A' && (isLive || !revealComplete);
  const speakerBSpeaking = latest?.speaker === 'B' && (isLive || !revealComplete);
  const walking = !seated;
  const showEndPopup = revealComplete && status === 'completed' && !popupDismissed;
  const showFinStrip = revealComplete && status === 'completed';
  // ▼ blink rules: any time we're still mid-encounter (not yet
  // revealComplete) and have shown at least the first turn. Suppressed
  // automatically once the popup takes over because revealComplete flips.
  const awaitingNext = !revealComplete && Boolean(latest);

  const dialogueText = latest?.text ?? (seated ? t('conversation.preparing') : '');
  const dialogueSpeaker = latest?.speaker ?? null;
  // Map dialogue side → display name. The viewer's own side is `selfSide`
  // (defaults to 'A' for back-compat with the older single-name plumbing).
  const ownerOfA = selfSide === 'B' ? partnerName : selfName;
  const ownerOfB = selfSide === 'B' ? selfName : partnerName;
  const dialogueSpeakerName =
    dialogueSpeaker === 'A' ? ownerOfA : dialogueSpeaker === 'B' ? ownerOfB : null;

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
            speakerName={dialogueSpeakerName ?? null}
            text={dialogueText}
            awaitingNext={awaitingNext}
            onSkip={advance}
          />
        ) : null}

        {status === 'failed' ? <FailureOverlay conversationId={conversationId} /> : null}
      </section>

      {showEndPopup ? (
        <EncounterEndPopup
          partnerName={partnerName ?? null}
          onDismiss={() => setPopupDismissed(true)}
          onCta={handleHandoff}
        />
      ) : null}
    </main>
  );
}
