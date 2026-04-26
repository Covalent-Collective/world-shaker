'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import QuestionCard from '@/components/interview/QuestionCard';
import ProbeBubble from '@/components/interview/ProbeBubble';
import { useT } from '@/lib/i18n/useT';
import {
  INTERVIEW_COMPLETE_ID,
  SKELETON_QUESTIONS,
  type SkeletonQuestion,
} from '@/lib/interview/skeleton';

interface ProbeState {
  /** Probe prompts returned by the API (in order). */
  questions: string[];
  /** Index of the probe currently being answered. */
  currentIndex: number;
  /** Active draft for the current probe. */
  draft: string;
}

interface InterviewClientProps {
  /** Server-fetched agents.interview_answers (RLS-scoped to this user). */
  initialAnswers: Record<string, unknown>;
}

interface AnswerApiResponse {
  saved: boolean;
  probes?: string[];
}

/**
 * Decide which question index to start on by walking SKELETON_QUESTIONS and
 * returning the first one whose id is not present in initialAnswers.
 *
 * If every skeleton question is already answered we still resume on the last
 * one — the activation event will be re-fired on completion (idempotent in
 * the Inngest function via event key).
 */
function resolveResumeIndex(
  initialAnswers: Record<string, unknown>,
  questions: readonly SkeletonQuestion[],
): number {
  for (let i = 0; i < questions.length; i++) {
    const value = initialAnswers[questions[i]!.id];
    if (typeof value !== 'string' || value.trim().length === 0) return i;
  }
  // All answered — resume on the final question for a final-step UX.
  return questions.length - 1;
}

/**
 * Interview state machine.
 *
 * Flow:
 *   1. Render the current SKELETON question.
 *   2. On submit: POST { skeleton_question_id, answer, request_probe: true }.
 *   3. If the API returns probes, render them inline via ProbeBubble — one at
 *      a time. Each probe answer is POSTed with request_probe=false (probes
 *      do not chain in v1).
 *   4. After all probes answered (or when none returned) advance to the next
 *      skeleton question.
 *   5. After the final probe of the final question is answered, POST the
 *      `interview_complete` sentinel and trigger the agent.activated Inngest
 *      event via /api/agent/activate (kept as a thin server route so the
 *      browser never holds an Inngest client / signing key — see comment).
 */
export default function InterviewClient({
  initialAnswers,
}: InterviewClientProps): React.ReactElement {
  const router = useRouter();
  const t = useT();

  const [questionIndex, setQuestionIndex] = React.useState<number>(() =>
    resolveResumeIndex(initialAnswers, SKELETON_QUESTIONS),
  );
  const [answerDraft, setAnswerDraft] = React.useState<string>('');
  const [probe, setProbe] = React.useState<ProbeState | null>(null);
  const [submitting, setSubmitting] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);

  const totalQuestions = SKELETON_QUESTIONS.length;
  const currentQuestion = SKELETON_QUESTIONS[questionIndex]!;
  const isLastQuestion = questionIndex === totalQuestions - 1;
  const submitLabel = isLastQuestion && !probe ? t('interview.complete') : t('interview.next');

  async function postAnswer(
    skeletonQuestionId: string,
    answer: string,
    requestProbe: boolean,
  ): Promise<AnswerApiResponse> {
    const res = await fetch('/api/agent/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skeleton_question_id: skeletonQuestionId,
        answer,
        request_probe: requestProbe,
      }),
    });
    if (!res.ok) throw new Error(`answer_failed_${res.status}`);
    return (await res.json()) as AnswerApiResponse;
  }

  async function triggerAgentActivated(): Promise<void> {
    // We hit a thin server route (`/api/agent/activate`) instead of importing
    // the Inngest client client-side — the Inngest signing key must never
    // touch the browser. The route just does `inngest.send({ name:
    // 'agent.activated', data: { user_id, agent_id } })` from server context.
    await fetch('/api/agent/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  }

  function advanceAfterProbe(): void {
    if (isLastQuestion) {
      void completeInterview();
      return;
    }
    setProbe(null);
    setQuestionIndex((i) => i + 1);
    setAnswerDraft('');
  }

  async function completeInterview(): Promise<void> {
    setSubmitting(true);
    try {
      await postAnswer(INTERVIEW_COMPLETE_ID, '__done__', false);
      await triggerAgentActivated();
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown_error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSkeletonSubmit(): Promise<void> {
    if (!answerDraft.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await postAnswer(currentQuestion.id, answerDraft.trim(), true);
      if (res.probes && res.probes.length > 0) {
        setProbe({ questions: res.probes, currentIndex: 0, draft: '' });
      } else {
        advanceAfterProbe();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown_error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleProbeSubmit(): Promise<void> {
    if (!probe || !probe.draft.trim() || submitting) return;
    const probeId = `${currentQuestion.id}_probe_${probe.currentIndex}`;
    setSubmitting(true);
    setError(null);
    try {
      await postAnswer(probeId, probe.draft.trim(), false);
      const nextIndex = probe.currentIndex + 1;
      if (nextIndex < probe.questions.length) {
        setProbe({ ...probe, currentIndex: nextIndex, draft: '' });
      } else {
        advanceAfterProbe();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown_error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-6 p-6">
      <header className="flex items-baseline justify-between">
        <p className="text-text-3 text-xs font-semibold uppercase tracking-widest">
          {questionIndex + 1} / {totalQuestions}
        </p>
      </header>

      <QuestionCard
        questionId={currentQuestion.id}
        prompt={t(currentQuestion.i18nKey)}
        value={answerDraft}
        disabled={submitting || probe !== null}
        submitDisabled={!answerDraft.trim()}
        submitLabel={submitLabel}
        onChange={setAnswerDraft}
        onSubmit={handleSkeletonSubmit}
      />

      {probe && (
        <ProbeBubble
          probeId={`${currentQuestion.id}_${probe.currentIndex}`}
          question={probe.questions[probe.currentIndex]!}
          value={probe.draft}
          disabled={submitting}
          submitDisabled={!probe.draft.trim()}
          submitLabel={
            isLastQuestion && probe.currentIndex === probe.questions.length - 1
              ? t('interview.complete')
              : t('interview.next')
          }
          onChange={(v) => setProbe((p) => (p ? { ...p, draft: v } : p))}
          onSubmit={handleProbeSubmit}
        />
      )}

      {error && (
        <p role="alert" data-testid="interview-error" className="text-sm text-warn">
          {error}
        </p>
      )}
    </main>
  );
}
