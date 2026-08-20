import { describe, expect, it } from 'vitest';
import { validateConfig } from '../src/engine/config.js';

describe('validateConfig — cumulative_kickback_bound config', () => {
  it('resolves the total default-on kill-switch contract without warnings', () => {
    const absent = validateConfig({});
    expect(absent).toMatchObject({
      ok: true,
      config: { cumulative_kickback_bound: { enabled: true } },
      warnings: [],
    });

    const absentWithoutMaterialization = validateConfig({}, undefined, { materializeDefaults: false });
    expect(absentWithoutMaterialization).toMatchObject({
      ok: true,
      config: {},
      warnings: [],
    });

    const cases: Array<{ raw: Record<string, unknown>; enabled: boolean }> = [
      { raw: { cumulative_kickback_bound: null }, enabled: true },
      { raw: { cumulative_kickback_bound: { enabled: true } }, enabled: true },
      { raw: { cumulative_kickback_bound: { enabled: false } }, enabled: false },
      { raw: { cumulative_kickback_bound: 'invalid' }, enabled: true },
      { raw: { cumulative_kickback_bound: { enabled: 'invalid' } }, enabled: true },
      { raw: { cumulative_kickback_bound: { enabled: false, unknown: true } }, enabled: true },
    ];
    for (const testCase of cases) {
      const result = validateConfig(testCase.raw);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.cumulative_kickback_bound).toEqual({ enabled: testCase.enabled });
        expect(result.warnings).toEqual([]);
      }
    }
  });
});
