import { describe, expect, it, vi } from 'vitest';
import {
  SMOKE_CAPABILITIES,
  assertGateCredentialedExecution,
  declareSmokeCapability,
  emitSmokeOutcomeLedger,
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
      toolchain: { outcome: 'skipped', unmet: 'toolchain' },
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

  it('emits a distinct attributable ledger entry for every smoke-file outcome', () => {
    const emit = vi.fn();

    emitSmokeOutcomeLedger([
      {
        file: 'test/smoke/finish-record.smoke.test.ts',
        capability: 'hermetic',
        outcome: 'ran',
      },
      {
        file: 'test/execution/codex-provider.smoke.test.ts',
        capability: 'toolchain',
        outcome: 'skipped',
        unmet: 'codex',
      },
      {
        file: 'test/engine/daemon-e2e-live.smoke.test.ts',
        capability: 'credentialed',
        outcome: 'failed',
        evidencePath: 'artifacts/smoke/daemon-e2e-live.log',
      },
    ], emit);

    expect(emit.mock.calls).toEqual([
      ['smoke ledger: test/smoke/finish-record.smoke.test.ts [hermetic] ran'],
      ['smoke ledger: test/execution/codex-provider.smoke.test.ts [toolchain] skipped (unmet: codex)'],
      ['smoke ledger: test/engine/daemon-e2e-live.smoke.test.ts [credentialed] failed (evidence: artifacts/smoke/daemon-e2e-live.log)'],
    ]);
  });
});
