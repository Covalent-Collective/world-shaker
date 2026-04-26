// @vitest-environment node

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------- module mocks (must be hoisted before importing the SUT) -------

vi.mock('@/lib/llm/openrouter', () => {
  return {
    DEFAULT_CHAT_MODEL: 'mock/model',
    streamChat: vi.fn(),
  };
});

vi.mock('@/lib/llm/safety', () => {
  return {
    detectRepeatLoop: vi.fn(),
    detectHostileTone: vi.fn(),
    detectNSFW: vi.fn(),
  };
});

vi.mock('@/lib/llm/budget', () => {
  return {
    assertBudgetAvailable: vi.fn(),
  };
});

vi.mock('@/lib/llm/prompts/persona', () => ({
  buildPersonaPrompt: vi.fn(() => 'persona-system'),
}));

vi.mock('@/lib/llm/prompts/agent-dialogue', () => ({
  buildDialoguePrompt: vi.fn(() => ({
    system: 'dialogue-system',
    messages: [],
  })),
}));

// Build a minimal fluent supabase mock that can answer:
//   .from('agents').select(...).in(...) -> returns rows
//   .from('outcome_events').insert(payload) -> records call
//   .from('conversations').update({...}).eq(...).eq(...).select('id') -> rows
//   .from('conversations').select(...).eq('id', X).maybeSingle() -> conversationLookup row
//   .rpc('allocate_conversation_attempt', ...) -> id
//   .rpc('append_turn_with_ledger', ...) -> bool
function makeSupabaseMock(opts: {
  agents: Array<{ id: string; user_id: string; extracted_features: Record<string, unknown> }>;
  rpcAllocate: () => string;
  rpcAppend: () => boolean | { sequence: boolean[] };
  // Each entry controls one heartbeat call. true = "still live" (returns 1
  // row), false = "terminated externally" (returns 0 rows). Defaults to
  // true when the array runs out.
  heartbeatStillLive: () => boolean[];
  // When set, .from('conversations').select(...).eq('id', X).maybeSingle()
  // returns this row (or null). Used for the pre-allocated conversation_id path.
  conversationLookup?: {
    id: string;
    surface: string;
    agent_a_id: string;
    agent_b_id: string;
    status: string;
  } | null;
}) {
  const insertCalls: Array<{ table: string; payload: unknown }> = [];
  const updateCalls: Array<{ table: string; payload: Record<string, unknown> }> = [];
  let rpcAllocate = vi.fn();
  let rpcAppend = vi.fn();

  // Track per-call return for heartbeat update.
  let heartbeatCallIndex = 0;
  const heartbeatSequence = opts.heartbeatStillLive();

  const supabase = {
    rpc: vi.fn((name: string, args: Record<string, unknown>) => {
      if (name === 'allocate_conversation_attempt') {
        return Promise.resolve({ data: rpcAllocate(args), error: null });
      }
      if (name === 'append_turn_with_ledger') {
        return Promise.resolve({ data: rpcAppend(args), error: null });
      }
      throw new Error(`unexpected rpc: ${name}`);
    }),
    from: vi.fn((table: string) => {
      if (table === 'agents') {
        return {
          select: vi.fn(() => ({
            in: vi.fn(() => Promise.resolve({ data: opts.agents, error: null })),
          })),
        };
      }
      if (table === 'outcome_events') {
        return {
          insert: vi.fn((payload: unknown) => {
            insertCalls.push({ table: 'outcome_events', payload });
            return Promise.resolve({ data: null, error: null });
          }),
        };
      }
      if (table === 'conversations') {
        return {
          select: vi.fn(() => {
            // Fluent chain for: .select(...).eq('id', X).maybeSingle()
            // Used by the pre-allocated conversation_id lookup path.
            const eqChain = {
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(() =>
                  Promise.resolve({ data: opts.conversationLookup ?? null, error: null }),
                ),
              })),
            };
            return eqChain;
          }),
          update: vi.fn((payload: Record<string, unknown>) => {
            updateCalls.push({ table: 'conversations', payload });
            // Determine: is this a heartbeat (.select('id') chain) or a status update?
            const eqStatus = vi.fn();
            const chain = {
              eq: vi.fn(() => chain),
              select: vi.fn(() => {
                const stillLive = heartbeatSequence[heartbeatCallIndex] ?? true;
                heartbeatCallIndex++;
                const rows = stillLive ? [{ id: 'conv-1' }] : [];
                return Promise.resolve({ data: rows, error: null });
              }),
            };
            // mark/return self so .eq().eq() chains
            return {
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  select: chain.select,
                  // For mark-failed / mark-completed (no .select()), supabase
                  // returns a thenable that resolves with { data, error }.
                  then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
                    resolve({ data: null, error: null }),
                })),
                select: chain.select,
                // single .eq() with no follow-on
                then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
                  resolve({ data: null, error: null }),
              })),
              eqStatus,
            };
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  };

  rpcAllocate = vi.fn((_args: Record<string, unknown>) => opts.rpcAllocate());
  rpcAppend = vi.fn((_args: Record<string, unknown>) => {
    const v = opts.rpcAppend();
    return typeof v === 'boolean' ? v : (v.sequence.shift() ?? true);
  });

  return { supabase, insertCalls, updateCalls };
}

