// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { signWorldUserJwt } from '@/lib/auth/jwt';

// ---------------------------------------------------------------------------
// Mocks: cookies(), getServiceClient, and the Realtime channel chain.
//
// We intentionally keep the mock surface narrow — testing the SSE wiring
// end-to-end through ReadableStream + setInterval + Realtime subscribe is
// flaky under fake timers. Instead we cover the decision boundaries
// (auth, ownership, replay query shape, dedup logic) and treat full
// streaming as integration-level coverage handled by the next-step e2e.
// ---------------------------------------------------------------------------

const cookieGet = vi.fn<(name: string) => { value: string } | undefined>();
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: cookieGet }),
}));

interface QueryStub {
  data: unknown;
  error: unknown;
}

const conversationsLookupStub: QueryStub = { data: null, error: null };
const replayStub: QueryStub = { data: [], error: null };
const statusPollStub: QueryStub = { data: null, error: null };

const channelOn = vi.fn();
const channelSubscribe = vi.fn();
const removeChannel = vi.fn().mockResolvedValue(undefined);
// Each .on() returns a chainable object whose subscribe() is our mock.
// We don't call channelOn.mockReturnValue in the factory because that would
// overwrite per-test mockImplementation overrides used to capture the
// postgres_changes callback for synthetic event firing.
const channel = vi.fn(() => ({ on: channelOn }));

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: () => ({
    from: (table: string) => {
      if (table === 'conversations') {
        return {
          // verifyOwnership uses .select(...).eq('id', ...).maybeSingle()
          // status backstop uses .select('status').eq('id', ...).maybeSingle()
          select: (cols: string) => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve(cols === 'status' ? statusPollStub : conversationsLookupStub),
            }),
          }),
        };
      }
      if (table === 'conversation_turns') {
        return {
          select: () => ({
            eq: () => ({
              gt: () => ({
                order: () => Promise.resolve(replayStub),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    channel,
    removeChannel,
  }),
}));

// Auth helpers — JWT signing imported AFTER mocks above.
const CONV_ID = 'conv-uuid-1';
const WORLD_USER = 'user-uuid-1';

async function tokenFor(userId: string): Promise<string> {
  return signWorldUserJwt({
    world_user_id: userId,
    nullifier: 'nullifier-test',
    language_pref: 'ko',
  });
}

function setOwner(userId: string, status = 'live'): void {
  conversationsLookupStub.data = {
    status,
    agent_a: { user_id: userId },
    agent_b: { user_id: 'other-user' },
  };
  conversationsLookupStub.error = null;
}

beforeEach(() => {
  cookieGet.mockReset();
  channelOn.mockReset();
  // Default behaviour: just return the chain object so .subscribe() works.
  channelOn.mockReturnValue({ subscribe: channelSubscribe });
  channelSubscribe.mockReset();
  channel.mockClear();
  removeChannel.mockClear();
  conversationsLookupStub.data = null;
  conversationsLookupStub.error = null;
  replayStub.data = [];
  replayStub.error = null;
  statusPollStub.data = null;
  statusPollStub.error = null;

  // Default subscribe behaviour: invoke callback synchronously with
  // SUBSCRIBED so route's `await new Promise()` resolves immediately.
  channelSubscribe.mockImplementation((cb?: (status: string) => void) => {
    cb?.('SUBSCRIBED');
    return { on: channelOn };
  });
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Read chunks from an SSE stream until either:
 *   - the predicate returns true on the accumulated decoded text, OR
 *   - the stream closes (done), OR
 *   - we hit `maxReads` (safety bound to avoid runaway tests).
 *
 * The route enqueues each SSE frame as a separate chunk, so any test that
 * needs to assert across multiple frames must drain rather than read once.
 */
async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (acc: string) => boolean,
  maxReads = 20,
): Promise<string> {
  const decoder = new TextDecoder();
  let acc = '';
  for (let i = 0; i < maxReads; i++) {
    const { value, done } = await reader.read();
    if (value) acc += decoder.decode(value, { stream: true });
    if (done) break;
    if (predicate(acc)) break;
  }
  return acc;
}

async function callRoute(
  opts: {
    cookie?: { value: string };
    lastEventId?: string;
  } = {},
): Promise<Response> {
  if (opts.cookie) cookieGet.mockReturnValue(opts.cookie);
  else cookieGet.mockReturnValue(undefined);

  const headers = new Headers();
  if (opts.lastEventId !== undefined) {
    headers.set('Last-Event-ID', opts.lastEventId);
  }
  const req = new Request(`http://test/api/conversation/${CONV_ID}/stream`, {
    method: 'GET',
    headers,
  });
  const { GET } = await import('../route');
  return GET(req, { params: Promise.resolve({ id: CONV_ID }) });
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for direct unit coverage of the SSE framing logic.
// ---------------------------------------------------------------------------

describe('stream route helpers', () => {
  it('formatTurnEvent emits id + event + data SSE frame', async () => {
    const { formatTurnEvent } = await import('../route');
    const frame = formatTurnEvent({
      turn_index: 7,
      text: 'hello',
      speaker_agent_id: 'agent-1',
    });
    expect(frame).toContain('id: 7\n');
    expect(frame).toContain('event: turn\n');
    expect(frame).toContain(
      `data: ${JSON.stringify({ turn_index: 7, text: 'hello', speaker_agent_id: 'agent-1' })}\n\n`,
    );
  });

  it('formatCompleteEvent emits terminal status frame', async () => {
    const { formatCompleteEvent } = await import('../route');
    expect(formatCompleteEvent('completed')).toBe(
      `event: complete\ndata: ${JSON.stringify({ status: 'completed' })}\n\n`,
    );
  });

  it('parseLastEventId returns -1 when missing/invalid, the int otherwise', async () => {
    const { parseLastEventId } = await import('../route');
    expect(parseLastEventId(null)).toBe(-1);
    expect(parseLastEventId('')).toBe(-1);
    expect(parseLastEventId('not-a-number')).toBe(-1);
    expect(parseLastEventId('-5')).toBe(-1);
    expect(parseLastEventId('0')).toBe(0);
    expect(parseLastEventId('42')).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// Auth + ownership — must always return 403 (NOT 401), per US-204 design note.
// ---------------------------------------------------------------------------

describe('GET /api/conversation/[id]/stream — auth gating', () => {
  it('returns 403 when ws_session cookie is missing', async () => {
    const res = await callRoute();
    expect(res.status).toBe(403);
    expect(channel).not.toHaveBeenCalled();
  });

  it('returns 403 when JWT is invalid', async () => {
    const res = await callRoute({ cookie: { value: 'not-a-jwt' } });
    expect(res.status).toBe(403);
    expect(channel).not.toHaveBeenCalled();
  });

  it('returns 403 when conversation lookup returns null (not found)', async () => {
    const token = await tokenFor(WORLD_USER);
    conversationsLookupStub.data = null;
    const res = await callRoute({ cookie: { value: token } });
    expect(res.status).toBe(403);
    expect(channel).not.toHaveBeenCalled();
  });

  it('returns 403 when authenticated user does not own either agent', async () => {
    const token = await tokenFor(WORLD_USER);
    conversationsLookupStub.data = {
      status: 'live',
      agent_a: { user_id: 'somebody-else' },
      agent_b: { user_id: 'another-person' },
    };
    const res = await callRoute({ cookie: { value: token } });
    expect(res.status).toBe(403);
    expect(channel).not.toHaveBeenCalled();
  });

  it('opens the SSE stream when caller owns agent_a', async () => {
    const token = await tokenFor(WORLD_USER);
    setOwner(WORLD_USER);
    const res = await callRoute({ cookie: { value: token } });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(res.headers.get('Connection')).toBe('keep-alive');
    expect(res.headers.get('X-Accel-Buffering')).toBe('no');
    // Drain to allow start() to fire and register the channel.
    await res.body!.cancel();
  });
});

// ---------------------------------------------------------------------------
// Initial replay query shape + Last-Event-ID floor
// ---------------------------------------------------------------------------

describe('GET /api/conversation/[id]/stream — initial replay', () => {
  it('emits SSE turn frames for rows above Last-Event-ID', async () => {
    const token = await tokenFor(WORLD_USER);
    setOwner(WORLD_USER);
    replayStub.data = [
      { turn_index: 3, text: 'three', speaker_agent_id: 'a' },
      { turn_index: 4, text: 'four', speaker_agent_id: 'b' },
    ];

    const res = await callRoute({
      cookie: { value: token },
      lastEventId: '2',
    });

    const reader = res.body!.getReader();
    const text = await readUntil(reader, (acc) => acc.includes('id: 4\n'));

    expect(text).toContain('id: 3\n');
    expect(text).toContain('id: 4\n');
    expect(text).toContain('"text":"three"');
    expect(text).toContain('"text":"four"');

    await reader.cancel();
  });

  it('replay error yields error event and closes stream', async () => {
    const token = await tokenFor(WORLD_USER);
    setOwner(WORLD_USER);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    replayStub.error = { message: 'db down' };
    replayStub.data = null;

    const res = await callRoute({ cookie: { value: token } });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const first = await reader.read();
    const text = decoder.decode(first.value);
    expect(text).toContain('event: error');
    expect(text).toContain('replay_failed');

    // Stream should close itself after error.
    const next = await reader.read();
    expect(next.done).toBe(true);

    errSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Realtime dedup — turns at or below the replay max are dropped.
// ---------------------------------------------------------------------------

describe('GET /api/conversation/[id]/stream — Realtime dedup', () => {
  it('drops Realtime payloads with turn_index <= max(replay), forwards higher', async () => {
    const token = await tokenFor(WORLD_USER);
    setOwner(WORLD_USER);
    replayStub.data = [
      { turn_index: 1, text: 'one', speaker_agent_id: 'a' },
      { turn_index: 2, text: 'two', speaker_agent_id: 'b' },
    ];

    // Capture the registered postgres_changes callback so we can fire it
    // synthetically — bypasses the real Realtime websocket.
    let captured: ((p: { new: Record<string, unknown> }) => void) | null = null;
    channelOn.mockImplementation((_type, _filter, cb) => {
      captured = cb as typeof captured;
      return { subscribe: channelSubscribe };
    });

    const res = await callRoute({ cookie: { value: token } });
    const reader = res.body!.getReader();

    // Drain initial replay frames first; route emits each frame as its own
    // chunk, so loop until we see the highest replay turn_index.
    const initial = await readUntil(reader, (acc) => acc.includes('id: 2\n'));
    expect(initial).toContain('id: 1\n');
    expect(initial).toContain('id: 2\n');

    expect(captured).not.toBeNull();
    // Duplicate of replay max — must be dropped.
    captured!({ new: { turn_index: 2, text: 'dup', speaker_agent_id: 'a' } });
    // Lower than replay max — also dropped.
    captured!({ new: { turn_index: 1, text: 'older', speaker_agent_id: 'a' } });
    // Strictly higher — must be forwarded.
    captured!({ new: { turn_index: 3, text: 'three', speaker_agent_id: 'b' } });

    const next = await readUntil(reader, (acc) => acc.includes('id: 3\n'));
    expect(next).toContain('id: 3\n');
    expect(next).toContain('"text":"three"');
    expect(next).not.toContain('"text":"dup"');
    expect(next).not.toContain('"text":"older"');

    await reader.cancel();
  });
});

// ---------------------------------------------------------------------------
// Status backstop — terminal status emits `complete` and closes.
// ---------------------------------------------------------------------------

describe('GET /api/conversation/[id]/stream — status backstop', () => {
  it('emits complete + closes when conversation status is already terminal at connect', async () => {
    const token = await tokenFor(WORLD_USER);
    setOwner(WORLD_USER, 'completed');

    const res = await callRoute({ cookie: { value: token } });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // After replay (empty here) the route sees terminal status and emits
    // the complete frame, then closes.
    const first = await reader.read();
    expect(decoder.decode(first.value)).toContain('event: complete');
    expect(decoder.decode(first.value)).toContain('"status":"completed"');

    const next = await reader.read();
    expect(next.done).toBe(true);
  });

  it('removes the Realtime channel on cancel', async () => {
    const token = await tokenFor(WORLD_USER);
    setOwner(WORLD_USER);
    // Seed at least one replay row so start() enqueues something the reader
    // can immediately consume — guarantees start() finishes before cancel.
    replayStub.data = [{ turn_index: 0, text: 'seed', speaker_agent_id: 'a' }];

    const res = await callRoute({ cookie: { value: token } });
    const reader = res.body!.getReader();
    // Drain the seed frame; this also blocks until start() has reached the
    // heartbeat/status interval setup, so cancel() will tear down properly.
    await readUntil(reader, (acc) => acc.includes('id: 0\n'));
    await reader.cancel();

    // Allow the microtask queue to flush teardown side-effects.
    await new Promise((r) => setImmediate(r));
    expect(removeChannel).toHaveBeenCalled();
  });
});
