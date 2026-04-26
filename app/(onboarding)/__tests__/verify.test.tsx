// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import VerifyPage from '../verify/page';

// --- mocks ---

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/lib/i18n/useT', () => ({
  useT: () => (key: string) => key,
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

vi.mock('@/lib/posthog/client', () => ({
  posthog: { capture: vi.fn() },
}));

vi.mock('@/components/world/VerifiedHumanBadge', () => ({
  default: () => <span data-testid="verified-badge" />,
}));

// IDKitRequestWidget mock: renders a button that calls onSuccess with a fake proof
vi.mock('@worldcoin/idkit', () => ({
  orbLegacy: () => ({ type: 'OrbLegacy' }),
  IDKitRequestWidget: ({
    onSuccess,
    onError,
  }: {
    onSuccess: (result: { proof: string }) => void;
    onError: (code: string) => void;
    open: boolean;
    onOpenChange: (v: boolean) => void;
    app_id: string;
    action: string;
  }) => (
    <div>
      <button
        type="button"
        data-testid="idkit-success"
        onClick={() => onSuccess({ proof: 'test_proof' })}
      >
        Mock Success
      </button>
      <button type="button" data-testid="idkit-error" onClick={() => onError('generic_error')}>
        Mock Error
      </button>
    </div>
  ),
}));

// --- tests ---

describe('VerifyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders title, subtitle and CTA', () => {
    vi.stubGlobal('fetch', vi.fn());
    render(<VerifyPage />);
    expect(screen.getByText('verify.title')).toBeInTheDocument();
    expect(screen.getByText('verify.subtitle')).toBeInTheDocument();
    expect(screen.getByText('verify.cta')).toBeInTheDocument();
  });

  it('calls router.push("/onboarding/intro") on 200 response from /api/verify', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    render(<VerifyPage />);
    await userEvent.click(screen.getByTestId('idkit-success'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/onboarding/intro');
    });
  });

  it('shows error toast on non-200 response from /api/verify', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const { toast } = await import('sonner');

    render(<VerifyPage />);
    await userEvent.click(screen.getByTestId('idkit-success'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('verify.error_toast');
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('shows error toast when IDKit calls onError', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const { toast } = await import('sonner');

    render(<VerifyPage />);
    await userEvent.click(screen.getByTestId('idkit-error'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('verify.error_toast');
    });
  });
});
