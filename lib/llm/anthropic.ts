import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const DEFAULT_MODEL = 'claude-sonnet-4-6';

/**
 * Wrapper for the explanation-generation step of the matching pipeline.
 * Per v3 spec: LLM is used ONLY to generate the why-click + watch-out + flavor
 * quotes for top-3 matches. Never used for compatibility scoring (that lives
 * in deterministic SQL).
 */
export async function generateExplanation(args: {
  userFeatures: Record<string, unknown>;
  candidateFeatures: Record<string, unknown>;
  systemPrompt: string;
}): Promise<{
  why_click: string;
  watch_out: string;
  highlights: Array<{ speaker: 'A' | 'B'; text: string }>;
}> {
  const res = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 600,
    system: args.systemPrompt,
    messages: [
      {
        role: 'user',
        content: JSON.stringify({
          user: args.userFeatures,
          candidate: args.candidateFeatures,
        }),
      },
    ],
  });

  const text = res.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') throw new Error('no_text_block');

  // Expect strict JSON output. Replace with structured-output once available.
  const parsed = JSON.parse(text.text) as {
    why_click: string;
    watch_out: string;
    highlights: Array<{ speaker: 'A' | 'B'; text: string }>;
  };
  return parsed;
}

export { client as anthropic };
