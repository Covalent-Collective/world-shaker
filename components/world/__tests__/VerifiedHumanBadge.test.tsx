import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import VerifiedHumanBadge from '../VerifiedHumanBadge';

vi.mock('@/lib/i18n/useT', () => ({
  useT: () => (key: string) => key,
}));

describe('VerifiedHumanBadge', () => {
  describe('full variant (default)', () => {
    it('renders visible text label', () => {
      render(<VerifiedHumanBadge />);
      expect(screen.getByText('badge.verified_human')).toBeInTheDocument();
    });

    it('has aria-label for screen readers', () => {
      const { container } = render(<VerifiedHumanBadge />);
      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toHaveAttribute('aria-label', 'World ID Verified Human');
    });

    it('matches snapshot', () => {
      const { container } = render(<VerifiedHumanBadge />);
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('compact variant', () => {
    it('renders icon only (text is sr-only)', () => {
      render(<VerifiedHumanBadge variant="compact" />);
      // The sr-only span still exists in DOM but visible text is screen-reader only
      const srOnly = screen.getByText('badge.verified_human');
      expect(srOnly).toHaveClass('sr-only');
    });

    it('has aria-label for screen readers', () => {
      const { container } = render(<VerifiedHumanBadge variant="compact" />);
      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toHaveAttribute('aria-label', 'World ID Verified Human');
    });

    it('matches snapshot', () => {
      const { container } = render(<VerifiedHumanBadge variant="compact" />);
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  it('forwards className to wrapper', () => {
    const { container } = render(<VerifiedHumanBadge className="my-custom-class" />);
    expect(container.firstChild).toHaveClass('my-custom-class');
  });
});
