// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import HighlightCard from '../HighlightCard';

const SEED_QUOTES = [
  { speaker: 'Alice', text: 'I love building things.' },
  { speaker: 'Bob', text: 'Collaboration is key.' },
  { speaker: 'Alice', text: 'Design matters a lot.' },
  { speaker: 'Bob', text: 'Shipping fast is important.' },
  { speaker: 'Alice', text: 'Learning never stops.' },
  { speaker: 'Bob', text: 'Trust is foundational.' },
  { speaker: 'Alice', text: 'Feedback loops are essential.' },
  { speaker: 'Bob', text: 'We should iterate often.' },
];

const SEED_MATCH = {
  whyClick: 'Strong alignment on product vision and execution speed.',
  watchOut: 'Different risk tolerances may cause friction.',
  highlightQuotes: SEED_QUOTES,
  whyClickLabel: 'Why Click',
  watchOutLabel: 'Watch Out',
};

describe('HighlightCard', () => {
  it('renders why_click label and text', () => {
    render(<HighlightCard {...SEED_MATCH} />);
    expect(screen.getByText('Why Click')).toBeInTheDocument();
    expect(
      screen.getByText('Strong alignment on product vision and execution speed.'),
    ).toBeInTheDocument();
  });

  it('renders watch_out label and text', () => {
    render(<HighlightCard {...SEED_MATCH} />);
    expect(screen.getByText('Watch Out')).toBeInTheDocument();
    expect(screen.getByText('Different risk tolerances may cause friction.')).toBeInTheDocument();
  });

  it('renders all 8 highlight quotes', () => {
    render(<HighlightCard {...SEED_MATCH} />);
    expect(screen.getByText(/I love building things/)).toBeInTheDocument();
    expect(screen.getByText(/Collaboration is key/)).toBeInTheDocument();
    expect(screen.getByText(/We should iterate often/)).toBeInTheDocument();
    const quotes = document.querySelectorAll('blockquote');
    expect(quotes).toHaveLength(8);
  });

  it('renders at most 10 quotes when more are provided', () => {
    const manyQuotes = Array.from({ length: 15 }, (_, i) => ({
      speaker: i % 2 === 0 ? 'Alice' : 'Bob',
      text: `Quote number ${i + 1}.`,
    }));
    render(<HighlightCard {...SEED_MATCH} highlightQuotes={manyQuotes} />);
    const quotes = document.querySelectorAll('blockquote');
    expect(quotes.length).toBeLessThanOrEqual(10);
  });

  it('highlight quotes total word count is <=120', () => {
    render(<HighlightCard {...SEED_MATCH} />);
    const words = SEED_QUOTES.flatMap((q) => q.text.split(/\s+/)).filter(Boolean);
    expect(words.length).toBeLessThanOrEqual(120);
  });

  it('renders speaker attribution in each quote', () => {
    render(<HighlightCard {...SEED_MATCH} />);
    const footers = document.querySelectorAll('blockquote footer');
    expect(footers.length).toBe(8);
    expect(footers[0]?.textContent).toBe('Alice');
    expect(footers[1]?.textContent).toBe('Bob');
  });
});
