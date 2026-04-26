// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signWorldUserJwt, SESSION_COOKIE } from '@/lib/auth/jwt';

// ---------------------------------------------------------------------------
// Cookies mock
// ---------------------------------------------------------------------------

let cookieJar: Record<string, string> = {};
vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (cookieJar[name] ? { name, value: cookieJar[name] } : undefined),
    }),
}));

// ---------------------------------------------------------------------------
// Rate-limit mock — allow by default, override per test
// ---------------------------------------------------------------------------

const rateLimitState = { ok: true, retryAfterSeconds: 60 };
vi.mock('@/lib/auth/rate-limit', () => ({
  rateLimit: vi.fn().mockImplementation(() => Promise.resolve(rateLimitState)),
  agentAnswerRateLimit: { max: 30, windowSeconds: 60 },
}));

// ---------------------------------------------------------------------------
// Supabase service-client mock
// ---------------------------------------------------------------------------

const dbState = {
  existingAnswers: {} as Record<string, string>,
  readError: null as { message: string } | null,
  updateError: null as { message: string } | null,
  noAgentRow: false,
};

// Capture the last update call payload for assertion.
let lastUpdatePayload: Record<string, unknown> | null = null;

// Capture insert calls for the no-agent-row path.
let lastInsertPayload: Record<string, unknown> | null = null;

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: () => ({
    from(table: string) {
      if (table === 'agents') {
        const selectBuilder = {
          select() {
            return selectBuilder;
          },
          eq() {
            return selectBuilder;
          },
          // Legacy single() kept for safety; route now uses maybeSingle().
          single() {
            return Promise.resolve({
              data: dbState.readError
                ? null
                : { id: 'agent-1', interview_answers: dbState.existingAnswers },
              error: dbState.readError,
            });
          },
          maybeSingle() {
            if (dbState.readError) {
              return Promise.resolve({ data: null, error: dbState.readError });
            }
            return Promise.resolve({
              data: dbState.noAgentRow
                ? null
                : { id: 'agent-1', interview_answers: dbState.existingAnswers },
              error: null,
            });
          },
        };

        const updateBuilder = {
          update(payload: Record<string, unknown>) {
            lastUpdatePayload = payload;
            return updateBuilder;
          },
          eq() {
            return Promise.resolve({ error: dbState.updateError });
          },
        };

        return {
          select() {
            return selectBuilder;
          },
          update(payload: Record<string, unknown>) {
            lastUpdatePayload = payload;
            return updateBuilder;
          },
          insert(payload: Record<string, unknown>) {
            lastInsertPayload = payload;
            return Promise.resolve({ error: dbState.updateError });
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

// ---------------------------------------------------------------------------
// LLM probe mock — capture calls
// ---------------------------------------------------------------------------

const { buildInterviewProbePromptMock } = vi.hoisted(() => ({
  buildInterviewProbePromptMock: vi.fn().mockReturnValue({
    system: 'sys',
    messages: [{ role: 'user', content: 'q' }],
  }),
}));
vi.mock('@/lib/llm/prompts/interview-probe', () => ({
  buildInterviewProbePrompt: buildInterviewProbePromptMock,
  InterviewProbeSchema: {
    parse: (v: unknown) => v,
  },
}));

// OpenAI / OpenRouter mock — hoisted so the constructor is intercepted before
// the route module imports it. Must use `function` (not arrow) so vitest
// treats it as a constructable class mock.
const { openAICreateMock } = vi.hoisted(() => ({
  openAICreateMock: vi.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify(['probe question 1', 'probe question 2']) } }],
  }),
}));
vi.mock('openai', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function MockOpenAI(this: any) {
    this.chat = { completions: { create: openAICreateMock } };
  }
  return { default: MockOpenAI };
});

// Stub env vars required by getOpenRouterClient before the module is imported.
process.env.OPENROUTER_API_KEY = 'test-key';

// ---------------------------------------------------------------------------
// Module under test — import AFTER mocks
// ---------------------------------------------------------------------------

import { POST } from '../route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setSessionCookie(world_user_id: string) {
  const token = await signWorldUserJwt({
    world_user_id,
    nullifier: 'nullifier-test',
    language_pref: 'ko',
  });
  cookieJar[SESSION_COOKIE] = token;
}

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/agent/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/agent/answer', () => {
  beforeEach(() => {
    cookieJar = {};
    lastUpdatePayload = null;
    lastInsertPayload = null;
    dbState.existingAnswers = {};
    dbState.readError = null;
    dbState.updateError = null;
    dbState.noAgentRow = false;
    rateLimitState.ok = true;
    buildInterviewProbePromptMock.mockClear();
    openAICreateMock.mockClear();
  });

  it('returns 401 when ws_session cookie is missing', async () => {
    const req = makeRequest({ skeleton_question_id: 'q1', answer: 'hello' });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('unauthorized');
  });

  it('returns 401 when ws_session cookie is malformed', async () => {
    cookieJar[SESSION_COOKIE] = 'bad-token';
    const req = makeRequest({ skeleton_question_id: 'q1', answer: 'hello' });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 429 when rate limit is exceeded', async () => {
    await setSessionCookie('user-rl');
    rateLimitState.ok = false;
    rateLimitState.retryAfterSeconds = 30;

    const req = makeRequest({ skeleton_question_id: 'q1', answer: 'hello' });
    const res = await POST(req);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('30');
    const json = await res.json();
    expect(json.error).toBe('rate_limit_exceeded');
  });

  it('saves answer by merging with existing answers (no probe)', async () => {
    await setSessionCookie('user-save');
    dbState.existingAnswers = { q0: 'previous answer' };

    const req = makeRequest({
      skeleton_question_id: 'q1',
      answer: 'my answer',
      request_probe: false,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ saved: true });

    // Verify merged payload written to DB
    expect(lastUpdatePayload).toMatchObject({
      interview_answers: { q0: 'previous answer', q1: 'my answer' },
    });
    // No probe generation
    expect(buildInterviewProbePromptMock).not.toHaveBeenCalled();
    expect(openAICreateMock).not.toHaveBeenCalled();
  });

  it('INSERTs a new agent row when no agent row exists (no-agent-row path)', async () => {
    await setSessionCookie('user-new');
    dbState.noAgentRow = true; // maybeSingle() returns null

    const req = makeRequest({
      skeleton_question_id: 'q1',
      answer: 'first ever answer',
      request_probe: false,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ saved: true });

    // INSERT was called, not UPDATE
    expect(lastInsertPayload).toMatchObject({
      interview_answers: { q1: 'first ever answer' },
      status: 'active',
    });
    expect(lastUpdatePayload).toBeNull();
  });

  it('saves answer and returns probes when request_probe=true', async () => {
    await setSessionCookie('user-probe');
    dbState.existingAnswers = { q0: 'first answer' };

    const req = makeRequest({
      skeleton_question_id: 'q1',
      answer: 'probe answer',
      request_probe: true,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.saved).toBe(true);
    expect(Array.isArray(json.probes)).toBe(true);
    expect(json.probes).toHaveLength(2);

    // Probe generation was called with merged answers
    expect(buildInterviewProbePromptMock).toHaveBeenCalledTimes(1);
    expect(openAICreateMock).toHaveBeenCalledTimes(1);

    // Merged answers passed to probe builder include the just-saved answer
    const callArgs = buildInterviewProbePromptMock.mock.calls[0][0] as {
      prior_answers: string[];
    };
    expect(callArgs.prior_answers).toContain('probe answer');
  });
});
