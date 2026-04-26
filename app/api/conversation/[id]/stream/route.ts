import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  REALTIME_LISTEN_TYPES,
  REALTIME_POSTGRES_CHANGES_LISTEN_EVENT,
  REALTIME_SUBSCRIBE_STATES,
  type RealtimePostgresInsertPayload,
} from '@supabase/supabase-js';

import { SESSION_COOKIE, verifyWorldUserJwt } from '@/lib/auth/jwt';
import { getServiceClient } from '@/lib/supabase/service';

/**
 * GET /api/conversation/[id]/stream — Server-Sent Events relay (US-204).
 *
 * Subscribes to Supabase Realtime postgres_changes on conversation_turns and
 * streams INSERTs to the browser as SSE events. The route is layered as:
 *
 *   1. Auth: ws_session cookie -> verifyWorldUserJwt. Failure returns 403
 *      (NOT 401) because EventSource clients can't easily react to 401 — we
 *      treat any auth failure as forbidden access.
 *   2. Ownership: service-role JOIN against conversations + agents to ensure
 *      the world user owns one of the conversation's agents.
 *   3. Realtime subscribe FIRST: postgres_changes INSERT, filtered by
 *      conversation_id. Subscribing before replay closes the lost-turn race:
 *      any INSERT that lands while replay is in flight is buffered and then
 *      flushed (with dedupe) after replay completes.
 *   4. Initial replay: SELECT turns with turn_index > Last-Event-ID to support
 *      EventSource resume (browser auto-attaches Last-Event-ID on reconnect).
 *      Once replay is done, the buffered Realtime payloads are emitted in
 *      order, dropping anything turn_index <= lastSeen so each turn is sent
 *      exactly once.
 *   5. Status backstop: poll conversations.status every 5s; emit `complete`
 *      and close on terminal status. This is the safety net if Realtime drops
 *      the final INSERT or the orchestrator finishes without a final emit.
 *   6. Heartbeat every 15s: SSE comment `: heartbeat` keeps proxies from
 *      timing out the connection.
 *
 * Streaming flow (top-to-bottom inside the ReadableStream pull/start):
 *   start() -> auth -> ownership -> subscribe (buffer) -> replay -> flush
 *           -> intervals
 *   cancel() -> unsubscribe + clear all intervals
 *
 * NOTE on testing: SSE is hard to drive end-to-end through vitest because
 * ReadableStream consumption + Realtime subscribe + intervals interleave in
 * ways that flake under fake timers. The companion test file unit-tests the
 * decision boundaries (auth, ownership, replay query, dedup logic) and treats
 * the streaming wiring as integration-level — covered by the next-step e2e.
 *
 * Vercel: maxDuration is 300s for Hobby; on Vercel Pro, this can be raised to
 * 800s. Update the export below when the project moves to Pro.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

const HEARTBEAT_INTERVAL_MS = 15_000;
const STATUS_POLL_INTERVAL_MS = 5_000;
const TERMINAL_STATUSES = new Set(['completed', 'abandoned', 'failed']);

interface ConversationTurnRow {
  turn_index: number;
  text: string;
  speaker_agent_id: string;
}

/**
 * Strip leading speaker prefixes the dialogue model sometimes emits.
 *
 * The persona/dialogue prompts label the two agents as "Agent A" / "Agent B"
 * to keep stage direction unambiguous in the LLM's context. Some models echo
 * that label as a literal "Agent A: …" / "Agent B: …" prefix in their reply,
 * which then leaks into stored turn text. We strip it on the way out so the
 * UI never has to render the prefix and old rows look right too.
 */
const SPEAKER_PREFIX_RE = /^\s*Agent\s*[ABab]\s*[:：]\s*/;

export function stripSpeakerPrefix(text: string): string {
  return text.replace(SPEAKER_PREFIX_RE, '');
}

/**
 * Build a `id:\nevent: turn\ndata: <JSON>\n\n` SSE frame for a turn.
 *
 * Emits a `speaker: 'A' | 'B'` field derived from the canonical agent_a_id of
 * the conversation, so the client never has to do its own agent-id → side
 * mapping. The original `speaker_agent_id` is preserved for any consumer that
 * still relies on it.
 */
