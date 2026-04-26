// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

vi.mock('@/lib/i18n/useT', () => ({
  useT: () => (key: string) => key,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import LiveTranscript from '../LiveTranscript';

interface RegisteredHandler {
  type: string;
  handler: (ev: MessageEvent<string>) => void;
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  handlers: RegisteredHandler[] = [];

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: (ev: MessageEvent<string>) => void): void {
    this.handlers.push({ type, handler });
  }

  removeEventListener(type: string, handler: (ev: MessageEvent<string>) => void): void {
    this.handlers = this.handlers.filter((h) => h.type !== type || h.handler !== handler);
  }

  close(): void {
    this.closed = true;
  }

  dispatch(type: string, data: string, lastEventId = ''): void {
    const ev = new MessageEvent(type, { data, lastEventId }) as MessageEvent<string>;
    for (const h of this.handlers) {
      if (h.type === type) h.handler(ev);
    }
  }
}

describe('LiveTranscript', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    (globalThis as unknown as { EventSource: typeof FakeEventSource }).EventSource =
      FakeEventSource;
  });

  afterEach(() => {
    delete (globalThis as unknown as { EventSource?: unknown }).EventSource;
  });

  it('opens an EventSource with the conversationId and lastEventId param', () => {
    render(<LiveTranscript conversationId="conv-1" initialStatus="live" initialLastEventId={3} />);

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe('/api/conversation/conv-1/stream?lastEventId=3');
  });

  it('renders preparing state before any turns arrive', () => {
    render(<LiveTranscript conversationId="conv-1" initialStatus="live" initialLastEventId={0} />);

    expect(screen.getByText('conversation.preparing')).toBeInTheDocument();
  });

  it('appends turns dispatched on the SSE source and de-dupes by index', () => {
    render(<LiveTranscript conversationId="conv-1" initialStatus="live" initialLastEventId={0} />);

    const source = FakeEventSource.instances[0];

    act(() => {
      source.dispatch('turn', JSON.stringify({ turn_index: 0, speaker: 'A', text: 'hi' }), '0');
      source.dispatch('turn', JSON.stringify({ turn_index: 1, speaker: 'B', text: 'hello' }), '1');
      // duplicate index — should be ignored
      source.dispatch('turn', JSON.stringify({ turn_index: 0, speaker: 'A', text: 'dup' }), '0');
    });

    expect(screen.getByText('hi')).toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.queryByText('dup')).not.toBeInTheDocument();
  });

  it('renders FailureOverlay when a failed event fires', () => {
    render(<LiveTranscript conversationId="conv-1" initialStatus="live" initialLastEventId={0} />);

    const source = FakeEventSource.instances[0];

    act(() => {
      source.dispatch('failed', '');
    });

    // FailureOverlay button uses the same i18n key for the title and the
    // restart button; both render the literal key string under the test
    // useT() stub. There must be at least one occurrence in the DOM.
    const matches = screen.getAllByText('conversation.failure_overlay.restart');
    expect(matches.length).toBeGreaterThan(0);
    expect(source.closed).toBe(true);
  });

  it('renders complete label and closes source on complete', () => {
    render(<LiveTranscript conversationId="conv-1" initialStatus="live" initialLastEventId={0} />);

    const source = FakeEventSource.instances[0];

    act(() => {
      source.dispatch('complete', '');
    });

    expect(screen.getByText('conversation.complete')).toBeInTheDocument();
    expect(source.closed).toBe(true);
  });

  it('closes EventSource on unmount', () => {
    const { unmount } = render(
      <LiveTranscript conversationId="conv-1" initialStatus="live" initialLastEventId={0} />,
    );

    const source = FakeEventSource.instances[0];
    unmount();

    expect(source.closed).toBe(true);
  });
});
