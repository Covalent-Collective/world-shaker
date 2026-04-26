import type {
  Lang,
  PromptStage,
  TranscriptTurn,
  PersonaProfile,
  DialoguePromptResult,
} from './types';
import type { StreamChatMessage } from '@/lib/llm/openrouter';

export interface BuildDialoguePromptArgs {
  persona_a: PersonaProfile;
  persona_b: PersonaProfile;
  history: TranscriptTurn[];
  stage: PromptStage;
  language: Lang;
  whose_turn: 'a' | 'b';
}

function getStageSteering(stage: PromptStage, language: Lang): string {
  if (language === 'ko') {
    switch (stage) {
      case 'opening':
        return '지금은 대화의 시작 단계입니다 (1-4번째 대화). 따뜻하게 인사하고 상대방에게 편안한 분위기를 만들어 주세요. 가벼운 주제로 서로를 알아가세요. 깊은 질문은 아직 하지 마세요.';
      case 'probing':
        return '지금은 대화의 탐색 단계입니다 (5-15번째 대화). 상대방의 이전 답변을 바탕으로 더 깊이 있는 질문을 하세요. 상대방의 가치관, 관심사, 삶의 방식을 자연스럽게 탐색하세요. 구체적인 경험과 이유를 물어보세요.';
      case 'landing':
        return '지금은 대화의 마무리 단계입니다 (16-25번째 대화). 대화를 자연스럽고 따뜻하게 마무리하세요. 나눈 이야기를 간단히 돌아보고, 좋은 인상을 남기세요. 억지로 결론 짓지 말고 열린 끝맺음을 유지하세요.';
    }
  }
  switch (stage) {
    case 'opening':
      return 'This is the opening phase of the conversation (turns 1-4). Greet warmly and create a comfortable atmosphere. Start with lighter topics to get to know each other. Avoid deep or probing questions for now.';
    case 'probing':
      return "This is the probing phase of the conversation (turns 5-15). Build on the other person's previous answers with deeper, more curious follow-ups. Naturally explore their values, interests, and way of life. Ask about specific experiences and reasons behind their views.";
    case 'landing':
      return 'This is the landing phase of the conversation (turns 16-25). Wrap up gracefully and warmly. Briefly reflect on what was shared and leave a good impression. Avoid forcing conclusions — keep the ending open and inviting.';
  }
}

function getNextSpeakerInstruction(
  whose_turn: 'a' | 'b',
  persona_a: PersonaProfile,
  persona_b: PersonaProfile,
  language: Lang,
): string {
  const speakerName =
    whose_turn === 'a' ? (persona_a.name ?? 'Agent A') : (persona_b.name ?? 'Agent B');

  if (language === 'ko') {
    return `지금은 ${speakerName}의 차례입니다. ${speakerName}의 관점에서 응답하세요.`;
  }
  return `It is now ${speakerName}'s turn to speak. Respond from ${speakerName}'s perspective.`;
}

/**
 * Render an agent's interview answers as a labelled bullet list. Drops the
 * `interview_complete` sentinel and any non-string values; the result is
 * injected verbatim into the system prompt so the dialogue model can pull
 * specific phrasing, topics, and references from each agent's actual
 * interview rather than relying on the (often empty) extracted_features map.
 */
function formatInterviewAnswers(
  answers: Record<string, unknown> | undefined,
  language: Lang,
): string {
  const fallback = language === 'ko' ? '(인터뷰 답변 없음)' : '(no interview answers)';
  if (!answers || typeof answers !== 'object') return fallback;
  const entries = Object.entries(answers).filter(
    ([k, v]) => k !== 'interview_complete' && typeof v === 'string' && v.trim().length > 0,
  ) as [string, string][];
  if (entries.length === 0) return fallback;
  return entries.map(([k, v]) => `- [${k}] ${(v as string).trim()}`).join('\n');
}

