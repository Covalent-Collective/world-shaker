// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import CardStack from '../CardStack';

const CANDIDATES = [
  { candidate_user: 'aaaabbbb-0000-0000-0000-000000000001' },
  { candidate_user: 'ccccdddd-0000-0000-0000-000000000002' },
  { candidate_user: 'eeeeffff-0000-0000-0000-000000000003' },
];

describe('CardStack', () => {
  it('renders 3 candidate cards when given 3 candidates', () => {
    render(<CardStack candidates={CANDIDATES} onTap={vi.fn()} />);
    const stack = screen.getByTestId('card-stack');
    const cards = stack.querySelectorAll('button');
    expect(cards).toHaveLength(3);
  });

  it('calls onTap with the correct candidate id when a card is clicked', async () => {
    const onTap = vi.fn();
    render(<CardStack candidates={CANDIDATES} onTap={onTap} />);

    const firstCard = screen.getByTestId(`candidate-card-${CANDIDATES[0]!.candidate_user}`);
    await userEvent.click(firstCard);

    expect(onTap).toHaveBeenCalledOnce();
    expect(onTap).toHaveBeenCalledWith(CANDIDATES[0]!.candidate_user);
  });

  it('calls onTap with the second candidate id when second card is clicked', async () => {
    const onTap = vi.fn();
    render(<CardStack candidates={CANDIDATES} onTap={onTap} />);

    const secondCard = screen.getByTestId(`candidate-card-${CANDIDATES[1]!.candidate_user}`);
    await userEvent.click(secondCard);

    expect(onTap).toHaveBeenCalledOnce();
    expect(onTap).toHaveBeenCalledWith(CANDIDATES[1]!.candidate_user);
  });

  it('renders empty container when candidates array is empty', () => {
    render(<CardStack candidates={[]} onTap={vi.fn()} />);
    const stack = screen.getByTestId('card-stack');
    expect(stack.querySelectorAll('button')).toHaveLength(0);
  });
});
