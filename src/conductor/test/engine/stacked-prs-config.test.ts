import { describe, expect, it } from 'vitest';

import { CONFIG_CONSUMER_KEY_SETS, validateConfig } from '../../src/engine/config.js';

describe('stacked_prs config block', () => {
  it('leaves an absent block undefined', () => {
    const result = validateConfig({});

    expect(result.ok && result.config.stacked_prs).toBeUndefined();
  });

  it('defaults enabled to false when the block is present but empty', () => {
    const result = validateConfig({ stacked_prs: {} });

    expect(result.ok && result.config.stacked_prs).toEqual({ enabled: false });
  });

  it('preserves enabled: true', () => {
    const result = validateConfig({ stacked_prs: { enabled: true } });

    expect(result.ok && result.config.stacked_prs).toEqual({ enabled: true });
  });

  it('rejects a non-boolean enabled value by its named path', () => {
    const result = validateConfig({ stacked_prs: { enabled: 'yes' } });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/stacked_prs\.enabled.*boolean/i);
  });

  it('rejects unknown keys in the block by name', () => {
    const result = validateConfig({ stacked_prs: { max_slices: 3 } });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/max_slices.*stacked_prs|stacked_prs.*max_slices/i);
  });

  it('rejects a list value because the block must be an object', () => {
    const result = validateConfig({ stacked_prs: [true] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/stacked_prs.*must be an object/i);
  });

  it('declares enabled as the only consumer key', () => {
    expect(CONFIG_CONSUMER_KEY_SETS.stacked_prs).toEqual(['enabled']);
  });
});
