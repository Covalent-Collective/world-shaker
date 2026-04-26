'use client';

import { useEffect, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/useT';
import { cn } from '@/lib/utils';
import type { ConversationStatus } from '@/types/db';

import FailureOverlay from './FailureOverlay';
import { SafetyMenu } from '@/components/safety/SafetyMenu';

interface Turn {
  turn_index: number;
  text: string;
  /** 'A' | 'B' — derived server-side from speaker_agent_id mapping. */
  speaker: 'A' | 'B';
}

interface LiveTranscriptProps {
  conversationId: string;
  initialStatus: ConversationStatus;
  initialLastEventId: number;
}

/**
 * Live SSE transcript renderer (US-307 / Step 3.6 / AC-7 / AC-7b).
 *
 * Subscribes to `/api/conversation/${id}/stream` via EventSource. The browser
 * EventSource runtime auto-reconnects on transport drop and forwards the last
 * received `id:` line as `Last-Event-ID` header. Some webview environments
 * strip that header, so we additionally pass it as `?lastEventId=` query
 * param on every (re)connect for resume safety.
 *
 * Events:
 *   - 'turn'     → JSON.parse(payload) as Turn → append (de-duped by index).
 *   - 'complete' → JSON.parse(payload) as { status: 'completed'|'failed'|'abandoned' }
 *                  → set status accordingly → close stream.
 */
export default function LiveTranscript({
  conversationId,
  initialStatus,
  initialLastEventId,
}: LiveTranscriptProps): React.ReactElement {
  const t = useT();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState<ConversationStatus>(initialStatus);
  const lastEventIdRef = useRef<number>(initialLastEventId);
  const sourceRef = useRef<EventSource | null>(null);
  const [safetyOpen, setSafetyOpen] = useState(false);

  useEffect(() => {
    if (status !== 'live') return;

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
        if (data.status === 'failed') {
          setStatus('failed');
        } else if (data.status === 'abandoned') {
          setStatus('abandoned');
        } else {
          setStatus('completed');
        }
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
  }, [conversationId, status]);

  return (
    <section aria-label="conversation transcript" className="space-y-3">
      <div className="flex items-center justify-end">
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
      </div>
      <SafetyMenu
        surfaceContext={{ conversation_id: conversationId }}
        open={safetyOpen}
        onOpenChange={setSafetyOpen}
      />
      {turns.length === 0 && status === 'live' ? (
        <p className="text-text-2 text-sm">{t('conversation.preparing')}</p>
      ) : null}

      {turns.map((turn) => (
        <div
          key={turn.turn_index}
          className={cn('flex w-full', turn.speaker === 'A' ? 'justify-start' : 'justify-end')}
        >
          <div className="max-w-[80%] space-y-1">
            <p className="text-xs text-text-3">{turn.speaker}</p>
            <div className="rounded-2xl bg-bg-1 px-4 py-3 text-sm leading-relaxed text-text">
              {turn.text}
            </div>
          </div>
        </div>
      ))}

      {status === 'completed' ? (
        <p className="text-text-2 text-xs text-center pt-4">{t('conversation.complete')}</p>
      ) : null}

      {status === 'failed' ? <FailureOverlay conversationId={conversationId} /> : null}
    </section>
  );
}
