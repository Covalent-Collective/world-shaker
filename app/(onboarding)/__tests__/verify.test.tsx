// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toast } from 'sonner';
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

// MiniKit mock — `isInstalled` and `commandsAsync.verify` are the only entry
// points the page touches. Each test rewrites the `verify` mock to simulate
// a different finalPayload outcome.
const mockVerify = vi.fn();
const mockIsInstalled = vi.fn(() => true);
vi.mock('@worldcoin/minikit-js', () => ({
  MiniKit: {
    isInstalled: () => mockIsInstalled(),
    commandsAsync: {
      verify: (...args: unknown[]) => mockVerify(...args),
    },
  },
  VerificationLevel: { Orb: 'orb', Device: 'device' },
}));

const SUCCESS_PAYLOAD = {
  status: 'success' as const,
  proof: 'test_proof',
  merkle_root: '0xroot',
  nullifier_hash: '0xnull',
  verification_level: 'orb',
};

// --- tests ---

describe('VerifyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsInstalled.mockReturnValue(true);
  });

  it('renders title, subtitle and CTA', () => {
    vi.stubGlobal('fetch', vi.fn());
    render(<VerifyPage />);
    expect(screen.getByText('verify.title')).toBeInTheDocument();
    expect(screen.getByText('verify.subtitle')).toBeInTheDocument();
    expect(screen.getByText('verify.cta')).toBeInTheDocument();
  });

  it('calls router.push("/intro") on 200 response from /api/verify', async () => {
    mockVerify.mockResolvedValue({ finalPayload: SUCCESS_PAYLOAD });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    render(<VerifyPage />);
    await userEvent.click(screen.getByText('verify.cta'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/intro');
    });
  });

  it('shows error toast on non-200 response from /api/verify', async () => {
    mockVerify.mockResolvedValue({ finalPayload: SUCCESS_PAYLOAD });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    render(<VerifyPage />);
    await userEvent.click(screen.getByText('verify.cta'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('shows error toast when MiniKit returns finalPayload.status === "error"', async () => {
    mockVerify.mockResolvedValue({
      finalPayload: { status: 'error', error_code: 'user_rejected' },
    });
    vi.stubGlobal('fetch', vi.fn());

    render(<VerifyPage />);
    await userEvent.click(screen.getByText('verify.cta'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('shows error toast when MiniKit is not installed (not in World App)', async () => {
    mockIsInstalled.mockReturnValue(false);
    vi.stubGlobal('fetch', vi.fn());

    render(<VerifyPage />);
    await userEvent.click(screen.getByText('verify.cta'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