export function formatTurnEvent(turn: ConversationTurnRow, agentAId: string): string {
  const speaker: 'A' | 'B' = turn.speaker_agent_id === agentAId ? 'A' : 'B';
  const payload = {
    turn_index: turn.turn_index,
    text: stripSpeakerPrefix(turn.text),
    speaker,
    speaker_agent_id: turn.speaker_agent_id,
  };
  return `id: ${turn.turn_index}\n` + `event: turn\n` + `data: ${JSON.stringify(payload)}\n\n`;
}

/** Build the terminal `event: complete` SSE frame. */
export function formatCompleteEvent(status: string): string {
  return `event: complete\ndata: ${JSON.stringify({ status })}\n\n`;
}

/** Parse Last-Event-ID header into a turn_index floor. -1 means "from start". */
export function parseLastEventId(header: string | null): number {
  if (!header) return -1;
  const n = Number.parseInt(header, 10);
  return Number.isFinite(n) && n >= 0 ? n : -1;
}

/**
 * Verify ownership: the world user must own one of the conversation's agents.
 * Returns the conversation's current status when authorized, or null if not
 * found / not owner.
 *
 * Mirrors the JOIN performed by the abandon route (US-203):
 *   conversations c JOIN agents a ON a.id IN (c.agent_a_id, c.agent_b_id)
 *   WHERE c.id = $id AND a.user_id = $worldUserId
 */
