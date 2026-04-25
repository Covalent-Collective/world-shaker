import 'server-only';

import OpenAI from 'openai';

/**
 * Single LLM gateway via OpenRouter.
 *
 * OpenRouter is OpenAI-compatible, so we use the `openai` SDK with a custom
 * baseURL. One API key (OPENROUTER_API_KEY) covers chat (Anthropic Sonnet)
 * and embeddings (OpenAI text-embedding-3-small) — and any other model
 * supported by the gateway.
 *
 * Model identifiers use OpenRouter's `<provider>/<model>` form. They are
 * env-overridable so you can swap models without touching code.
 */

const APP_TITLE = 'World Shaker';

function getClient() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY missing');

  return new OpenAI({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      // Optional but recommended — surface this app in the OpenRouter dashboard.
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'https://world-shaker.local',
      'X-Title': APP_TITLE,
    },
  });
}

export const DEFAULT_CHAT_MODEL =
  process.env.OPENROUTER_CHAT_MODEL ?? 'anthropic/claude-sonnet-4.6';

export const DEFAULT_EMBEDDING_MODEL =
  process.env.OPENROUTER_EMBEDDING_MODEL ?? 'openai/text-embedding-3-small';

/**
 * Per v3 spec, LLM is used ONLY for the explanation step of the matching
 * pipeline (why-click + watch-out + flavor quotes for top-3 matches).
 * Compatibility scoring lives in deterministic SQL — never here.
 */
export async function generateExplanation(args: {
  userFeatures: Record<string, unknown>;
  candidateFeatures: Record<string, unknown>;
  systemPrompt: string;
  model?: string;
}): Promise<{
  why_click: string;
  watch_out: string;
  highlights: Array<{ speaker: 'A' | 'B'; text: string }>;
}> {
  const client = getClient();

  const res = await client.chat.completions.create({
    model: args.model ?? DEFAULT_CHAT_MODEL,
    response_format: { type: 'json_object' },
    max_tokens: 600,
    messages: [
      { role: 'system', content: args.systemPrompt },
      {
        role: 'user',
        content: JSON.stringify({
          user: args.userFeatures,
          candidate: args.candidateFeatures,
        }),
      },
    ],
  });

  const content = res.choices[0]?.message?.content;
  if (!content) throw new Error('llm_empty_response');

  return JSON.parse(content) as {
    why_click: string;
    watch_out: string;
    highlights: Array<{ speaker: 'A' | 'B'; text: string }>;
  };
}

/**
 * Embed an interview-answer string. Used to build the agent's vector
 * representation for pgvector top-K prefilter in the matching pipeline.
 */
export async function embedText(input: string, model?: string): Promise<number[]> {
  const client = getClient();
  const res = await client.embeddings.create({
    model: model ?? DEFAULT_EMBEDDING_MODEL,
    input,
  });
  const embedding = res.data[0]?.embedding;
  if (!embedding) throw new Error('embedding_empty_response');
  return embedding;
}
