import { describe, expect, it, vi } from 'vitest';
import {
  SMOKE_CAPABILITIES,
  assertGateCredentialedExecution,
  emitSmokeOutcomeLedger,
  resolveAdvisorySmokeFile,
  resolveGateSmokeFile,
} from '../src/engine/smoke-capability.js';
import type { SmokeCapability } from '../src/engine/smoke-capability.js';
import { runSmokeCli } from '../src/engine/smoke-runner.js';
import { LIVE_E2E_PROVIDERS } from '../src/engine/live-e2e-providers.js';

const acceptedCredentialedCapabilities: readonly SmokeCapability[] = [
  'credentialed:claude',
  'credentialed:codex',
];

// @ts-expect-error SmokeCapability is a closed union, not an arbitrary string.
const rejectedSmokeCapability: SmokeCapability = 'credentialed:unknown';

void acceptedCredentialedCapabilities;
void rejectedSmokeCapability;

function withDescriptorCredentialEnvVar(
  providerId: 'claude' | 'codex',
  credentialEnvVar: string,
  run: () => void,
): void {
  const descriptor = LIVE_E2E_PROVIDERS.find(({ id }) => id === providerId);
  if (descriptor === undefined) {
    throw new Error(`Missing ${providerId} live E2E provider descriptor`);
  }

  const mutableDescriptor = descriptor as { credentialEnvVar: string };
  const originalCredentialEnvVar = mutableDescriptor.credentialEnvVar;
  mutableDescriptor.credentialEnvVar = credentialEnvVar;
  try {
    run();
  } finally {
    mutableDescriptor.credentialEnvVar = originalCredentialEnvVar;
  }
}

