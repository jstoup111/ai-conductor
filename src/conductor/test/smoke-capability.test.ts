import { describe, expect, it } from 'vitest';
import {
  SMOKE_CAPABILITIES,
  assertGateCredentialedExecution,
  declareSmokeCapability,
  getDeclaredSmokeCapability,
  resolveAdvisorySmokeCapabilities,
  resolveGateSmokeCapabilities,
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

  it('runs hermetic files and skips unavailable toolchain and credentialed files in advisory mode', () => {
    const resolutions = resolveAdvisorySmokeCapabilities({
      hasCommand: () => false,
      environment: {},
    });

    expect(resolutions).toEqual({
      hermetic: { outcome: 'ran' },
      toolchain: { outcome: 'skipped', unmet: 'codex' },
      credentialed: {
        outcome: 'skipped',
        unmet: 'CLAUDE_CODE_OAUTH_TOKEN',
      },
    });
  });

  it('fails rather than skipping or succeeding when a gate-mode credential is absent', () => {
    const resolutions = resolveGateSmokeCapabilities({
      hasCommand: () => true,
      environment: {},
    });

    expect(resolutions.credentialed).toEqual({
      outcome: 'failed',
      unmet: 'CLAUDE_CODE_OAUTH_TOKEN',
    });
  });

  it('fails gate mode when no credentialed case executed', () => {
    expect(() => assertGateCredentialedExecution(['hermetic', 'toolchain'])).toThrow(
      'Gate-mode smoke run executed no credentialed test files',
    );
  });
});
