import { z } from 'zod';
import type { TranscriptTurn, PersonaProfile, Lang, ReportPromptResult } from './types';
import type { StreamChatMessage } from '@/lib/llm/openrouter';

export interface BuildReportPromptArgs {
  transcript: TranscriptTurn[];
  persona_a: PersonaProfile;
  persona_b: PersonaProfile;
  baseline_score: number;
  language: Lang;
}

/**
 * Builds a Zod schema for report output that enforces the baseline ±0.1 score invariant.
 * The compatibility_score must fall within [baseline_score - 0.1, baseline_score + 0.1],
 * clamped to [0, 1].
 */
export function buildReportSchema(baseline_score: number): ReturnType<typeof _buildReportSchema> {
  const lo = Math.max(0, Math.round((baseline_score - 0.1) * 100) / 100);
  const hi = Math.min(1, Math.round((baseline_score + 0.1) * 100) / 100);
  return _buildReportSchema(lo, hi);
}

function _buildReportSchema(lo: number, hi: number) {
  return z.object({
    compatibility_score: z
      .number()
      .min(lo)
      .max(hi)
      .describe(`Compatibility score between ${lo.toFixed(2)} and ${hi.toFixed(2)}`),
    why_click: z
      .string()
      .min(50)
      .max(200)
      .describe('Why these two would click — 50-200 characters'),
    watch_out: z
      .string()
      .min(50)
      .max(200)
      .describe('Friction point to watch out for — 50-200 characters'),
    highlight_quotes: z
      .array(z.string())
      .min(6)
      .max(10)
      .describe('6-10 verbatim quotes from the transcript'),
    rendered_transcript: z
      .array(
        z.object({
          speaker: z.string(),
          text: z.string(),
        }),
      )
      .describe('The conversation transcript as speaker/text pairs'),
  });
}

/** Static schema covering the full [0,1] range — used in tests and legacy callers. */
export const ReportSchema = _buildReportSchema(0, 1);

export type ReportOutput = z.infer<ReturnType<typeof buildReportSchema>>;

function formatTranscript(transcript: TranscriptTurn[]): string {
  return transcript.map((t) => `${t.speaker}: ${t.text}`).join('\n');
}

/**
 * Validates that every highlight_quote is a verbatim substring of the formatted transcript
 * (i.e. the same "Speaker: text" representation shown to the LLM).
 */
export function validateReportQuotes(
  report: { highlight_quotes: string[] },
  transcript: TranscriptTurn[],
): { ok: boolean; errors: string[] } {
  const formattedTranscript = formatTranscript(transcript);
  const errors: string[] = [];
  for (const quote of report.highlight_quotes) {
    if (!formattedTranscript.includes(quote)) {
      errors.push(`Quote not verbatim: "${quote.slice(0, 60)}..."`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Builds a report extraction prompt for streamChat.
 * The LLM is instructed to keep score within +/- 0.1 of baseline_score
 * and to quote verbatim from the transcript.
 */
export function buildReportPrompt({
  transcript,
  persona_a,
  persona_b,
  baseline_score,
  language,
}: BuildReportPromptArgs): ReportPromptResult {
  const nameA = persona_a.name ?? 'Agent A';
  const nameB = persona_b.name ?? 'Agent B';
  const formattedTranscript = formatTranscript(transcript);
  const scoreMin = Math.max(0, baseline_score - 0.1).toFixed(2);
  const scoreMax = Math.min(1, baseline_score + 0.1).toFixed(2);

  let system: string;
  if (language === 'ko') {
    system = `당신은 두 사람의 대화를 분석하여 호환성 보고서를 작성하는 전문가입니다.

## 참가자
- ${nameA}: ${JSON.stringify(persona_a.extracted_features)}
- ${nameB}: ${JSON.stringify(persona_b.extracted_features)}

## 기준 점수
기준 호환성 점수는 ${baseline_score.toFixed(2)}입니다.
최종 compatibility_score는 반드시 ${scoreMin}에서 ${scoreMax} 사이여야 합니다.

## 출력 형식 (JSON)
다음 JSON 형식으로만 응답하세요:
{
  "compatibility_score": number (${scoreMin}-${scoreMax} 사이),
  "why_click": string (50-200자, 두 사람이 잘 맞는 이유를 구체적으로),
  "watch_out": string (50-200자, 주의해야 할 마찰 지점),
  "highlight_quotes": string[] (6-10개, 대화에서 직접 인용, 반드시 원문 그대로),
  "rendered_transcript": [{ "speaker": string, "text": string }] (전체 대화록)
}

## 제약사항
- highlight_quotes는 반드시 대화 원문에서 그대로 인용하세요. 수정하거나 요약하지 마세요.
- rendered_transcript는 제공된 대화록과 동일해야 합니다. 수정하지 마세요.
- why_click과 watch_out은 막연한 칭찬이 아닌 구체적인 내용이어야 합니다.
- "완벽" 또는 확신 있는 표현을 사용하지 마세요.`;
  } else {
    system = `You are an expert analyst who reads a conversation between two people and produces a compatibility report.

## Participants
- ${nameA}: ${JSON.stringify(persona_a.extracted_features)}
- ${nameB}: ${JSON.stringify(persona_b.extracted_features)}

## Baseline Score
The baseline compatibility score is ${baseline_score.toFixed(2)}.
Your final compatibility_score MUST fall between ${scoreMin} and ${scoreMax}.

## Output Format (JSON only)
Respond with only the following JSON:
{
  "compatibility_score": number (between ${scoreMin} and ${scoreMax}),
  "why_click": string (50-200 chars, specific reason these two would connect),
  "watch_out": string (50-200 chars, specific friction point to be aware of),
  "highlight_quotes": string[] (6-10 items, verbatim quotes from the transcript),
  "rendered_transcript": [{ "speaker": string, "text": string }] (full transcript)
}

## Constraints
- highlight_quotes must be verbatim from the transcript. Do not paraphrase or summarize.
- rendered_transcript must match the provided transcript exactly. Do not modify it.
- why_click and watch_out must be specific, not vague compliments.
- Never use the word "perfect" or claim certainty.`;
  }

  const messages: StreamChatMessage[] = [
    {
      role: 'user',
      content: formattedTranscript,
    },
  ];

  return { system, messages, schema: buildReportSchema(baseline_score) };
}
