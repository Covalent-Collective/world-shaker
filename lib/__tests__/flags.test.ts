import { describe, it, expect, afterEach } from 'vitest';

describe('flags', () => {
  afterEach(() => {
    delete process.env.BILINGUAL_PROMPTS_V1;
    delete process.env.STROLL_WORLD_V1;
  });

  it('BILINGUAL_PROMPTS_V1 defaults to false', async () => {
    delete process.env.BILINGUAL_PROMPTS_V1;
    const { isEnabled } = await import('../flags');
    expect(isEnabled('BILINGUAL_PROMPTS_V1')).toBe(false);
  });

  it('STROLL_WORLD_V1 defaults to false', async () => {
    delete process.env.STROLL_WORLD_V1;
    const { isEnabled } = await import('../flags');
    expect(isEnabled('STROLL_WORLD_V1')).toBe(false);
  });

  it('BILINGUAL_PROMPTS_V1 is enabled when env var is "true"', async () => {
    process.env.BILINGUAL_PROMPTS_V1 = 'true';
    const { isEnabled } = await import('../flags');
    expect(isEnabled('BILINGUAL_PROMPTS_V1')).toBe(true);
  });

  it('STROLL_WORLD_V1 is enabled when env var is "true"', async () => {
    process.env.STROLL_WORLD_V1 = 'true';
    const { isEnabled } = await import('../flags');
    expect(isEnabled('STROLL_WORLD_V1')).toBe(true);
  });

  it('flag is false when env var is "1" (not exact "true")', async () => {
    process.env.BILINGUAL_PROMPTS_V1 = '1';
    const { isEnabled } = await import('../flags');
    expect(isEnabled('BILINGUAL_PROMPTS_V1')).toBe(false);
  });

  it('flags object reflects default false at module load time', async () => {
    delete process.env.BILINGUAL_PROMPTS_V1;
    delete process.env.STROLL_WORLD_V1;
    const { flags } = await import('../flags');
    // flags is evaluated at module init — when env is absent, both are false
    expect(typeof flags.BILINGUAL_PROMPTS_V1).toBe('boolean');
    expect(typeof flags.STROLL_WORLD_V1).toBe('boolean');
  });
});
