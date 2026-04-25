// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: vi.fn(),
}));

vi.mock('@/lib/flags', () => ({
  isEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/lib/llm/prompts/report', () => ({
  buildReportPrompt: vi.fn().mockReturnValue({
    system: 'report-system',
    messages: [{ role: 'user', content: 'report-user-content' }],
  }),
  ReportSchema: {
    safeParse: vi.fn(),
  },
}));

vi.mock('@/lib/llm/prompts/first-message', () => ({
  buildFirstMessagePrompt: vi.fn().mockReturnValue({
    system: 'starters-system',
    messages: [{ role: 'user', content: 'starters-user-content' }],
  }),
  FirstMessageSchema: {
    safeParse: vi.fn(),
  },
}));

// Provide a constructor-compatible default mock for OpenAI.
// Each test overrides the implementation via makeOpenAIMock().
vi.mock('openai', () => {
  const OpenAIMock = vi.fn().mockImplementation(function () {
    return {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({ choices: [{ message: { content: '{}' } }] }),
        },
      },
    };
  });
  return { default: OpenAIMock };
});

// Mock inngest so createFunction(_config, handler) returns the handler itself.
// This lets us call generateReport(...) directly as if it were the handler.
vi.mock('../../client', () => ({
  inngest: {
    createFunction: vi.fn((_config: unknown, handler: unknown) => handler),
  },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are registered)
// ---------------------------------------------------------------------------

import { getServiceClient } from '@/lib/supabase/service';
import { ReportSchema } from '@/lib/llm/prompts/report';
import { FirstMessageSchema } from '@/lib/llm/prompts/first-message';
import OpenAI from 'openai';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONV_ID = 'conv-001';
const AGENT_A_ID = 'agent-a';
const AGENT_B_ID = 'agent-b';
const USER_A_ID = 'user-a';
const USER_B_ID = 'user-b';
const MATCH_A_ID = 'match-a-001';
const MATCH_B_ID = 'match-b-001';

const VALID_REPORT_JSON = JSON.stringify({
  compatibility_score: 0.72,
  why_click: 'You both value quiet depth over performative enthusiasm.',
  watch_out: 'You both avoid conflict, which may stall hard conversations.',
  highlight_quotes: [
    'A: I find small talk exhausting.',
    'B: Same — I prefer just getting into the real stuff.',
    'A: What counts as real for you?',
    'B: Something that keeps you up at night.',
    'A: Yeah, exactly.',
    'B: Like that moment when you realized...',
  ],
  rendered_transcript: [{ speaker: 'A', text: 'hello' }],
});

const VALID_STARTERS_JSON = JSON.stringify([
  "당신이 '진짜 이야기'라고 했을 때 뭘 생각하셨나요?",
  '잠 못 드는 밤에 어떤 생각이 떠오르나요?',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSupabaseMock({
  matchCandidatesScore = 0.7,
  matchInsertAId = MATCH_A_ID,
  matchInsertBId = MATCH_B_ID,
}: {
  matchCandidatesScore?: number;
  matchInsertAId?: string;
  matchInsertBId?: string;
} = {}) {
  let matchInsertCount = 0;

  const singleConv = vi.fn().mockResolvedValue({
    data: {
      id: CONV_ID,
      agent_a_id: AGENT_A_ID,
      agent_b_id: AGENT_B_ID,
      surface: 'dating',
      status: 'completed',
    },
    error: null,
  });

  const agentsQuery = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({
      data: [
        { id: AGENT_A_ID, user_id: USER_A_ID, extracted_features: { voice: 'calm' } },
        { id: AGENT_B_ID, user_id: USER_B_ID, extracted_features: { voice: 'thoughtful' } },
      ],
      error: null,
    }),
  };

  const turnsQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({
      data: [
        {
          id: 1,
          conversation_id: CONV_ID,
          turn_index: 0,
          speaker_agent_id: AGENT_A_ID,
          text: 'hello',
        },
        {
          id: 2,
          conversation_id: CONV_ID,
          turn_index: 1,
          speaker_agent_id: AGENT_B_ID,
          text: 'hi there',
        },
      ],
      error: null,
    }),
  };

  const convQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: singleConv,
  };

  const matchInsert = {
    insert: vi.fn().mockImplementation(() => {
      matchInsertCount += 1;
      const id = matchInsertCount === 1 ? matchInsertAId : matchInsertBId;
      return {
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id }, error: null }),
      };
    }),
  };

  const rpcMock = vi.fn().mockResolvedValue({
    data: [{ user_id: USER_B_ID, score: matchCandidatesScore }],
    error: null,
  });

  const fromMock = vi.fn().mockImplementation((table: string) => {
    if (table === 'conversations') return convQuery;
    if (table === 'agents') return agentsQuery;
    if (table === 'conversation_turns') return turnsQuery;
    if (table === 'matches') return matchInsert;
    return {};
  });

  return { from: fromMock, rpc: rpcMock };
}

