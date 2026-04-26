// @vitest-environment jsdom
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import StarterCard from '../StarterCard';
import AgentFarewell from '../AgentFarewell';

vi.mock('@/lib/utils', () => ({
  cn: (...classes: (string | undefined | false | null)[]) => classes.filter(Boolean).join(' '),
}));

describe('StarterCard', () => {
  it('renders starter text', () => {
    render(<StarterCard text="starter1" worldChatLink="https://example.com/chat" />);
    expect(screen.getByText('starter1')).toBeInTheDocument();
  });

  it('renders 2 StarterCards when given 2 starters', () => {
    const starters = [
      { text: 'starter1', link: 'https://example.com/chat' },
      { text: 'starter2', link: 'https://example.com/chat' },
    ];
    render(
      <>
        {starters.map((s, i) => (
          <StarterCard key={i} text={s.text} worldChatLink={s.link} />
        ))}
      </>,
    );
    const cards = screen.getAllByTestId('starter-card');
    expect(cards).toHaveLength(2);
    expect(screen.getByText('starter1')).toBeInTheDocument();
    expect(screen.getByText('starter2')).toBeInTheDocument();
  });

  it('has a button element that can be clicked', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<StarterCard text="starter1" worldChatLink="https://example.com/chat" />);
    const btn = screen.getByTestId('starter-card');
    btn.click();
    expect(openSpy).toHaveBeenCalledWith(
      'https://example.com/chat',
      '_blank',
      'noopener,noreferrer',
    );
    openSpy.mockRestore();
  });
});

describe('AgentFarewell', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the farewell element', () => {
    render(<AgentFarewell />);
    expect(screen.getByTestId('agent-farewell')).toBeInTheDocument();
  });

  it('starts with opacity-0 scale-95 class before animation fires', () => {
    render(<AgentFarewell />);
    const el = screen.getByTestId('agent-farewell');
    // Before requestAnimationFrame callback: mounted=false → opacity-0 scale-95 present
    expect(el.className).toContain('opacity-0');
    expect(el.className).toContain('scale-95');
  });

  it('transitions to opacity-100 scale-100 after mount animation', async () => {
    render(<AgentFarewell />);
    const el = screen.getByTestId('agent-farewell');

    // Flush the requestAnimationFrame callback
    await act(async () => {
      vi.runAllTimers();
    });

    // After mount: the mounted=true branch applies opacity-100 scale-100
    expect(el.className).toContain('opacity-100');
    expect(el.className).toContain('scale-100');
  });
});
