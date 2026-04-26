import type { MessageKey } from '@/lib/i18n/types';

/**
 * Fixed skeleton interview questions (US-303).
 *
 * Six warm, open-ended prompts. Each entry pairs a stable `id` (used as the
 * key on `agents.interview_answers` and the request body for /api/agent/answer)
 * with the i18n message key that renders the prompt in the user's locale.
 *
 * The order here defines the canonical onboarding flow. Resumability checks
 * `initialAnswers[id]` per entry to find the first unanswered question.
 */
export interface SkeletonQuestion {
  id: string;
  i18nKey: MessageKey;
}

export const SKELETON_QUESTIONS: readonly SkeletonQuestion[] = [
  { id: 'q1_laugh', i18nKey: 'interview.skeleton.q1' },
  { id: 'q2_surprised', i18nKey: 'interview.skeleton.q2' },
  { id: 'q3_working_through', i18nKey: 'interview.skeleton.q3' },
  { id: 'q4_alone_time', i18nKey: 'interview.skeleton.q4' },
  { id: 'q5_grateful', i18nKey: 'interview.skeleton.q5' },
  { id: 'q6_small_try', i18nKey: 'interview.skeleton.q6' },
] as const;

/** Sentinel id used by InterviewClient to mark interview completion. */
export const INTERVIEW_COMPLETE_ID = 'interview_complete';

/**
 * Lookup helper for /api/agent/answer (US-304). Returns the SkeletonQuestion
 * matching `id`, or `undefined` for unknown ids (probes use synthesised ids
 * like `q1_laugh_probe_0` and the completion sentinel uses `interview_complete`).
 */
export function getSkeletonQuestion(id: string): SkeletonQuestion | undefined {
  return SKELETON_QUESTIONS.find((q) => q.id === id);
}
