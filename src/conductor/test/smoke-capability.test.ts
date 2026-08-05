import { describe, expect, it } from 'vitest';
import {
  SMOKE_CAPABILITIES,
  declareSmokeCapability,
  getDeclaredSmokeCapability,
} from './smoke-capability.js';

describe('smoke capability declarations', () => {
  it('exposes exactly the closed smoke capability set', () => {
    expect(SMOKE_CAPABILITIES).toEqual([
      'hermetic',
      'toolchain',
      'credentialed',
    ]);
  });

  it('records a smoke file capability declaration', () => {
    const file = 'test/smoke/example.smoke.test.ts';

    declareSmokeCapability(file, 'toolchain');

    expect(getDeclaredSmokeCapability(file)).toBe('toolchain');
  });

  it('rejects an out-of-set capability declaration', () => {
    const file = 'test/smoke/invalid-capability.smoke.test.ts';
    const capability = 'networked';

    expect(() =>
      declareSmokeCapability(file, capability as 'toolchain'),
    ).toThrow(new Error(`Smoke file ${file} declares invalid capability ${capability}`));
  });

  it('rejects a discovered smoke file without a capability declaration', () => {
    const file = 'test/smoke/undeclared.smoke.test.ts';

    expect(() => getDeclaredSmokeCapability(file)).toThrow(file);
  });
});
