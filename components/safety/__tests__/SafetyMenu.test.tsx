// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SafetyMenu } from '../SafetyMenu';

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

vi.mock('@/lib/i18n/useT', () => ({
  useT: () => (key: string) => key,
}));

// Stub sonner toast so it doesn't throw in jsdom
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Stub shadcn Drawer — render children directly so we can find buttons
vi.mock('@/components/ui/drawer', () => ({
  Drawer: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="drawer">{children}</div> : null,
  DrawerContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DrawerHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DrawerTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DrawerFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DrawerClose: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Stub Button to render a plain <button>
vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FetchCall {
  url: string;
  body: Record<string, unknown> | null;
}

function recordFetch(): {
  calls: FetchCall[];
  mockResponse: (status: number, body: unknown) => void;
} {
  const calls: FetchCall[] = [];
  let nextResponse = new Response(JSON.stringify({ reported: true }), { status: 200 });

  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ url, body });
    return nextResponse;
  }) as unknown as typeof fetch;

  return {
    calls,
    mockResponse(status: number, body: unknown) {
      nextResponse = new Response(JSON.stringify(body), { status });
    },
  };
}

function renderMenu(overrides?: Partial<Parameters<typeof SafetyMenu>[0]>) {
  const props = {
    reportedUserId: 'user-abc',
    surface: 'match' as const,
    open: true,
    onOpenChange: vi.fn(),
    ...overrides,
  };
  return render(<SafetyMenu {...props} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SafetyMenu', () => {
  let fetchSpy: ReturnType<typeof recordFetch>;

  beforeEach(() => {
    fetchSpy = recordFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders Report and Block buttons when open', () => {
    renderMenu();
    // The menu shows Report (button) and Block (button) — both keyed via i18n
    const reportEls = screen.getAllByText('safety.report');
    expect(reportEls.length).toBeGreaterThan(0);
    expect(screen.getByText('safety.block')).toBeInTheDocument();
  });

  it('does not render when open=false', () => {
    renderMenu({ open: false });
    expect(screen.queryByTestId('drawer')).not.toBeInTheDocument();
  });

  it('clicking Report button shows the report form', async () => {
    const user = userEvent.setup();
    renderMenu();

    // The first "safety.report" button (not the title) opens the form
    const reportButtons = screen.getAllByText('safety.report');
    // Click the button element (not the title h2)
    const reportBtn = reportButtons.find((el) => el.tagName === 'BUTTON');
    expect(reportBtn).toBeDefined();
    await user.click(reportBtn!);

    // After clicking, report-form view is shown — reason radio inputs appear
    await waitFor(() => {
      expect(screen.getByDisplayValue('harassment')).toBeInTheDocument();
    });
  });

  it('submitting a report POSTs to /api/report with correct body', async () => {
    const user = userEvent.setup();
    renderMenu({ reportedUserId: 'target-user-123' });

    // Open report form
    const reportButtons = screen.getAllByText('safety.report');
    const reportBtn = reportButtons.find((el) => el.tagName === 'BUTTON');
    await user.click(reportBtn!);

    // Select a reason
    await waitFor(() => {
      expect(screen.getByDisplayValue('harassment')).toBeInTheDocument();
    });
    await user.click(screen.getByDisplayValue('harassment'));

    // Submit
    const submitBtn = screen.getByText('safety.report', { selector: 'button' });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(fetchSpy.calls.length).toBe(1);
    });

    expect(fetchSpy.calls[0]?.url).toBe('/api/report');
    expect(fetchSpy.calls[0]?.body).toMatchObject({
      reported_user_id: 'target-user-123',
      reason: 'harassment',
    });
  });

  it('Block button POSTs to /api/report with reason=spam', async () => {
    const user = userEvent.setup();
    renderMenu({ reportedUserId: 'block-target' });

    await user.click(screen.getByText('safety.block'));

    await waitFor(() => {
      expect(fetchSpy.calls.length).toBe(1);
    });

    expect(fetchSpy.calls[0]?.url).toBe('/api/report');
    expect(fetchSpy.calls[0]?.body).toMatchObject({
      reported_user_id: 'block-target',
      reason: 'spam',
    });
  });
});
