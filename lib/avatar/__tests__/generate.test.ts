// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Mock getServiceClient before importing generate so the module-level import
// resolves to our stub.
// ---------------------------------------------------------------------------

const mockUpdate = vi.fn();
const mockUpdateEq = vi.fn();
const mockSelectSingle = vi.fn();
const mockSelectEq = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: () => ({
    from: mockFrom,
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the full service client mock chain supporting both:
 *   from('agents').select(...).eq(...).single()  → selectResult
 *   from('agents').update(...).eq(...)           → { error: null }
 *
 * selectResult defaults to no existing avatar (data: null, error: null),
 * which means the one-shot guard passes through and generation proceeds.
 */
function setupDbSuccess(
  selectResult: {
    data: Record<string, unknown> | null;
    error: null | { code?: string; message: string };
  } = { data: null, error: null },
): void {
  // SELECT chain: from('agents').select(...).eq(...).single()
  mockSelectSingle.mockResolvedValue(selectResult);
  mockSelectEq.mockReturnValue({ single: mockSelectSingle });
  mockSelect.mockReturnValue({ eq: mockSelectEq });

  // UPDATE chain: from('agents').update(...).eq(...).is(...).select(...)
  // The .is() + .select() chain resolves to { data: [...], error: null }
  // representing one row updated (winner of atomic predicate check).
  mockUpdateEq.mockReturnValue({
    is: vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [{ avatar_url: 'placeholder', avatar_generated_at: new Date().toISOString() }],
        error: null,
      }),
    }),
  });
  mockUpdate.mockReturnValue({ eq: mockUpdateEq });

  // from() returns an object exposing both select and update
  mockFrom.mockReturnValue({ select: mockSelect, update: mockUpdate });
}

/** Build the service client mock chain that returns a DB update error. */
function setupDbError(message: string): void {
  // SELECT returns no existing avatar (guard passes through)
  mockSelectSingle.mockResolvedValue({ data: null, error: null });
  mockSelectEq.mockReturnValue({ single: mockSelectSingle });
  mockSelect.mockReturnValue({ eq: mockSelectEq });

  // UPDATE chain: .eq().is().select() → error
  mockUpdateEq.mockReturnValue({
    is: vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: null, error: { message } }),
    }),
  });
  mockUpdate.mockReturnValue({ eq: mockUpdateEq });

  mockFrom.mockReturnValue({ select: mockSelect, update: mockUpdate });
}

/** Compute the expected placeholder hash inline (independent of prod code path). */
function expectedPlaceholderUrl(features: Record<string, unknown>): string {
  const hash = createHash('sha256').update(JSON.stringify(features)).digest('hex').slice(0, 12);
  return `/avatars/placeholder/${hash}.png`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

import { generateAvatar } from '../generate';

describe('generateAvatar — placeholder mode (no OPENROUTER_IMAGE_MODEL)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OPENROUTER_IMAGE_MODEL;
    delete process.env.OPENROUTER_API_KEY;
    setupDbSuccess();
  });

  afterEach(() => {
    delete process.env.OPENROUTER_IMAGE_MODEL;
    delete process.env.OPENROUTER_API_KEY;
  });

  it('returns placeholder=true and a deterministic URL based on sha256 of features', async () => {
    const features = { mood: 'calm', language: 'ko', age_range: '20s' };
    const result = await generateAvatar({ agent_id: 'agent-1', extracted_features: features });

    expect(result.placeholder).toBe(true);
    expect(result.url).toBe(expectedPlaceholderUrl(features));
    // URL must match the path pattern
    expect(result.url).toMatch(/^\/avatars\/placeholder\/[0-9a-f]{12}\.png$/);
  });

  it('produces the same URL for the same features (deterministic)', async () => {
    const features = { mood: 'happy', trait: 'curious' };

    setupDbSuccess();
    const first = await generateAvatar({ agent_id: 'agent-a', extracted_features: features });

    vi.clearAllMocks();
    setupDbSuccess();
    const second = await generateAvatar({ agent_id: 'agent-b', extracted_features: features });

    expect(first.url).toBe(second.url);
  });

  it('produces different URLs for different features', async () => {
    const featuresA = { mood: 'calm' };
    const featuresB = { mood: 'energetic' };

    setupDbSuccess();
    const resultA = await generateAvatar({ agent_id: 'agent-x', extracted_features: featuresA });

    vi.clearAllMocks();
    setupDbSuccess();
    const resultB = await generateAvatar({ agent_id: 'agent-y', extracted_features: featuresB });

    expect(resultA.url).not.toBe(resultB.url);
  });

  it('calls db.from("agents").update() with avatar_url and avatar_generated_at', async () => {
    const features = { trait: 'ambitious' };
    const result = await generateAvatar({
      agent_id: 'agent-db-test',
      extracted_features: features,
    });

    expect(mockFrom).toHaveBeenCalledWith('agents');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        avatar_url: result.url,
        avatar_generated_at: expect.any(String),
      }),
    );
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'agent-db-test');
  });

  it('throws when the DB update returns an error', async () => {
    setupDbError('unique constraint violation');
    const features = { trait: 'stubborn' };

    await expect(
      generateAvatar({ agent_id: 'agent-err', extracted_features: features }),
    ).rejects.toThrow('avatar_db_update_error');
  });
});

