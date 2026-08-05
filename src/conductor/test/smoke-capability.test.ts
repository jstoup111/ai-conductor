import { describe, expect, it } from 'vitest';
import {
  SMOKE_CAPABILITIES,
  assertGateCredentialedExecution,
  declareSmokeCapability,
  getDeclaredSmokeCapability,
  resolveAdvisorySmokeFile,
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

  it('reports a capability force-skip as an operator override in advisory mode', () => {
    const resolutions = resolveAdvisorySmokeCapabilities({
      hasCommand: () => true,
      environment: {
        CLAUDE_CODE_OAUTH_TOKEN: 'token',
        SMOKE_FORCE_SKIP: 'capability:credentialed',
      },
    });

    expect(resolutions.credentialed).toEqual({
      outcome: 'skipped',
      unmet: 'operator override',
    });
  });

  it('reports a file force-skip as an operator override in advisory mode', () => {
    const resolution = resolveAdvisorySmokeFile(
      'test/engine/daemon-e2e-live.smoke.test.ts',
      'credentialed',
      {
        hasCommand: () => true,
        environment: {
          CLAUDE_CODE_OAUTH_TOKEN: 'token',
          SMOKE_FORCE_SKIP: 'file:test/engine/daemon-e2e-live.smoke.test.ts',
        },
      },
    );

    expect(resolution).toEqual({
      outcome: 'skipped',
      unmet: 'operator override',
    });
  });

  it('fails gate mode when an operator force-skips the credentialed capability', () => {
    const resolutions = resolveGateSmokeCapabilities({
      hasCommand: () => true,
      environment: {
        CLAUDE_CODE_OAUTH_TOKEN: 'token',
        SMOKE_FORCE_SKIP: 'capability:credentialed',
      },
    });

    expect(resolutions.credentialed).toEqual({
      outcome: 'failed',
      unmet: 'operator override',
    });
  });
});
