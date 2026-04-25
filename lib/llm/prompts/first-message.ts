import { z } from 'zod';
import type { TranscriptTurn, PersonaProfile, Lang, FirstMessagePromptResult } from './types';
import type { StreamChatMessage } from '@/lib/llm/openrouter';

export interface BuildFirstMessagePromptArgs {
  transcript: TranscriptTurn[];
  persona_a: PersonaProfile;
  persona_b: PersonaProfile;
  language: Lang;
}

export const FirstMessageSchema = z
  .array(z.string().min(30).max(150))
  .length(2)
  .describe('Exactly 2 conversation starters, each 30-150 characters');

export type FirstMessageOutput = z.infer<typeof FirstMessageSchema>;

function formatTranscript(transcript: TranscriptTurn[]): string {
  return transcript.map((t) => `${t.speaker}: ${t.text}`).join('\n');
}

/**
 * Builds a prompt to generate exactly 2 first-message conversation starters.
 * Tone: warm but specific; calm protector; no recap-required questions.
 * Both starters must reference specific moments from the transcript.
 */
export function buildFirstMessagePrompt({
  transcript,
  persona_a,
  persona_b,
  language,
}: BuildFirstMessagePromptArgs): FirstMessagePromptResult {
  const nameA = persona_a.name ?? 'Agent A';
  const nameB = persona_b.name ?? 'Agent B';
  const formattedTranscript = formatTranscript(transcript);

  let system: string;
  if (language === 'ko') {
    system = `당신은 두 사람이 처음 만났을 때 나눌 수 있는 대화 시작 문장을 작성하는 전문가입니다.

## 참가자
- ${nameA}: ${JSON.stringify(persona_a.extracted_features)}
- ${nameB}: ${JSON.stringify(persona_b.extracted_features)}

## 지침
- 정확히 2개의 대화 시작 문장을 작성하세요.
- 각 문장은 30-150자 사이여야 합니다.
- 두 문장 모두 위의 대화에서 나온 구체적인 순간을 언급해야 합니다.
- 따뜻하지만 구체적으로: 막연한 칭찬이나 일반적인 인사말은 피하세요.
- 조용한 보호자 톤: 차분하고, 진실되며, 자연스럽게.
- 상대방이 대화 내용을 다시 설명해야 하는 질문은 하지 마세요.
- 상대방이 "네" 또는 "아니오"로만 답할 수 있는 질문은 피하세요.

## 출력 형식
JSON 배열 형식으로만 응답하세요: ["문장1", "문장2"]`;
  } else {
    system = `You are an expert at crafting conversation openers for two people who have just been matched.

## Participants
- ${nameA}: ${JSON.stringify(persona_a.extracted_features)}
- ${nameB}: ${JSON.stringify(persona_b.extracted_features)}

## Guidelines
- Write exactly 2 conversation starters.
- Each must be between 30 and 150 characters.
- Both must reference specific moments from the conversation above.
- Warm but specific: avoid vague compliments or generic greetings.
- Calm protector tone: composed, genuine, natural.
- Do not write questions that require the other person to recap the conversation.
- Avoid yes/no questions.

## Output Format
Respond only with a JSON array: ["starter 1", "starter 2"]`;
  }

  const messages: StreamChatMessage[] = [
    {
      role: 'user',
      content: formattedTranscript,
    },
  ];

  return { system, messages, schema: FirstMessageSchema };
}
