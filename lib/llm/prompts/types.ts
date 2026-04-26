import type { ZodTypeAny } from 'zod';
import type { StreamChatMessage } from '@/lib/llm/openrouter';

export type Lang = 'ko' | 'en';

export type PromptStage = 'opening' | 'probing' | 'landing';

export interface ExtractedFeatures {
  voice?: string;
  values?: string[];
  communication_style?: string;
  life_stage?: string;
  interests?: string[];
  dealbreakers?: string[];
  [key: string]: unknown;
}

export interface PersonaProfile {
  name?: string;
  extracted_features: ExtractedFeatures;
  agent_id?: string;
  /** Raw Q→A jsonb from agents.interview_answers. Carried into the
   *  dialogue prompt so each agent reflects its owner's actual answers,
   *  not just the (often empty) extracted_features bag. The
   *  `interview_complete` sentinel and any non-string values are filtered
   *  out at injection time. */
  interview_answers?: Record<string, unknown>;
}

export interface TranscriptTurn {
  speaker: string;
  text: string;
}

export interface DialoguePromptResult {
  system: string;
  messages: StreamChatMessage[];
}

export interface ReportPromptResult {
  system: string;
  messages: StreamChatMessage[];
  schema: ZodTypeAny;
}

export interface FirstMessagePromptResult {
  system: string;
  messages: StreamChatMessage[];
  schema: ZodTypeAny;
}

export interface InterviewProbePromptResult {
  system: string;
  messages: StreamChatMessage[];
  schema: ZodTypeAny;
}