describe('generateAvatar — one-shot immutability guard (US-501)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OPENROUTER_IMAGE_MODEL;
    delete process.env.OPENROUTER_API_KEY;
  });

  afterEach(() => {
    delete process.env.OPENROUTER_IMAGE_MODEL;
    delete process.env.OPENROUTER_API_KEY;
  });

  it('returns existing URL on second call without writing to DB or calling image API', async () => {
    const features = { mood: 'calm', language: 'ko' };
    const existingUrl = expectedPlaceholderUrl(features);
    const existingTimestamp = '2026-04-26T00:00:00.000Z';

    // Simulate agent already has avatar_generated_at set
    setupDbSuccess({
      data: { avatar_url: existingUrl, avatar_generated_at: existingTimestamp },
      error: null,
    });

    const result = await generateAvatar({ agent_id: 'agent-repeat', extracted_features: features });

    expect(result.url).toBe(existingUrl);
    expect(result.placeholder).toBe(true);

    // Must NOT have called update — no second write
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockUpdateEq).not.toHaveBeenCalled();
  });

  it('returns placeholder=false for existing real image URL on second call', async () => {
    const existingUrl = 'https://cdn.openrouter.ai/images/existing-avatar.png';
    const existingTimestamp = '2026-04-26T00:00:00.000Z';

    setupDbSuccess({
      data: { avatar_url: existingUrl, avatar_generated_at: existingTimestamp },
      error: null,
    });

    const result = await generateAvatar({
      agent_id: 'agent-real-img',
      extracted_features: { style: 'cyberpunk' },
    });

    expect(result.url).toBe(existingUrl);
    expect(result.placeholder).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('throws avatar_db_select_error when SELECT fails with unexpected error', async () => {
    // Non-PGRST116 error from the SELECT should surface
    mockSelectSingle.mockResolvedValue({
      data: null,
      error: { code: 'PGRST500', message: 'connection timeout' },
    });
    mockSelectEq.mockReturnValue({ single: mockSelectSingle });
    mockSelect.mockReturnValue({ eq: mockSelectEq });
    mockFrom.mockReturnValue({ select: mockSelect, update: mockUpdate });

    await expect(
      generateAvatar({ agent_id: 'agent-select-err', extracted_features: { trait: 'bold' } }),
    ).rejects.toThrow('avatar_db_select_error');
  });
});

describe('generateAvatar — real image mode (OPENROUTER_IMAGE_MODEL set)', () => {
  const FAKE_IMAGE_URL = 'https://cdn.openrouter.ai/images/test-avatar.png';
  const FAKE_MODEL = 'stability/stable-diffusion-xl';

  // Save and restore the global fetch mock
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENROUTER_IMAGE_MODEL = FAKE_MODEL;
    process.env.OPENROUTER_API_KEY = 'test-api-key';
    process.env.NEXT_PUBLIC_APP_URL = 'https://world-shaker.test';

    originalFetch = globalThis.fetch;
    setupDbSuccess();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.OPENROUTER_IMAGE_MODEL;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  it('calls OpenRouter image API and returns placeholder=false with real URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ url: FAKE_IMAGE_URL }] }),
    } as Response);
    globalThis.fetch = mockFetch;

    const features = { style: 'cyberpunk', hair: 'blue' };
    const result = await generateAvatar({ agent_id: 'agent-img', extracted_features: features });

    expect(result.placeholder).toBe(false);
    expect(result.url).toBe(FAKE_IMAGE_URL);

    // Verify fetch was called with the correct endpoint and model
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOptions] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('https://openrouter.ai/api/v1/images/generations');
    const body = JSON.parse(calledOptions.body as string) as { model: string };
    expect(body.model).toBe(FAKE_MODEL);
  });

  it('writes the real image URL to the agents table', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ url: FAKE_IMAGE_URL }] }),
    } as Response);
    globalThis.fetch = mockFetch;

    await generateAvatar({ agent_id: 'agent-write', extracted_features: { trait: 'bold' } });

    expect(mockFrom).toHaveBeenCalledWith('agents');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ avatar_url: FAKE_IMAGE_URL }),
    );
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'agent-write');
  });

  it('throws when OpenRouter image API returns a non-ok status', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limit exceeded',
    } as unknown as Response);
    globalThis.fetch = mockFetch;

    await expect(
      generateAvatar({ agent_id: 'agent-fail', extracted_features: { trait: 'bold' } }),
    ).rejects.toThrow('openrouter_image_api_error');
  });

  it('throws when OpenRouter returns an empty data array', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    } as Response);
    globalThis.fetch = mockFetch;

    await expect(
      generateAvatar({ agent_id: 'agent-empty', extracted_features: { trait: 'bold' } }),
    ).rejects.toThrow('openrouter_image_empty_response');
  });

  it('throws when OPENROUTER_API_KEY is missing in image mode', async () => {
    delete process.env.OPENROUTER_API_KEY;

    await expect(
      generateAvatar({ agent_id: 'agent-nokey', extracted_features: { trait: 'bold' } }),
    ).rejects.toThrow('OPENROUTER_API_KEY missing');
  });
});
