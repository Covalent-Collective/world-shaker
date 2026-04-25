import { z } from 'zod';
import type { Lang, InterviewProbePromptResult } from './types';
import type { StreamChatMessage } from '@/lib/llm/openrouter';

export interface BuildInterviewProbePromptArgs {
  skeleton_question: string;
  user_answer: string;
  prior_answers: string[];
  language: Lang;
}

export const InterviewProbeSchema = z
  .array(z.string().min(10))
  .min(1)
  .max(2)
  .describe('1-2 conversational follow-up probe questions');

export type InterviewProbeOutput = z.infer<typeof InterviewProbeSchema>;

/**
 * Builds a prompt to generate 1-2 follow-up interview probe questions.
 * Probes are conversational, not survey-style, and build on the user's specific answer.
 */
export function buildInterviewProbePrompt({
  skeleton_question,
  user_answer,
  prior_answers,
  language,
}: BuildInterviewProbePromptArgs): InterviewProbePromptResult {
  let system: string;
  if (language === 'ko') {
    system = `당신은 사람들이 자신을 더 잘 표현할 수 있도록 돕는 인터뷰 진행자입니다.
자연스럽고 대화적인 방식으로 1-2개의 후속 질문을 작성하세요.

## 지침
- 사용자의 구체적인 답변을 바탕으로 더 깊이 있는 질문을 하세요.
- 설문조사처럼 느껴지는 형식적인 질문은 피하세요.
- 대화처럼 자연스럽게 이어지는 질문이어야 합니다.
- 사용자가 이미 언급한 내용을 다시 물어보지 마세요.
- 한 번에 여러 가지를 묻지 마세요.
- 조용하고 차분한 톤을 유지하세요.

## 출력 형식
JSON 배열 형식으로만 응답하세요: ["질문1"] 또는 ["질문1", "질문2"]`;
  } else {
    system = `You are an interviewer who helps people express themselves more fully.
Generate 1-2 follow-up probe questions in a natural, conversational way.

## Guidelines
- Build directly on what the user specifically said in their answer.
- Avoid survey-style or formal question formats.
- Questions should feel like natural conversation, not an interrogation.
- Do not ask about things the user already mentioned.
- Do not bundle multiple questions into one.
- Keep a calm, quiet tone.

## Output Format
Respond only with a JSON array: ["question 1"] or ["question 1", "question 2"]`;
  }

  const priorContext =
    prior_answers.length > 0
      ? prior_answers.map((a, i) => `Prior answer ${i + 1}: ${a}`).join('\n')
      : '';

  const userContent = [
    `Original question: ${skeleton_question}`,
    priorContext,
    `User's answer: ${user_answer}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const messages: StreamChatMessage[] = [
    {
      role: 'user',
      content: userContent,
    },
  ];

  return { system, messages, schema: InterviewProbeSchema };
}