/**
 * Builds an agent-to-agent dialogue prompt for streamChat.
 *
 * Stage determines system steering: opening (warm), probing (follow-ups),
 * landing (wrap up). `whose_turn` determines which persona is system-promoted
 * as the next speaker.
 *
 * Two important invariants the message array enforces:
 *
 * 1. The final message is ALWAYS a `user`-role message. Anthropic's API
 *    (and OpenRouter when routed via Azure) refuses to extend a conversation
 *    that ends on `assistant` with an empty prefill — it returns 400 with
 *    "must end with a user message". Mapping the role purely by speaker
 *    name (the previous behaviour) flipped this on every other turn and
 *    silently killed the conversation at turn 3.
 *
 *    Fix: role is assigned RELATIVE TO whose_turn. The agent we are about
 *    to generate is the "assistant"; the other agent is the "user".
 *
 * 2. Interview content is injected directly into the system prompt so the
 *    dialogue reflects each agent's real voice/topics rather than the
 *    (often empty) extracted_features map. The previous prompt JSON-
 *    stringified `extracted_features`, which is `{}` for newly-onboarded
 *    real users — producing generic small-talk.
 */
export function buildDialoguePrompt({
  persona_a,
  persona_b,
  history,
  stage,
  language,
  whose_turn,
}: BuildDialoguePromptArgs): DialoguePromptResult {
  const nameA = persona_a.name ?? 'Agent A';
  const nameB = persona_b.name ?? 'Agent B';

  const stageSteering = getStageSteering(stage, language);
  const nextSpeaker = getNextSpeakerInstruction(whose_turn, persona_a, persona_b, language);
  const aInterview = formatInterviewAnswers(persona_a.interview_answers, language);
  const bInterview = formatInterviewAnswers(persona_b.interview_answers, language);

  let system: string;
  if (language === 'ko') {
    system = `당신은 두 사람의 에이전트 간 대화를 진행하는 조율자입니다.

## 참가자

### ${nameA}의 인터뷰 답변
${aInterview}

### ${nameB}의 인터뷰 답변
${bInterview}

## 현재 단계
${stageSteering}

## 다음 발언자
${nextSpeaker}

## 지침
- 두 참가자는 각자의 인터뷰 답변에 드러난 진짜 목소리, 어휘, 관심사, 가치관, 구체적인 경험을 반영해야 합니다. 일반적인 인사말이나 날씨 잡담은 피하세요. 위 답변에서 보이는 구체적인 사람·장소·문장·표현을 자연스럽게 끌어쓰세요.
- 응답은 반드시 한 사람의 발언만 포함해야 합니다.
- 응답 형식: "${whose_turn === 'a' ? nameA : nameB}: [발언 내용]"
- 자연스럽고 진정성 있게 대화하세요. 각 발언은 2-4문장이 적당합니다.
- 조용한 보호자 톤을 유지하세요: 차분하고 진실되게.`;
  } else {
    system = `You are a coordinator facilitating a conversation between two agents representing real people.

## Participants

### ${nameA}'s interview answers
${aInterview}

### ${nameB}'s interview answers
${bInterview}

## Current Phase
${stageSteering}

## Next Speaker
${nextSpeaker}

## Guidelines
- Both participants must reflect the real voice, vocabulary, interests, values, and concrete experiences shown in their interview answers above. Avoid generic greetings or weather talk. Pull specific people, places, phrases, and references from the answers naturally.
- Your response must contain only one person's statement.
- Format: "${whose_turn === 'a' ? nameA : nameB}: [statement]"
- Speak naturally and authentically. Keep each turn to 2-4 sentences.
- Maintain a quiet protector tone: calm and genuine.`;
  }

  // Role mapping is RELATIVE to whose_turn — see the file-level comment for
  // why. The agent about to generate is mapped to `assistant`; the other
  // agent is mapped to `user`. With a strictly alternating history this
  // guarantees the array ends with a `user` message.
  const speakerName = whose_turn === 'a' ? nameA : nameB;
  const messages: StreamChatMessage[] = history.map((turn) => ({
    role: turn.speaker === speakerName ? ('assistant' as const) : ('user' as const),
    content: `${turn.speaker}: ${turn.text}`,
  }));

  return { system, messages };
}