describe('smoke capability declarations', () => {
  it('exposes exactly the closed smoke capability set', () => {
    expect(SMOKE_CAPABILITIES).toEqual([
      'hermetic',
      'toolchain',
      'credentialed:claude',
      'credentialed:codex',
    ]);
  });

  it('runs hermetic files and skips unavailable toolchain and credentialed files in advisory mode', () => {
    expect(resolveAdvisorySmokeFile('test/example.smoke.test.ts', 'credentialed:claude', {
      hasCommand: () => false,
      environment: {},
    })).toEqual({ outcome: 'skipped', unmet: 'CLAUDE_CODE_OAUTH_TOKEN' });
  });

  it('resolves each credentialed provider against its descriptor-owned advisory credential variable', () => {
    withDescriptorCredentialEnvVar('claude', 'TEST_CLAUDE_ADVISORY_CREDENTIAL', () => {
      expect(resolveAdvisorySmokeFile(
        'test/engine/daemon-e2e-live-claude.smoke.test.ts',
        'credentialed:claude',
        {
          hasCommand: () => true,
          environment: { TEST_CLAUDE_ADVISORY_CREDENTIAL: 'token' },
        },
      )).toEqual({ outcome: 'ran' });
    });

    withDescriptorCredentialEnvVar('codex', 'TEST_CODEX_ADVISORY_CREDENTIAL', () => {
      expect(resolveAdvisorySmokeFile(
        'test/engine/daemon-e2e-live-codex.smoke.test.ts',
        'credentialed:codex',
        {
          hasCommand: () => true,
          environment: { TEST_CODEX_ADVISORY_CREDENTIAL: 'token' },
        },
      )).toEqual({ outcome: 'ran' });
    });
  });

  it('records a credential-absent gate provider leg as a named non-gating skip', () => {
    const resolution = resolveGateSmokeFile('test/example.smoke.test.ts', 'credentialed:claude', {
      hasCommand: () => true,
      environment: {},
    });

    expect(resolution).toEqual({
      outcome: 'skipped',
      provider: 'claude',
      unmet: 'CLAUDE_CODE_OAUTH_TOKEN',
    });
  });

  it('resolves each credentialed provider against its descriptor-owned gate credential variable', () => {
    withDescriptorCredentialEnvVar('claude', 'TEST_CLAUDE_GATE_CREDENTIAL', () => {
      expect(resolveGateSmokeFile(
        'test/engine/daemon-e2e-live-claude.smoke.test.ts',
        'credentialed:claude',
        {
          hasCommand: () => true,
          environment: { TEST_CLAUDE_GATE_CREDENTIAL: 'token' },
        },
      )).toEqual({ outcome: 'ran' });
    });

    withDescriptorCredentialEnvVar('codex', 'TEST_CODEX_GATE_CREDENTIAL', () => {
      expect(resolveGateSmokeFile(
        'test/engine/daemon-e2e-live-codex.smoke.test.ts',
        'credentialed:codex',
        {
          hasCommand: () => true,
          environment: { TEST_CODEX_GATE_CREDENTIAL: 'token' },
        },
      )).toEqual({ outcome: 'ran' });
    });
  });

  it('gate-enforces a credential-present provider leg and checks its toolchain', () => {
    const file = 'test/engine/daemon-e2e-live-codex.smoke.test.ts';

    expect(resolveGateSmokeFile(file, 'credentialed:codex', {
      hasCommand: () => false,
      environment: {},
    })).toEqual({
      outcome: 'skipped',
      provider: 'codex',
      unmet: 'CODEX_API_KEY',
    });

    expect(resolveGateSmokeFile(file, 'credentialed:codex', {
      hasCommand: () => false,
      environment: { CODEX_API_KEY: 'token' },
    })).toEqual({ outcome: 'failed', unmet: 'codex' });

    expect(resolveGateSmokeFile(file, 'credentialed:codex', {
      hasCommand: () => true,
      environment: { CODEX_API_KEY: 'token' },
    })).toEqual({ outcome: 'ran' });
  });

  it('fails gate mode when no credentialed case executed', () => {
    expect(() => assertGateCredentialedExecution(['hermetic', 'toolchain'])).toThrow(
      'Gate-mode smoke run executed no credentialed test files',
    );
  });

  it('evaluates the empty credentialed aggregate after resolving every credential-absent leg', async () => {
    const runVitest = vi.fn();
    const emit = vi.fn();

    await expect(runSmokeCli('vitest.smoke.config.ts', {
      discover: async () => [
        { file: 'test/engine/daemon-e2e-live-claude.smoke.test.ts', source: "const smokeCapability = 'credentialed:claude';" },
        { file: 'test/engine/daemon-e2e-live-codex.smoke.test.ts', source: "const smokeCapability = 'credentialed:codex';" },
      ],
      runVitest,
      mode: 'gate',
      hasCommand: () => true,
      environment: {},
      emit,
    })).rejects.toThrow('Gate-mode smoke run executed no credentialed test files');

    expect(runVitest).not.toHaveBeenCalled();
    expect(emit.mock.calls).toEqual([
      ['smoke ledger: test/engine/daemon-e2e-live-claude.smoke.test.ts [credentialed:claude] skipped (unmet: CLAUDE_CODE_OAUTH_TOKEN)'],
      ['smoke ledger: test/engine/daemon-e2e-live-codex.smoke.test.ts [credentialed:codex] skipped (unmet: CODEX_API_KEY)'],
    ]);
  });

  it('passes the gate aggregate when a later credentialed leg executes', async () => {
    const runVitest = vi.fn(async () => ({ executedAssertions: true, output: '' }));

    await expect(runSmokeCli('vitest.smoke.config.ts', {
      discover: async () => [
        { file: 'test/engine/daemon-e2e-live-claude.smoke.test.ts', source: "const smokeCapability = 'credentialed:claude';" },
        { file: 'test/engine/daemon-e2e-live-codex.smoke.test.ts', source: "const smokeCapability = 'credentialed:codex';" },
      ],
      runVitest,
      mode: 'gate',
      hasCommand: () => true,
      environment: { CODEX_API_KEY: 'token' },
    })).resolves.toBeUndefined();

    expect(runVitest).toHaveBeenCalledTimes(1);
    expect(runVitest).toHaveBeenCalledWith('test/engine/daemon-e2e-live-codex.smoke.test.ts');
  });

  it('reports a capability force-skip as an operator override in advisory mode', () => {
    const resolution = resolveAdvisorySmokeFile('test/example.smoke.test.ts', 'credentialed:claude', {
      hasCommand: () => true,
      environment: {
        CLAUDE_CODE_OAUTH_TOKEN: 'token',
        SMOKE_FORCE_SKIP: 'capability:credentialed:claude',
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
      'credentialed:claude',
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
    const resolution = resolveGateSmokeFile('test/example.smoke.test.ts', 'credentialed:claude', {
      hasCommand: () => true,
      environment: {
        CLAUDE_CODE_OAUTH_TOKEN: 'token',
        SMOKE_FORCE_SKIP: 'capability:credentialed:claude',
      },
    });

    expect(resolution).toEqual({
      outcome: 'failed',
      unmet: 'operator override',
    });
  });

  it('fails the gate instead of non-gating-skipping a force-skipped credentialed file', async () => {
    const runVitest = vi.fn();
    const emit = vi.fn();
    const file = 'test/engine/daemon-e2e-live-claude.smoke.test.ts';

    await expect(runSmokeCli('vitest.smoke.config.ts', {
      discover: async () => [{
        file,
        source: "const smokeCapability = 'credentialed:claude';",
      }],
      runVitest,
      mode: 'gate',
      hasCommand: () => true,
      environment: {
        CLAUDE_CODE_OAUTH_TOKEN: 'token',
        SMOKE_FORCE_SKIP: `file:${file}`,
      },
      emit,
    })).rejects.toThrow(`Smoke gate unmet for ${file}: operator override`);

    expect(runVitest).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      `smoke ledger: ${file} [credentialed:claude] failed (evidence: operator override)`,
    );
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
        capability: 'credentialed:claude',
        outcome: 'failed',
        evidencePath: 'artifacts/smoke/daemon-e2e-live.log',
      },
    ], emit);

    expect(emit.mock.calls).toEqual([
      ['smoke ledger: test/smoke/finish-record.smoke.test.ts [hermetic] ran'],
      ['smoke ledger: test/execution/codex-provider.smoke.test.ts [toolchain] skipped (unmet: codex)'],
      ['smoke ledger: test/engine/daemon-e2e-live.smoke.test.ts [credentialed:claude] failed (evidence: artifacts/smoke/daemon-e2e-live.log)'],
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
