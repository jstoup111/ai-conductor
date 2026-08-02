/**
 * RED acceptance specs for first-class Codex harness parity (#904).
 *
 * Covers: FR-9, FR-10, FR-13
 *
 * These scenarios drive DefaultStepRunner, the production lifecycle-dispatch
 * entry point. Provider doubles replace only the external CLI processes. They
 * deliberately do not call a future invocation renderer directly: the specs
 * must fail while the live runner still sends Claude slash syntax to Codex.
 *
 * Candidate-local derivation call sites exercised here:
 * - step-runners.ts:runProviderAwareNormal
 * - step-runners.ts:executeProviderAwareOneShot (remediation)
 * - provider-execution.ts:executeProviderCandidates (both fallback directions)
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkStepCompletion } from '../../src/engine/artifacts.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import {
  CLAUDE_MODEL_POLICY,
  CODEX_MODEL_POLICY,
} from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { Conductor } from '../../src/engine/conductor.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type {
  InvokeOptions,
  InvokeResult,
  LLMProvider,
} from '../../src/execution/llm-provider.js';
import type { ConductState } from '../../src/types/index.js';

const state: ConductState = { complexity_tier: 'M' };
const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function successful(output = 'done'): InvokeResult {
  return { success: true, output, exitCode: 0 };
}

function unavailable(reason: string): InvokeResult {
  return {
    success: false,
    output: reason,
    exitCode: 127,
    providerUnavailable: true,
    providerUnavailableReason: reason,
    providerUnavailableScope: 'run',
  };
}

function provider(
  responder: (options: InvokeOptions, call: number) => InvokeResult = () =>
    successful(),
) {
  const calls: InvokeOptions[] = [];
  const invoke = vi.fn(async (options: InvokeOptions) => {
    const permit = options.spawnPermit?.();
    if (permit && !permit.permitted) {
      return { success: false, output: `test provider spawn denied: ${permit.reason}`, exitCode: 1 };
    }
    calls.push(options);
    return responder(options, calls.length);
  });
  const llmProvider: LLMProvider = {
    lifecycleCapability: { synchronousSpawnPermit: true },
    invoke,
    invokeInteractive: vi.fn(async () => undefined),
  };
  return { provider: llmProvider, calls };
}

function runtimes(
  claude: LLMProvider,
  codex: LLMProvider,
): ProviderRuntimeSet {
  return new ProviderRuntimeSet([
    {
      key: 'claude',
      provider: claude,
      policy: CLAUDE_MODEL_POLICY,
      builtIn: true,
      availability: new ModelAvailability(
        CLAUDE_MODEL_POLICY.modelFallbackLadder,
      ),
    },
    {
      key: 'codex',
      provider: codex,
      policy: CODEX_MODEL_POLICY,
      builtIn: true,
      availability: new ModelAvailability(
        CODEX_MODEL_POLICY.modelFallbackLadder,
      ),
    },
  ]);
}

function runnerFor(
  configuredProviders: readonly string[],
  claude: LLMProvider,
  codex: LLMProvider,
  projectRoot = process.cwd(),
) {
  const sessions = new ProviderSessionStore({
    createSessionId: () => `session-${crypto.randomUUID()}`,
  });
  const captured = provider();
  const runner = new DefaultStepRunner(
    captured.provider,
    'captured-session',
    projectRoot,
    {
      mode: 'auto',
      configuredProviders,
      providerRuntimes: runtimes(claude, codex),
      sessionStore: sessions,
      config: { llm_provider: [...configuredProviders] },
    },
  );
  return { runner, sessions, captured };
}

describe('ST-904-9/ST-904-10 — daemon-selected Codex lifecycle dispatch', () => {
  it('advances two consecutive lifecycle operations using Codex-native skill mentions', async () => {
    const claude = provider();
    const codex = provider();
    const { runner, sessions, captured } = runnerFor(
      ['codex', 'claude'],
      claude.provider,
      codex.provider,
    );

    await sessions.beginStep('acceptance_specs');
    const acceptanceSpecs = await runner.run('acceptance_specs', state);
    await sessions.beginStep('build');
    const build = await runner.run('build', state);

    expect(acceptanceSpecs.success).toBe(true);
    expect(build.success).toBe(true);
    expect(codex.calls.map(({ prompt }) => prompt)).toEqual([
      '$writing-system-tests',
      '$pipeline',
    ]);
    expect(claude.calls).toEqual([]);
    expect(captured.calls).toEqual([]);
  });

  it('advances from Codex acceptance specs to build only after RED evidence satisfies the gate', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codex-parity-progression-'));
    temporaryDirectories.push(directory);
    const pipelineDirectory = join(directory, '.pipeline');
    const stateFilePath = join(pipelineDirectory, 'conduct-state.json');
    const targetSpec = 'test/acceptance/feature.acceptance.test.ts';
    await mkdir(pipelineDirectory, { recursive: true });
    await mkdir(join(directory, 'test/acceptance'), { recursive: true });
    await writeFile(join(directory, targetSpec), 'acceptance spec', 'utf8');

    const seededState: Record<string, unknown> = {};
    for (const step of ALL_STEPS) {
      if (step.name === 'acceptance_specs') break;
      seededState[step.name] = 'done';
    }
    seededState.complexity_tier = 'M';
    seededState.feature_desc = 'codex-gate-progression-fixture';
    seededState.track = 'technical';
    await writeState(
      stateFilePath,
      seededState as unknown as ConductState,
    );

    const claude = provider();
    const codex = provider(({ prompt }) =>
      prompt === '$pipeline'
        ? {
            success: false,
            output: 'bounded build failure',
            exitCode: 1,
          }
        : successful(),
    );
    const { runner, captured } = runnerFor(
      ['codex', 'claude'],
      claude.provider,
      codex.provider,
      directory,
    );
    const makeConductor = (resume = false) =>
      new Conductor({
        stateFilePath,
        stepRunner: runner,
        events: new ConductorEventEmitter(),
        projectRoot: directory,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 1,
        ...(resume ? { resume: true } : { fromStep: 'acceptance_specs' }),
      });

    await makeConductor().run();
    const stateBeforeEvidence = await readState(stateFilePath);
    const promptsBeforeEvidence = codex.calls.map(({ prompt }) => prompt);
    codex.calls.length = 0;
    claude.calls.length = 0;
    captured.calls.length = 0;

    const command = `npm test -- --run ${targetSpec}`;
    await writeFile(
      join(pipelineDirectory, 'acceptance-specs-red.json'),
      JSON.stringify({
        command,
        targetSpecs: [targetSpec],
        executed: 1,
        passed: 0,
        failed: 1,
        skipped: 0,
        errors: 0,
        summary: '1 failed',
      }),
      'utf8',
    );

    await makeConductor(true).run();
    const stateAfterEvidence = await readState(stateFilePath);

    expect({
      acceptanceBeforeEvidence: stateBeforeEvidence.ok
        ? stateBeforeEvidence.value.acceptance_specs
        : 'state-read-failed',
      promptsBeforeEvidence,
      acceptanceAfterEvidence: stateAfterEvidence.ok
        ? stateAfterEvidence.value.acceptance_specs
        : 'state-read-failed',
      promptsAfterEvidence: codex.calls.map(({ prompt }) => prompt),
      claudeCalls: claude.calls,
      capturedCalls: captured.calls,
    }).toEqual({
      acceptanceBeforeEvidence: 'failed',
      promptsBeforeEvidence: ['$writing-system-tests'],
      acceptanceAfterEvidence: 'done',
      promptsAfterEvidence: ['$writing-system-tests', '$pipeline'],
      claudeCalls: [],
      capturedCalls: [],
    });
  });

  it.each([
    {
      name: 'Codex to Claude',
      configured: ['codex', 'claude'],
      claudeFirst: false,
      expectedClaude: '/writing-system-tests',
      expectedCodex: '$writing-system-tests',
    },
    {
      name: 'Claude to Codex',
      configured: ['claude', 'codex'],
      claudeFirst: true,
      expectedClaude: '/writing-system-tests',
      expectedCodex: '$writing-system-tests',
    },
  ])(
    're-resolves the explicit skill mention for $name fallback',
    async ({ configured, claudeFirst, expectedClaude, expectedCodex }) => {
      const claude = provider((_options, call) =>
        claudeFirst && call === 1
          ? unavailable('Claude unavailable for acceptance fixture')
          : successful(),
      );
      const codex = provider((_options, call) =>
        !claudeFirst && call === 1
          ? unavailable('Codex unavailable for acceptance fixture')
          : successful(),
      );
      const { runner, sessions } = runnerFor(
        configured,
        claude.provider,
        codex.provider,
      );

      await sessions.beginStep('acceptance_specs');
      const result = await runner.run('acceptance_specs', state);

      expect(result.success).toBe(true);
      expect(claude.calls[0]?.prompt).toBe(expectedClaude);
      expect(codex.calls[0]?.prompt).toBe(expectedCodex);
    },
  );

  it('uses Codex-native syntax for a skill-driven one-shot branch', async () => {
    const claude = provider();
    const codex = provider();
    const { runner, sessions } = runnerFor(
      ['codex', 'claude'],
      claude.provider,
      codex.provider,
    );

    await sessions.beginStep('remediate');
    const result = await runner.run('remediate', state);

    expect(result.success).toBe(true);
    expect(codex.calls[0]?.prompt).toBe('$remediate');
  });
});

describe('ST-904-10/ST-904-13 — unchanged gate and Claude contracts', () => {
  it('keeps a lifecycle step incomplete when its artifact evidence is absent', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codex-parity-gate-'));
    temporaryDirectories.push(directory);
    const specPath = join(
      directory,
      'test/acceptance/feature.acceptance.test.ts',
    );
    await mkdir(join(specPath, '..'), { recursive: true });
    await writeFile(specPath, 'acceptance spec', 'utf8');

    const completion = await checkStepCompletion(
      directory,
      'acceptance_specs',
    );

    expect(completion.done).toBe(false);
    expect(completion.reason).toMatch(/acceptance-specs-red\.json/);
  });

  it('preserves Claude slash invocation when Claude is the actual candidate', async () => {
    const claude = provider();
    const codex = provider();
    const { runner, sessions } = runnerFor(
      ['claude', 'codex'],
      claude.provider,
      codex.provider,
    );

    await sessions.beginStep('acceptance_specs');
    const result = await runner.run('acceptance_specs', state);

    expect(result.success).toBe(true);
    expect(claude.calls[0]?.prompt).toBe('/writing-system-tests');
    expect(codex.calls).toEqual([]);
  });
});
