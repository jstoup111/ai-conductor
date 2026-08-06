import { describe, expect, it, vi } from 'vitest';
import {
  SMOKE_CAPABILITIES,
  assertGateCredentialedExecution,
  emitSmokeOutcomeLedger,
  resolveAdvisorySmokeFile,
  resolveGateSmokeFile,
} from '../src/engine/smoke-capability.js';
import { runSmokeCli } from '../src/engine/smoke-runner.js';

describe('smoke capability declarations', () => {
  it('exposes exactly the closed smoke capability set', () => {
    expect(SMOKE_CAPABILITIES).toEqual([
      'hermetic',
      'toolchain',
      'credentialed',
    ]);
  });

  it('runs hermetic files and skips unavailable toolchain and credentialed files in advisory mode', () => {
    expect(resolveAdvisorySmokeFile('test/example.smoke.test.ts', 'credentialed', {
      hasCommand: () => false,
      environment: {},
    })).toEqual({ outcome: 'skipped', unmet: 'CLAUDE_CODE_OAUTH_TOKEN' });
  });

  it('fails rather than skipping or succeeding when a gate-mode credential is absent', () => {
    const resolution = resolveGateSmokeFile('test/example.smoke.test.ts', 'credentialed', {
      hasCommand: () => true,
      environment: {},
    });

    expect(resolution).toEqual({
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
    const resolution = resolveAdvisorySmokeFile('test/example.smoke.test.ts', 'credentialed', {
      hasCommand: () => true,
      environment: {
        CLAUDE_CODE_OAUTH_TOKEN: 'token',
        SMOKE_FORCE_SKIP: 'capability:credentialed',
      },
    });

    expect(resolution).toEqual({
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
    const resolution = resolveGateSmokeFile('test/example.smoke.test.ts', 'credentialed', {
      hasCommand: () => true,
      environment: {
        CLAUDE_CODE_OAUTH_TOKEN: 'token',
        SMOKE_FORCE_SKIP: 'capability:credentialed',
      },
    });

    expect(resolution).toEqual({
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

  it('rejects a discovered smoke file with no declaration before running an executor', async () => {
    const runVitest = vi.fn();
    const emit = vi.fn();

    await expect(runSmokeCli('vitest.smoke.config.ts', {
      discover: async () => [{
        file: 'test/smoke/undeclared.smoke.test.ts',
        source: 'import { it } from \'vitest\';',
      }],
      runVitest,
      emit,
    })).rejects.toThrow('Smoke file test/smoke/undeclared.smoke.test.ts declares no capability');

    expect(runVitest).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalledWith(expect.stringContaining('[hermetic]'));
  });

  it('rejects an out-of-set discovered capability before running an executor', async () => {
    const runVitest = vi.fn();

    await expect(runSmokeCli('vitest.smoke.config.ts', {
      discover: async () => [{
        file: 'test/smoke/invalid.smoke.test.ts',
        source: "const smokeCapability = 'networked';",
      }],
      runVitest,
    })).rejects.toThrow('Smoke file test/smoke/invalid.smoke.test.ts declares invalid capability networked');

    expect(runVitest).not.toHaveBeenCalled();
  });
});
