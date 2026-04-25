// @vitest-environment node

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { StreamChatOptions } from '../openrouter';

// Helper: build a ReadableStream that emits SSE lines from a list of raw
// "data: ..." strings (each element is one SSE event payload string).
function buildSseStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(event));
      }
      controller.close();
    },
  });
}

function makeSseChunk(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function makeDeltaEvent(content: string, model = 'test-model'): string {
  return makeSseChunk({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    model,
    choices: [{ delta: { content }, finish_reason: null, index: 0 }],
  });
}

function makeUsageEvent(
  promptTokens: number,
  completionTokens: number,
  cost: number,
  model = 'test-model',
): string {
  return makeSseChunk({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    model,
    choices: [{ delta: {}, finish_reason: 'stop', index: 0 }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, cost },
  });
}

const BASE_OPTS: StreamChatOptions = {
  model: 'test-model',
  messages: [{ role: 'user', content: 'Hello' }],
};

describe('streamChat', () => {
  const originalKey = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    vi.resetModules();
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalKey;
    }
    vi.restoreAllMocks();
  });

  it('accumulates deltas to the expected string', async () => {
    const stream = buildSseStream([
      makeDeltaEvent('Hello'),
      makeDeltaEvent(', '),
      makeDeltaEvent('world'),
      makeUsageEvent(5, 3, 0.0001),
      'data: [DONE]\n\n',
    ]);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        body: stream,
        text: async () => '',
      }),
    );

    const { streamChat } = await import('../openrouter');
    const chunks: string[] = [];
    for await (const chunk of streamChat(BASE_OPTS)) {
      if (!chunk.done) chunks.push(chunk.delta);
    }

    expect(chunks.join('')).toBe('Hello, world');
  });

  it('final chunk has done:true and a populated usage object', async () => {
    const stream = buildSseStream([
      makeDeltaEvent('Hi'),
      makeUsageEvent(10, 20, 0.00042),
      'data: [DONE]\n\n',
    ]);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        body: stream,
        text: async () => '',
      }),
    );

    const { streamChat } = await import('../openrouter');
    const chunks = [];
    for await (const chunk of streamChat(BASE_OPTS)) {
      chunks.push(chunk);
    }

    const last = chunks[chunks.length - 1];
    expect(last.done).toBe(true);
    expect(last.usage).toMatchObject({
      input_tokens: 10,
      output_tokens: 20,
      cost_usd: 0.00042,
      model: 'test-model',
    });
  });

  it('throws on 4xx status with error message from response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => '{"error":"Invalid API key"}',
      }),
    );

    const { streamChat } = await import('../openrouter');

    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of streamChat(BASE_OPTS)) {
        // consume
      }
    }).rejects.toThrow('OpenRouter error 401');
  });

  it('throws on 5xx status with error message from response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => 'Service Unavailable',
      }),
    );

    const { streamChat } = await import('../openrouter');

    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of streamChat(BASE_OPTS)) {
        // consume
      }
    }).rejects.toThrow('OpenRouter error 503');
  });

  it('throws a clear error before fetching when OPENROUTER_API_KEY is missing', async () => {
    delete process.env.OPENROUTER_API_KEY;

    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const { streamChat } = await import('../openrouter');

    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of streamChat(BASE_OPTS)) {
        // consume
      }
    }).rejects.toThrow('OPENROUTER_API_KEY missing');

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('yields no non-done chunks when SSE has only empty content', async () => {
    const stream = buildSseStream([
      makeSseChunk({
        choices: [{ delta: { content: '' }, finish_reason: null, index: 0 }],
      }),
      makeUsageEvent(1, 1, 0),
      'data: [DONE]\n\n',
    ]);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        body: stream,
        text: async () => '',
      }),
    );

    const { streamChat } = await import('../openrouter');
    const nonDone = [];
    for await (const chunk of streamChat(BASE_OPTS)) {
      if (!chunk.done) nonDone.push(chunk);
    }

    expect(nonDone).toHaveLength(0);
  });

  it('defaults cost_usd to 0 and warns when usage has no cost field', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const stream = buildSseStream([
      makeDeltaEvent('Hi'),
      makeSseChunk({
        choices: [{ delta: {}, finish_reason: 'stop', index: 0 }],
        usage: { prompt_tokens: 5, completion_tokens: 3 }, // no cost
      }),
      'data: [DONE]\n\n',
    ]);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        body: stream,
        text: async () => '',
      }),
    );

    const { streamChat } = await import('../openrouter');
    const chunks = [];
    for await (const chunk of streamChat(BASE_OPTS)) {
      chunks.push(chunk);
    }

    const last = chunks[chunks.length - 1];
    expect(last.usage?.cost_usd).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('OpenRouter did not return cost'));
  });
});
