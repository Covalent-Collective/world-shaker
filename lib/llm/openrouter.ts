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

export interface StreamChatUsage {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  model: string;
}

export interface StreamChatChunk {
  delta: string;
  done: boolean;
  usage?: StreamChatUsage;
}

export interface StreamChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamChatOptions {
  model: string;
  messages: Array<StreamChatMessage>;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Stream a chat completion from OpenRouter using raw fetch + SSE.
 * Yields delta strings as they arrive; final chunk has done:true + usage.
 */
export async function* streamChat(opts: StreamChatOptions): AsyncGenerator<StreamChatChunk> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY missing');

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'https://world-shaker.local',
      'X-Title': APP_TITLE,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
      stream: true,
      usage: { include: true },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${body}`);
  }

  if (!response.body) throw new Error('OpenRouter response has no body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let usagePayload: StreamChatUsage | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    // Keep the last (potentially incomplete) line in the buffer
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === 'data: [DONE]') continue;
      if (!trimmed.startsWith('data: ')) continue;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(trimmed.slice(6)) as Record<string, unknown>;
      } catch {
        continue;
      }

      // Capture usage when OpenRouter sends it (may come on any chunk)
      if (parsed.usage && typeof parsed.usage === 'object') {
        const u = parsed.usage as Record<string, unknown>;
        const costUsd =
          typeof u.cost === 'number' ? u.cost : typeof u.cost_usd === 'number' ? u.cost_usd : null;

        if (costUsd === null) {
          console.warn('[streamChat] OpenRouter did not return cost in usage; defaulting to 0');
        }

        usagePayload = {
          input_tokens:
            typeof u.prompt_tokens === 'number'
              ? u.prompt_tokens
              : typeof u.input_tokens === 'number'
                ? u.input_tokens
                : 0,
          output_tokens:
            typeof u.completion_tokens === 'number'
              ? u.completion_tokens
              : typeof u.output_tokens === 'number'
                ? u.output_tokens
                : 0,
          cost_usd: costUsd ?? 0,
          model: opts.model,
        };
      }

      // Extract content delta from choices[0].delta.content
      const choices = parsed.choices;
      if (!Array.isArray(choices) || choices.length === 0) continue;

      const delta = (choices[0] as Record<string, unknown>).delta;
      if (!delta || typeof delta !== 'object') continue;

      const content = (delta as Record<string, unknown>).content;
      if (typeof content === 'string' && content.length > 0) {
        yield { delta: content, done: false };
      }
    }
  }

  yield {
    delta: '',
    done: true,
    usage: usagePayload ?? {
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
      model: opts.model,
    },
  };
}
