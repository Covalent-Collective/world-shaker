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