export async function verifyOwnership(
  supabase: ReturnType<typeof getServiceClient>,
  conversationId: string,
  worldUserId: string,
): Promise<{ status: string; agent_a_id: string } | null> {
  const { data, error } = await supabase
    .from('conversations')
    .select(
      'status, agent_a_id, agent_a:agents!conversations_agent_a_id_fkey(user_id), agent_b:agents!conversations_agent_b_id_fkey(user_id)',
    )
    .eq('id', conversationId)
    .maybeSingle();

  if (error || !data) return null;

  // Supabase returns nested relationships as either object or array depending
  // on FK metadata; normalize and check user_id.
  const agentA = Array.isArray(data.agent_a) ? data.agent_a[0] : data.agent_a;
  const agentB = Array.isArray(data.agent_b) ? data.agent_b[0] : data.agent_b;
  const owner = agentA?.user_id === worldUserId || agentB?.user_id === worldUserId;
  if (!owner) return null;

  return {
    status: String(data.status ?? ''),
    agent_a_id: String(data.agent_a_id ?? ''),
  };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: conversationId } = await params;

  // ---- 1. Auth ----------------------------------------------------------
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let worldUserId: string;
  try {
    const claims = await verifyWorldUserJwt(token);
    worldUserId = claims.world_user_id;
  } catch {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // ---- 2. Ownership -----------------------------------------------------
  const supabase = getServiceClient();
  const ownership = await verifyOwnership(supabase, conversationId, worldUserId);
  if (!ownership) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  // Captured so the SSE framing helpers can map speaker_agent_id → 'A' | 'B'
  // without re-querying per turn.
  const agentAId = ownership.agent_a_id;

  // ---- 3. Initial replay range -----------------------------------------
  // Some webview environments strip the Last-Event-ID header on reconnect.
  // Accept the same value as a ?lastEventId= query param fallback so resume
  // works in those environments too (LiveTranscript sends both).
  const headerLastEventId = req.headers.get('Last-Event-ID');
  const url = new URL(req.url);
  const queryLastEventId = url.searchParams.get('lastEventId');
  const lastEventIdFloor = parseLastEventId(headerLastEventId ?? queryLastEventId);

  const encoder = new TextEncoder();

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let statusTimer: ReturnType<typeof setInterval> | null = null;
  let channel: ReturnType<typeof supabase.channel> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (frame: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          // Stream already closed by consumer.
          closed = true;
        }
      };

      const teardown = (): void => {
        if (closed) return;
        closed = true;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (statusTimer) clearInterval(statusTimer);
        if (channel) {
          // unsubscribe is fire-and-forget; supabase removes the topic.
          void supabase.removeChannel(channel).catch(() => {
            /* swallow — connection already torn down */
          });
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // ---- 3a. Subscribe FIRST (race-safe ordering) -------------------
      //
      // Order matters: if we replay before subscribing, any INSERT that
      // lands between "replay completed" and "Realtime SUBSCRIBED" is lost
      // — it isn't in the replay snapshot, and it never reaches us via
      // Realtime. To close the gap:
      //
      //   1. .on() handler is registered up front.
      //   2. While we wait for SUBSCRIBED + run replay, every Realtime
      //      payload is BUFFERED (not emitted).
      //   3. After replay completes we flush the buffer, dropping any
      //      payload whose turn_index is already covered by replay.
      //
      // `lastSeen` is the watermark used both for replay-vs-realtime
      // dedupe and for filtering buffered events on flush.
      let lastSeen = lastEventIdFloor;
      let replayComplete = false;
      const buffered: ConversationTurnRow[] = [];

      channel = supabase.channel(`conv:${conversationId}`).on(
        REALTIME_LISTEN_TYPES.POSTGRES_CHANGES,
        {
          event: REALTIME_POSTGRES_CHANGES_LISTEN_EVENT.INSERT,
          schema: 'public',
          table: 'conversation_turns',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload: RealtimePostgresInsertPayload<ConversationTurnRow>) => {
          const row = payload.new;
          if (typeof row.turn_index !== 'number') return;
          if (!replayComplete) {
            // Buffer until replay finishes; flush handles dedupe.
            buffered.push(row);
            return;
          }
          // Steady state: drop turns we already emitted (replay or earlier flush).
          if (row.turn_index <= lastSeen) return;
          lastSeen = row.turn_index;
          safeEnqueue(formatTurnEvent(row, agentAId));
        },
      );

      await new Promise<void>((resolve) => {
        channel!.subscribe((status) => {
          if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
            resolve();
          } else if (
            status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
            status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT ||
            status === REALTIME_SUBSCRIBE_STATES.CLOSED
          ) {
            // Resolve even on failure — the status backstop will keep the
            // stream alive and eventually close it via terminal status.
            // Buffered events (if any) will still be flushed below; the
            // status poller is the safety net for missed inserts.
            resolve();
          }
        });
      });

      // ---- 3b. Initial replay (now that we're subscribed) -------------
      const { data: replayRows, error: replayError } = await supabase
        .from('conversation_turns')
        .select('turn_index, text, speaker_agent_id')
        .eq('conversation_id', conversationId)
        .gt('turn_index', lastEventIdFloor)
        .order('turn_index', { ascending: true });

      if (replayError) {
        console.error('stream replay error:', replayError);
        safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: 'replay_failed' })}\n\n`);
        teardown();
        return;
      }

      for (const row of (replayRows ?? []) as ConversationTurnRow[]) {
        safeEnqueue(formatTurnEvent(row, agentAId));
        if (row.turn_index > lastSeen) lastSeen = row.turn_index;
      }

      // ---- 3c. Flush buffered Realtime events -------------------------
      // Anything received during the subscribe-or-replay window that the
      // replay snapshot didn't already cover gets emitted here exactly once.
      replayComplete = true;
      for (const row of buffered) {
        if (row.turn_index > lastSeen) {
          lastSeen = row.turn_index;
          safeEnqueue(formatTurnEvent(row, agentAId));
        }
      }
      buffered.length = 0;

      // If status was already terminal at connect time, emit + close.
      if (TERMINAL_STATUSES.has(ownership.status)) {
        safeEnqueue(formatCompleteEvent(ownership.status));
        teardown();
        return;
      }

      // ---- 4. Heartbeat ----------------------------------------------
      heartbeatTimer = setInterval(() => {
        safeEnqueue(`: heartbeat\n\n`);
      }, HEARTBEAT_INTERVAL_MS);

      // ---- 5. Status backstop ----------------------------------------
      statusTimer = setInterval(async () => {
        if (closed) return;
        const { data: row, error } = await supabase
          .from('conversations')
          .select('status')
          .eq('id', conversationId)
          .maybeSingle();
        if (error || !row) return;
        const status = String(row.status ?? '');
        if (TERMINAL_STATUSES.has(status)) {
          safeEnqueue(formatCompleteEvent(status));
          teardown();
        }
      }, STATUS_POLL_INTERVAL_MS);
    },

    cancel() {
      closed = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (statusTimer) clearInterval(statusTimer);
      if (channel) {
        void supabase.removeChannel(channel).catch(() => {
          /* swallow */
        });
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