// Mock service client to return our fake supabase.
let activeSupabase: ReturnType<typeof makeSupabaseMock>['supabase'] | null = null;
vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: () => {
    if (!activeSupabase) throw new Error('test: activeSupabase not set');
    return activeSupabase;
  },
}));

// Inngest step shim. step.run(id, fn) -> awaits fn(). step.sendEvent records.
function makeStepShim() {
  const sentEvents: Array<{ id: string; payload: { name: string; data: unknown } }> = [];
  const step = {
    run: vi.fn(<T>(_id: string, fn: () => Promise<T> | T) => Promise.resolve().then(fn)),
    sendEvent: vi.fn((id: string, payload: { name: string; data: unknown }) => {
      sentEvents.push({ id, payload });
      return Promise.resolve({ ids: [`evt-${sentEvents.length}`] });
    }),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { step, logger, sentEvents };
}

// ---------- helpers ------------------------------------------------------

function streamingChatYielding(text: string, usage = mkUsage()) {
  // Mock returns an async generator that yields chunks then a final done.
  return async function* () {
    yield { delta: text, done: false };
    yield { delta: '', done: true, usage };
  };
}

function mkUsage(
  overrides: Partial<{
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
    model: string;
  }> = {},
) {
  return {
    input_tokens: overrides.input_tokens ?? 5,
    output_tokens: overrides.output_tokens ?? 7,
    cost_usd: overrides.cost_usd ?? 0.0001,
    model: overrides.model ?? 'mock/model',
  };
}

const baseEvent = {
  data: {
    user_id: 'user-1',
    surface: 'dating' as const,
    agent_a_id: 'agent-a',
    agent_b_id: 'agent-b',
    // pair_key intentionally omitted: the function computes it internally now.
    language: 'en' as const,
    max_turns: 4,
  },
};

const baseAgents = [
  { id: 'agent-a', user_id: 'user-1', extracted_features: { voice: 'A' } },
  { id: 'agent-b', user_id: 'user-2', extracted_features: { voice: 'B' } },
];

// ---------- tests --------------------------------------------------------

describe('liveConversation Inngest fn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeSupabase = null;
  });

  async function importFn() {
    const mod = await import('../live-conversation');
    return mod;
  }

  async function runFn(opts: {
    supa: ReturnType<typeof makeSupabaseMock>;
    eventOverrides?: Partial<typeof baseEvent.data>;
  }) {
    activeSupabase = opts.supa.supabase;
    const { liveConversation } = await importFn();
    const { step, logger, sentEvents } = makeStepShim();
    // Cast through unknown — we only exercise event/step/logger inside the handler.
    const handler = (
      liveConversation as unknown as {
        fn: (ctx: {
          event: typeof baseEvent;
          step: typeof step;
          logger: typeof logger;
        }) => Promise<unknown>;
      }
    ).fn;

    const event = {
      ...baseEvent,
      data: { ...baseEvent.data, ...(opts.eventOverrides ?? {}) },
    };
    const result = await handler({ event, step, logger });
    return { result, step, logger, sentEvents };
  }

  it('pre-flight passes when budget ok and not paused', async () => {
    const { assertBudgetAvailable } = await import('@/lib/llm/budget');
    (assertBudgetAvailable as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    const { streamChat } = await import('@/lib/llm/openrouter');
    (streamChat as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      streamingChatYielding('Hello there.'),
    );

    const safety = await import('@/lib/llm/safety');
    (safety.detectRepeatLoop as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (safety.detectHostileTone as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      flagged: false,
      reason: 'clean',
    });
    (safety.detectNSFW as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      flagged: false,
      reason: 'clean',
    });

    const supa = makeSupabaseMock({
      agents: baseAgents,
      rpcAllocate: () => 'conv-1',
      rpcAppend: () => true,
      heartbeatStillLive: () => Array(10).fill(true),
    });

    const { result, sentEvents } = await runFn({ supa });

    expect((result as { status: string }).status).toBe('completed');
    expect(sentEvents.find((e) => e.payload.name === 'conversation.completed')).toBeDefined();
    // Allocation happened with canonically computed pair_key (agent-a < agent-b lexically).
    expect(supa.supabase.rpc).toHaveBeenCalledWith(
      'allocate_conversation_attempt',
      expect.objectContaining({ p_pair_key: 'agent-a|agent-b' }),
    );
  });

  it('pair_key is computed canonically regardless of event payload order', async () => {
    const { assertBudgetAvailable } = await import('@/lib/llm/budget');
    (assertBudgetAvailable as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    const { streamChat } = await import('@/lib/llm/openrouter');
    (streamChat as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      streamingChatYielding('Hello there.'),
    );

    const safety = await import('@/lib/llm/safety');
    (safety.detectRepeatLoop as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (safety.detectHostileTone as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      flagged: false,
      reason: 'clean',
    });
    (safety.detectNSFW as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      flagged: false,
      reason: 'clean',
    });

    // Swap agent IDs so B < A lexically to verify canonical ordering is enforced.
    const swappedAgents = [
      { id: 'zzz-agent', user_id: 'user-1', extracted_features: { voice: 'A' } },
      { id: 'aaa-agent', user_id: 'user-2', extracted_features: { voice: 'B' } },
    ];

    const supa = makeSupabaseMock({
      agents: swappedAgents,
      rpcAllocate: () => 'conv-swap',
      rpcAppend: () => true,
      heartbeatStillLive: () => Array(10).fill(true),
    });

    await runFn({
      supa,
      eventOverrides: {
        agent_a_id: 'zzz-agent',
        agent_b_id: 'aaa-agent',
        // Supply a wrong pair_key to verify it is ignored.
        pair_key: 'wrong-key|should-be-ignored',
        max_turns: 1,
      } as typeof baseEvent.data & { pair_key?: string },
    });

    // Canonical key: aaa-agent < zzz-agent lexically -> 'aaa-agent|zzz-agent'.
    expect(supa.supabase.rpc).toHaveBeenCalledWith(
      'allocate_conversation_attempt',
      expect.objectContaining({ p_pair_key: 'aaa-agent|zzz-agent' }),
    );
  });

  it('pre-flight fails on global cap -> wont_connect outcome, no allocation', async () => {
    const { assertBudgetAvailable } = await import('@/lib/llm/budget');
    (assertBudgetAvailable as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      reason: 'global_cap_exceeded',
    });

    const supa = makeSupabaseMock({
      agents: baseAgents,
      rpcAllocate: () => {
        throw new Error('should not allocate when pre-flight failed');
      },
      rpcAppend: () => true,
      heartbeatStillLive: () => [true],
    });

    const { result } = await runFn({ supa });

    expect(result).toMatchObject({ aborted: true, reason: 'global_cap_exceeded' });
    // outcome_event insert recorded.
    const outcome = supa.insertCalls.find((c) => c.table === 'outcome_events');
    expect(outcome).toBeDefined();
    const payload = outcome!.payload as Record<string, unknown>;
    expect(payload.event_type).toBe('wont_connect');
    expect((payload.metadata as { reason: string }).reason).toBe('global_cap_exceeded');
    // RPC never called.
    expect(supa.supabase.rpc).not.toHaveBeenCalled();
  });

  it('pre-flight fails on streaming_paused -> wont_connect outcome, no allocation', async () => {
    const { assertBudgetAvailable } = await import('@/lib/llm/budget');
    (assertBudgetAvailable as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      reason: 'streaming_paused',
    });

    const supa = makeSupabaseMock({
      agents: baseAgents,
      rpcAllocate: () => {
        throw new Error('should not allocate when streaming paused');
      },
      rpcAppend: () => true,
      heartbeatStillLive: () => [true],
    });

    const { result } = await runFn({ supa });

    expect(result).toMatchObject({ aborted: true, reason: 'streaming_paused' });
    const outcome = supa.insertCalls.find((c) => c.table === 'outcome_events');
    expect(outcome).toBeDefined();
    expect(supa.supabase.rpc).not.toHaveBeenCalled();
  });

  it('happy path: 4 turns generated, all clean, completed event emitted', async () => {
    const { assertBudgetAvailable } = await import('@/lib/llm/budget');
    (assertBudgetAvailable as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    const { streamChat } = await import('@/lib/llm/openrouter');
    let turnIdx = 0;
    (streamChat as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const t = turnIdx++;
      return streamingChatYielding(`turn-${t}-text`)();
    });

    const safety = await import('@/lib/llm/safety');
    (safety.detectRepeatLoop as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (safety.detectHostileTone as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      flagged: false,
      reason: 'clean',
    });
    (safety.detectNSFW as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      flagged: false,
      reason: 'clean',
    });

    const supa = makeSupabaseMock({
      agents: baseAgents,
      rpcAllocate: () => 'conv-happy',
      rpcAppend: () => true,
      heartbeatStillLive: () => Array(10).fill(true),
    });

    const { result, sentEvents } = await runFn({ supa });

    expect((result as { status: string }).status).toBe('completed');
    expect((result as { turns: number }).turns).toBe(4);

    // append_turn_with_ledger called 4 times.
    const appendCalls = (
      supa.supabase.rpc as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.filter((c) => c[0] === 'append_turn_with_ledger');
    expect(appendCalls).toHaveLength(4);

    // Last event is conversation.completed.
    expect(sentEvents.at(-1)?.payload.name).toBe('conversation.completed');
    expect((sentEvents.at(-1)?.payload.data as { conversation_id: string }).conversation_id).toBe(
      'conv-happy',
    );
  });

  it('hostile flagged at turn 3 -> failed status, conversation.failed event, no further turns', async () => {
    const { assertBudgetAvailable } = await import('@/lib/llm/budget');
    (assertBudgetAvailable as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    const { streamChat } = await import('@/lib/llm/openrouter');
    (streamChat as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      streamingChatYielding('some text'),
    );

    const safety = await import('@/lib/llm/safety');
    (safety.detectRepeatLoop as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (safety.detectNSFW as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      flagged: false,
      reason: 'clean',
    });

    let hostileCallIdx = 0;
    (safety.detectHostileTone as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async () => {
        const idx = hostileCallIdx++;
        if (idx === 3) {
          return { flagged: true, reason: 'flagged' as const };
        }
        return { flagged: false, reason: 'clean' as const };
      },
    );

    const supa = makeSupabaseMock({
      agents: baseAgents,
      rpcAllocate: () => 'conv-fail',
      rpcAppend: () => true,
      heartbeatStillLive: () => Array(10).fill(true),
    });

    const { result, sentEvents } = await runFn({
      supa,
      eventOverrides: { max_turns: 10 },
    });

    expect((result as { status: string }).status).toBe('failed');
    expect((result as { turn_index: number }).turn_index).toBe(3);

    // Only first 3 turns appended (turn 3 itself failed before append).
    const appendCalls = (
      supa.supabase.rpc as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.filter((c) => c[0] === 'append_turn_with_ledger');
    expect(appendCalls).toHaveLength(3);

    expect(sentEvents.find((e) => e.payload.name === 'conversation.failed')).toBeDefined();
    // conversation.completed NOT emitted.
    expect(sentEvents.find((e) => e.payload.name === 'conversation.completed')).toBeUndefined();
  });

  it('duplicate retry: append returns false on a turn -> continues, no double-charge thrown', async () => {
    const { assertBudgetAvailable } = await import('@/lib/llm/budget');
    (assertBudgetAvailable as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    const { streamChat } = await import('@/lib/llm/openrouter');
    (streamChat as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      streamingChatYielding('text'),
    );

    const safety = await import('@/lib/llm/safety');
    (safety.detectRepeatLoop as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (safety.detectHostileTone as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      flagged: false,
      reason: 'clean',
    });
    (safety.detectNSFW as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      flagged: false,
      reason: 'clean',
    });

    // turn 0 -> false (duplicate retry), turns 1..3 -> true
    const appendSequence = [false, true, true, true];
    let appendCallIdx = 0;

    const supa = makeSupabaseMock({
      agents: baseAgents,
      rpcAllocate: () => 'conv-dup',
      rpcAppend: () => appendSequence[appendCallIdx++] ?? true,
      heartbeatStillLive: () => Array(10).fill(true),
    });

    const { result } = await runFn({ supa });

    expect((result as { status: string }).status).toBe('completed');
    expect((result as { turns: number }).turns).toBe(4);

    // No double-charge: assertion is that the function still completed,
    // and append_turn_with_ledger was called exactly once per turn (4x).
    const appendCalls = (
      supa.supabase.rpc as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.filter((c) => c[0] === 'append_turn_with_ledger');
    expect(appendCalls).toHaveLength(4);
  });

  it('concurrent abort: heartbeat returns 0 rows on turn 3 -> exits without completed', async () => {
    const { assertBudgetAvailable } = await import('@/lib/llm/budget');
    (assertBudgetAvailable as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    const { streamChat } = await import('@/lib/llm/openrouter');
    (streamChat as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      streamingChatYielding('text'),
    );

    const safety = await import('@/lib/llm/safety');
    (safety.detectRepeatLoop as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (safety.detectHostileTone as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      flagged: false,
      reason: 'clean',
    });
    (safety.detectNSFW as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      flagged: false,
      reason: 'clean',
    });

    // Heartbeats 0,1,2 -> still live; 3 -> 0 rows (someone else terminated).
    const supa = makeSupabaseMock({
      agents: baseAgents,
      rpcAllocate: () => 'conv-abort',
      rpcAppend: () => true,
      heartbeatStillLive: () => [true, true, true, false, true, true, true, true, true, true],
    });

    const { result, sentEvents } = await runFn({
      supa,
      eventOverrides: { max_turns: 10 },
    });

    expect((result as { status: string }).status).toBe('terminated_externally');
    expect(sentEvents.find((e) => e.payload.name === 'conversation.completed')).toBeUndefined();
  });

  it('per-turn budget cap: passes turns 0-2, fails at turn 3 -> conversation marked failed, no further turns', async () => {
    const { assertBudgetAvailable } = await import('@/lib/llm/budget');
    // Initial preflight + per-turn preflight for turns 0,1,2 -> ok. Turn 3 -> cap exceeded.
    // mockResolvedValueOnce chains: calls 1-4 (initial + turns 0,1,2) return ok; call 5 (turn 3) returns cap exceeded.
    const budgetMock = assertBudgetAvailable as unknown as ReturnType<typeof vi.fn>;
    budgetMock
      .mockResolvedValueOnce({ ok: true }) // initial preflight
      .mockResolvedValueOnce({ ok: true }) // turn 0 preflight
      .mockResolvedValueOnce({ ok: true }) // turn 1 preflight
      .mockResolvedValueOnce({ ok: true }) // turn 2 preflight
      .mockResolvedValueOnce({ ok: false, reason: 'global_cap_exceeded' }); // turn 3 -> abort

    const { streamChat } = await import('@/lib/llm/openrouter');
    (streamChat as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      streamingChatYielding('some text'),
    );

    const safety = await import('@/lib/llm/safety');
    (safety.detectRepeatLoop as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (safety.detectHostileTone as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      flagged: false,
      reason: 'clean',
    });
    (safety.detectNSFW as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      flagged: false,
      reason: 'clean',
    });

    const supa = makeSupabaseMock({
      agents: baseAgents,
      rpcAllocate: () => 'conv-budget-cap',
      rpcAppend: () => true,
      heartbeatStillLive: () => Array(10).fill(true),
    });

    const { result, sentEvents } = await runFn({
      supa,
      eventOverrides: { max_turns: 10 },
    });

    // Aborted at turn 3 due to budget cap.
    expect((result as { status: string }).status).toBe('failed');
    expect((result as { turn_index: number }).turn_index).toBe(3);
    expect((result as { reason: string }).reason).toBe('cost_cap_exceeded');

    // Only turns 0,1,2 were appended (turn 3 aborted before generate).
    const appendCalls = (
      supa.supabase.rpc as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.filter((c) => c[0] === 'append_turn_with_ledger');
    expect(appendCalls).toHaveLength(3);

    // conversation.failed emitted, conversation.completed NOT emitted.
    expect(sentEvents.find((e) => e.payload.name === 'conversation.failed')).toBeDefined();
    expect(sentEvents.find((e) => e.payload.name === 'conversation.completed')).toBeUndefined();

    // The failed event reason contains cost_cap_exceeded.
    const failedEvent = sentEvents.find((e) => e.payload.name === 'conversation.failed');
    expect((failedEvent?.payload.data as { reason: string }).reason).toContain('cost_cap_exceeded');
  });

  it('adopts pre-allocated conversation_id when payload supplies it -> no allocate RPC call', async () => {
    const { assertBudgetAvailable } = await import('@/lib/llm/budget');
    (assertBudgetAvailable as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    const { streamChat } = await import('@/lib/llm/openrouter');
    (streamChat as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      streamingChatYielding('Hello pre-allocated.'),
    );

    const safety = await import('@/lib/llm/safety');
    (safety.detectRepeatLoop as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (safety.detectHostileTone as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      flagged: false,
      reason: 'clean',
    });
    (safety.detectNSFW as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      flagged: false,
      reason: 'clean',
    });

    const supa = makeSupabaseMock({
      agents: baseAgents,
      rpcAllocate: () => {
        throw new Error('allocate_conversation_attempt must NOT be called when id is pre-supplied');
      },
      rpcAppend: () => true,
      heartbeatStillLive: () => Array(10).fill(true),
      conversationLookup: {
        id: 'preallocated-id',
        surface: 'dating',
        agent_a_id: 'agent-a',
        agent_b_id: 'agent-b',
        status: 'live',
      },
    });

    const { result } = await runFn({
      supa,
      eventOverrides: {
        conversation_id: 'preallocated-id',
      } as typeof baseEvent.data & { conversation_id?: string },
    });

    // Adopted the pre-supplied id and completed successfully.
    expect((result as { status: string }).status).toBe('completed');
    expect((result as { conversation_id?: string }).conversation_id).toBe('preallocated-id');

    // allocate_conversation_attempt must NOT have been called.
    const allocateCalls = (
      supa.supabase.rpc as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.filter((c) => c[0] === 'allocate_conversation_attempt');
    expect(allocateCalls).toHaveLength(0);
  });
});
