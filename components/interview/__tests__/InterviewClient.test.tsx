// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InterviewClient from '@/app/(onboarding)/interview/InterviewClient';
import { SKELETON_QUESTIONS, INTERVIEW_COMPLETE_ID } from '@/lib/interview/skeleton';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@/lib/i18n/useT', () => ({
  useT: () => (key: string) => key,
}));

interface FetchCall {
  url: string;
  body: Record<string, unknown> | null;
}

function recordFetch(): {
  calls: FetchCall[];
  setHandler: (handler: (call: FetchCall) => Response | Promise<Response>) => void;
} {
  const calls: FetchCall[] = [];
  let handler: (call: FetchCall) => Response | Promise<Response> = () =>
    new Response(JSON.stringify({ saved: true }), { status: 200 });

  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    const call: FetchCall = { url, body };
    calls.push(call);
    return handler(call);
  }) as unknown as typeof fetch;

  return {
    calls,
    setHandler(h) {
      handler = h;
    },
  };
}

describe('InterviewClient', () => {
  let fetchSpy: ReturnType<typeof recordFetch>;

  beforeEach(() => {
    pushMock.mockClear();
    fetchSpy = recordFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the first skeleton question when initialAnswers is empty', () => {
    render(<InterviewClient initialAnswers={{}} />);
    const first = SKELETON_QUESTIONS[0]!;
    expect(screen.getByTestId(`question-card-${first.id}`)).toBeInTheDocument();
    // Counter shows 1 / 6
    expect(screen.getByText(`1 / ${SKELETON_QUESTIONS.length}`)).toBeInTheDocument();
  });

  it('resumes on the first unanswered question when 3 answers exist', () => {
    const initialAnswers = {
      [SKELETON_QUESTIONS[0]!.id]: 'a1',
      [SKELETON_QUESTIONS[1]!.id]: 'a2',
      [SKELETON_QUESTIONS[2]!.id]: 'a3',
    };
    render(<InterviewClient initialAnswers={initialAnswers} />);
    const fourth = SKELETON_QUESTIONS[3]!;
    expect(screen.getByTestId(`question-card-${fourth.id}`)).toBeInTheDocument();
    expect(screen.getByText(`4 / ${SKELETON_QUESTIONS.length}`)).toBeInTheDocument();
  });

  it('submits an answer to /api/agent/answer and renders returned probes', async () => {
    fetchSpy.setHandler(({ body }) => {
      if (body?.skeleton_question_id === SKELETON_QUESTIONS[0]!.id) {
        return new Response(JSON.stringify({ saved: true, probes: ['Tell me more?'] }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ saved: true }), { status: 200 });
    });

    const user = userEvent.setup();
    render(<InterviewClient initialAnswers={{}} />);

    const first = SKELETON_QUESTIONS[0]!;
    const textarea = screen.getByTestId(`answer-input-${first.id}`);
    await user.type(textarea, 'Spending time with friends');

    const submit = screen.getByTestId(`answer-submit-${first.id}`);
    await user.click(submit);

    await waitFor(() => {
      expect(fetchSpy.calls[0]?.url).toBe('/api/agent/answer');
    });
    expect(fetchSpy.calls[0]?.body).toEqual({
      skeleton_question_id: first.id,
      answer: 'Spending time with friends',
      request_probe: true,
    });

    // Probe bubble appears (the bubble container should mount).
    await waitFor(() => {
      expect(screen.getByTestId(`probe-bubble-${first.id}_0`)).toBeInTheDocument();
    });
    expect(screen.getAllByText('Tell me more?').length).toBeGreaterThan(0);
  });

  it('completes the interview after the last answer and triggers agent.activated', async () => {
    // Pre-fill all but the last skeleton question so we land on the final card.
    const initialAnswers: Record<string, string> = {};
    for (let i = 0; i < SKELETON_QUESTIONS.length - 1; i++) {
      initialAnswers[SKELETON_QUESTIONS[i]!.id] = `answer-${i}`;
    }

    // No probes returned => instant completion path
    fetchSpy.setHandler(() => new Response(JSON.stringify({ saved: true }), { status: 200 }));

    const user = userEvent.setup();
    render(<InterviewClient initialAnswers={initialAnswers} />);

    const last = SKELETON_QUESTIONS[SKELETON_QUESTIONS.length - 1]!;
    expect(screen.getByTestId(`question-card-${last.id}`)).toBeInTheDocument();

    await user.type(screen.getByTestId(`answer-input-${last.id}`), 'Final answer');
    await user.click(screen.getByTestId(`answer-submit-${last.id}`));

    // Expect: 1) skeleton submit, 2) interview_complete sentinel, 3) /api/agent/activate
    await waitFor(() => {
      expect(fetchSpy.calls.length).toBeGreaterThanOrEqual(3);
    });

    const completeCall = fetchSpy.calls.find(
      (c) => c.body?.skeleton_question_id === INTERVIEW_COMPLETE_ID,
    );
    expect(completeCall).toBeDefined();
    expect(completeCall?.body).toEqual({
      skeleton_question_id: INTERVIEW_COMPLETE_ID,
      answer: '__done__',
      request_probe: false,
    });

    const activateCall = fetchSpy.calls.find((c) => c.url === '/api/agent/activate');
    expect(activateCall).toBeDefined();

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/');
    });
  });
});
