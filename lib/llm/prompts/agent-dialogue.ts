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
 * Builds an agent-to-agent dialogue prompt for streamChat.
 * Stage determines system steering: opening (warm), probing (follow-ups), landing (wrap up).
 * whose_turn determines which persona is system-promoted as the next speaker.
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

  let system: string;
  if (language === 'ko') {
    system = `당신은 두 사람의 에이전트 간 대화를 진행하는 조율자입니다.

## 참가자
- ${nameA}: ${JSON.stringify(persona_a.extracted_features)}
- ${nameB}: ${JSON.stringify(persona_b.extracted_features)}

## 현재 단계
${stageSteering}

## 다음 발언자
${nextSpeaker}

## 지침
- 응답은 반드시 한 사람의 발언만 포함해야 합니다.
- 응답 형식: "${whose_turn === 'a' ? nameA : nameB}: [발언 내용]"
- 자연스럽고 진정성 있게 대화하세요. 각 발언은 2-4문장이 적당합니다.
- 조용한 보호자 톤을 유지하세요: 차분하고 진실되게.`;
  } else {
    system = `You are a coordinator facilitating a conversation between two agents representing real people.

## Participants
- ${nameA}: ${JSON.stringify(persona_a.extracted_features)}
- ${nameB}: ${JSON.stringify(persona_b.extracted_features)}

## Current Phase
${stageSteering}

## Next Speaker
${nextSpeaker}

## Guidelines
- Your response must contain only one person's statement.
- Format: "${whose_turn === 'a' ? nameA : nameB}: [statement]"
- Speak naturally and authentically. Keep each turn to 2-4 sentences.
- Maintain a quiet protector tone: calm and genuine.`;
  }

  const messages: StreamChatMessage[] = history.map((turn) => ({
    role: turn.speaker === nameA ? ('assistant' as const) : ('user' as const),
    content: `${turn.speaker}: ${turn.text}`,
  }));

  return { system, messages };
}