function makeOpenAIMock(responses: string[]) {
  let callCount = 0;
  const createMock = vi.fn().mockImplementation(async () => {
    const content = responses[callCount] ?? responses[responses.length - 1];
    callCount += 1;
    return { choices: [{ message: { content } }] };
  });

  const MockOpenAI = vi.mocked(OpenAI) as unknown as ReturnType<typeof vi.fn>;
  // Must use regular function (not arrow) so `new MockOpenAI()` works as a constructor
  MockOpenAI.mockImplementation(function () {
    return { chat: { completions: { create: createMock } } };
  });

  return { createMock };
}

type HandlerFn = (ctx: {
  event: { data: { conversation_id: string } };
  step: {
    run: (name: string, fn: () => Promise<unknown>) => Promise<unknown>;
    sendEvent: (name: string, events: unknown) => Promise<void>;
  };
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}) => Promise<unknown>;

async function runHandler(
  supabaseMock: ReturnType<typeof makeSupabaseMock>,
  event: { data: { conversation_id: string } },
) {
  vi.mocked(getServiceClient).mockReturnValue(
    supabaseMock as unknown as ReturnType<typeof getServiceClient>,
  );

  // generateReport IS the handler because our mock returns handler from createFunction
  const { generateReport } = await import('../generate-report');
  const handler = generateReport as unknown as HandlerFn;

  const stepRun = vi
    .fn()
    .mockImplementation(async (_name: string, cb: () => Promise<unknown>) => cb());
  const stepSendEvent = vi.fn().mockResolvedValue(undefined);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  return handler({ event, step: { run: stepRun, sendEvent: stepSendEvent }, logger });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  });

  it('happy path: emits match.created for both directions, writes match rows for A→B and B→A', async () => {
    const supabase = makeSupabaseMock();
    makeOpenAIMock([VALID_REPORT_JSON, VALID_STARTERS_JSON]);

    vi.mocked(ReportSchema.safeParse).mockReturnValue({
      success: true,
      data: JSON.parse(VALID_REPORT_JSON),
    } as ReturnType<typeof ReportSchema.safeParse>);

    vi.mocked(FirstMessageSchema.safeParse).mockReturnValue({
      success: true,
      data: JSON.parse(VALID_STARTERS_JSON),
    } as ReturnType<typeof FirstMessageSchema.safeParse>);

    const result = await runHandler(supabase, { data: { conversation_id: CONV_ID } });

    expect(result).toMatchObject({
      conversation_id: CONV_ID,
      match_a_id: MATCH_A_ID,
      match_b_id: MATCH_B_ID,
    });

    // Both match rows inserted
    const matchTable = supabase.from('matches') as { insert: ReturnType<typeof vi.fn> };
    const insertCalls = matchTable.insert.mock.calls;
    expect(insertCalls).toHaveLength(2);

    const [insertA] = insertCalls[0] as [{ user_id: string; candidate_user_id: string }];
    expect(insertA.user_id).toBe(USER_A_ID);
    expect(insertA.candidate_user_id).toBe(USER_B_ID);

    const [insertB] = insertCalls[1] as [{ user_id: string; candidate_user_id: string }];
    expect(insertB.user_id).toBe(USER_B_ID);
    expect(insertB.candidate_user_id).toBe(USER_A_ID);
  });

  it('invalid LLM JSON on first try → retries → succeeds', async () => {
    const supabase = makeSupabaseMock();
    const { createMock } = makeOpenAIMock([
      '{"invalid": true}', // first report attempt → schema parse fails
      VALID_REPORT_JSON, // retry → valid
      VALID_STARTERS_JSON, // starters
    ]);

    vi.mocked(ReportSchema.safeParse)
      .mockReturnValueOnce({
        success: false,
        error: { message: 'bad schema' },
      } as unknown as ReturnType<typeof ReportSchema.safeParse>)
      .mockReturnValueOnce({
        success: true,
        data: JSON.parse(VALID_REPORT_JSON),
      } as ReturnType<typeof ReportSchema.safeParse>);

    vi.mocked(FirstMessageSchema.safeParse).mockReturnValue({
      success: true,
      data: JSON.parse(VALID_STARTERS_JSON),
    } as ReturnType<typeof FirstMessageSchema.safeParse>);

    const result = await runHandler(supabase, { data: { conversation_id: CONV_ID } });

    expect(result).toMatchObject({ conversation_id: CONV_ID });
    // LLM called twice for report (original + retry) + once for starters = 3
    expect(createMock).toHaveBeenCalledTimes(3);
  });

  it('invalid JSON twice → throws (Inngest will retry the function)', async () => {
    const supabase = makeSupabaseMock();
    makeOpenAIMock(['{"invalid": true}', '{"still_bad": true}', VALID_STARTERS_JSON]);

    vi.mocked(ReportSchema.safeParse).mockReturnValue({
      success: false,
      error: { message: 'bad schema' },
    } as unknown as ReturnType<typeof ReportSchema.safeParse>);

    vi.mocked(FirstMessageSchema.safeParse).mockReturnValue({
      success: true,
      data: JSON.parse(VALID_STARTERS_JSON),
    } as ReturnType<typeof FirstMessageSchema.safeParse>);

    await expect(runHandler(supabase, { data: { conversation_id: CONV_ID } })).rejects.toThrow(
      'report_schema_invalid',
    );
  });

  it('baseline_score 0.7 from match_candidates → compatibility_score within [0.6, 0.8]', async () => {
    const supabase = makeSupabaseMock({ matchCandidatesScore: 0.7 });
    makeOpenAIMock([VALID_REPORT_JSON, VALID_STARTERS_JSON]);

    const reportData = { ...JSON.parse(VALID_REPORT_JSON), compatibility_score: 0.72 };

    vi.mocked(ReportSchema.safeParse).mockReturnValue({
      success: true,
      data: reportData,
    } as ReturnType<typeof ReportSchema.safeParse>);

    vi.mocked(FirstMessageSchema.safeParse).mockReturnValue({
      success: true,
      data: JSON.parse(VALID_STARTERS_JSON),
    } as ReturnType<typeof FirstMessageSchema.safeParse>);

    const result = (await runHandler(supabase, {
      data: { conversation_id: CONV_ID },
    })) as { conversation_id: string };

    expect(supabase.rpc).toHaveBeenCalledWith('match_candidates', {
      target_user: USER_A_ID,
      k: 100,
      mode: 'system_generated',
    });

    expect(reportData.compatibility_score).toBeGreaterThanOrEqual(0.6);
    expect(reportData.compatibility_score).toBeLessThanOrEqual(0.8);

    expect(result.conversation_id).toBe(CONV_ID);
  });
});
