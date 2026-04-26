// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// --- Hoist mocks so they are available inside vi.mock factories ---
const { mockRouterPush, mockCapture } = vi.hoisted(() => ({
  mockRouterPush: vi.fn(),
  mockCapture: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

vi.mock('@/lib/posthog/client', () => ({
  posthog: { capture: mockCapture },
}));

vi.mock('@/lib/i18n/useT', () => ({
  useT: () => (key: string) => key,
}));

// --- Subject under test ---
import IntroPage from '../intro/page';

// ---------------------------------------------------------------------------

describe('IntroPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockRouterPush.mockClear();
    mockCapture.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not show skip button before 5 seconds', () => {
    render(<IntroPage />);
    expect(screen.queryByText('intro.skip')).toBeNull();
  });

  it('shows skip button after 5 seconds', () => {
    render(<IntroPage />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText('intro.skip')).toBeTruthy();
  });

  it('clicking skip fires posthog capture and router push', () => {
    render(<IntroPage />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    fireEvent.click(screen.getByText('intro.skip'));
    expect(mockCapture).toHaveBeenCalledWith('onboarding_video_completed');
    expect(mockRouterPush).toHaveBeenCalledWith('/onboarding/interview');
  });

  it('video onEnded fires posthog capture and router push', () => {
    render(<IntroPage />);
    const video = document.querySelector('video') as HTMLVideoElement;
    fireEvent.ended(video);
    expect(mockCapture).toHaveBeenCalledWith('onboarding_video_completed');
    expect(mockRouterPush).toHaveBeenCalledWith('/onboarding/interview');
  });

  it('renders video with correct src', () => {
    render(<IntroPage />);
    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video.getAttribute('src')).toBe('/intro.mp4');
  });
});
