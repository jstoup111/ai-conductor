// Covers: task:4
import { describe, expect, it } from 'vitest';

import { CONFIG_CONSUMER_KEY_SETS, validateConfig } from '../../src/engine/config.js';

describe('stacked_prs config block', () => {
  it('leaves an absent block undefined', () => {
    const result = validateConfig({});

    expect(result.ok && result.config.stacked_prs).toBeUndefined();
  });

  it('defaults enabled to false and max_slices to 1 when the block is present but empty', () => {
    const result = validateConfig({ stacked_prs: {} });

    expect(result.ok && result.config.stacked_prs).toEqual({ enabled: false, max_slices: 1 });
  });

  it('preserves enabled: true and defaults max_slices to 1', () => {
    const result = validateConfig({ stacked_prs: { enabled: true } });

    expect(result.ok && result.config.stacked_prs).toEqual({ enabled: true, max_slices: 1 });
  });

  it.each([1, 5, 6, 7, 9])('accepts max_slices %i', (maxSlices) => {
    const result = validateConfig({ stacked_prs: { max_slices: maxSlices } });

    expect(result.ok && result.config.stacked_prs).toEqual({ enabled: false, max_slices: maxSlices });
  });

  it.each([6, 7])('warns when max_slices is %i', (maxSlices) => {
    const result = validateConfig({ stacked_prs: { max_slices: maxSlices } });

    expect(result.ok && result.warnings).toContainEqual(expect.stringMatching(/stacked_prs\.max_slices/i));
  });

  it('does not warn when max_slices is 5', () => {
    const result = validateConfig({ stacked_prs: { max_slices: 5 } });

    expect(result.ok && result.warnings).not.toContainEqual(expect.stringMatching(/stacked_prs\.max_slices/i));
  });

  it('rejects a non-boolean enabled value by its named path', () => {
    const result = validateConfig({ stacked_prs: { enabled: 'yes' } });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/stacked_prs\.enabled.*boolean/i);
  });

  it.each([10, 0, 2.5, '3'])('rejects invalid max_slices value %s by its named path', (maxSlices) => {
    const result = validateConfig({ stacked_prs: { max_slices: maxSlices } });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/max_slices.*stacked_prs|stacked_prs.*max_slices/i);
  });

  it('rejects unknown keys in the block by name', () => {
    const result = validateConfig({ stacked_prs: { max_parallel: 3 } });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/max_parallel.*stacked_prs|stacked_prs.*max_parallel/i);
  });

  it('rejects a list value because the block must be an object', () => {
    const result = validateConfig({ stacked_prs: [true] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/stacked_prs.*must be an object/i);
  });

  it('declares enabled and max_slices as consumer keys', () => {
    expect(CONFIG_CONSUMER_KEY_SETS.stacked_prs).toEqual(['enabled', 'max_slices']);
  });
});
