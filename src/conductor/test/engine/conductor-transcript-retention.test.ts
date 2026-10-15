// Covers: task:12, task:18, task:rem-prd-audit-rem-vg-S6.4
import { describe, expect, it } from 'vitest';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Conductor } from '../../src/engine/conductor.js';
import { executeProviderCandidates, type ProviderExecutionContext } from '../../src/engine/provider-execution.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionScope } from '../../src/engine/provider-session.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { providerDescriptor } from '../../src/execution/provider-catalog.js';
import type { StepRunner } from '../../src/engine/step-runner-types.js';
import type { SelfHostGuardrails } from '../../src/engine/self-host/wiring.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

describe('conductor transcript retention wiring', () => {
  it('settles failed, stalled, halted, and non-build successful captures on the event spine', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conductor-transcript-retention-'));
    const events = new ConductorEventEmitter();
    new Conductor({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      events,
      stepRunner: { run: async () => ({ success: true }) },
    });
    const capture = async (step: 'build' | 'test_suite', name: string) => {
      const path = join('.pipeline', 'transcripts', step, name);
      await mkdir(join(root, path), { recursive: true });
      await writeFile(join(root, path, 'session.jsonl'), '{}\n');
      await events.emit({ type: 'provider_transcripts_captured', step, runId: 'r', attempt: 1,
        provider: 'codex', path, files: 1, bytes: 3, interrupted: false, skipped: 0, omittedLines: 0 });
      return path;
    };
    try {
      const failed = await capture('build', 'failed');
      await events.emit({ type: 'step_failed', step: 'build', error: 'failed', retryCount: 1 });
      await expect(access(join(root, failed))).resolves.toBeUndefined();

      const stalled = await capture('build', 'stalled');
      await events.emit({ type: 'build_stall', step: 'build', reason: 'no_task_progress', resolvedBefore: 7, resolvedAfter: 7 });
      await expect(access(join(root, stalled))).resolves.toBeUndefined();

      const halted = await capture('build', 'halted');
      await events.emit({ type: 'loop_halt', step: 'build', reason: 'halted' });
      await expect(access(join(root, halted))).resolves.toBeUndefined();

      const completed = await capture('test_suite', 'completed');
      await events.emit({ type: 'step_completed', step: 'test_suite', status: 'done' });
      await expect(access(join(root, completed))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('settles the failed configured-member attempt when its retry is emitted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conductor-transcript-member-retry-'));
    const events = new ConductorEventEmitter();
    const retained: string[] = [];
    events.on('provider_transcripts_retained', (event) => {
      if (event.type === 'provider_transcripts_retained') retained.push(event.path);
    });
    new Conductor({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      events,
      stepRunner: { run: async () => ({ success: true }) },
    });
    const path = join('.pipeline', 'transcripts', 'build_review', 'attempt-1');
    try {
      await mkdir(join(root, path), { recursive: true });
      await writeFile(join(root, path, 'session.jsonl'), '{}\n');
      await events.emit({
        type: 'provider_transcripts_captured', step: 'build_review', runId: 'review', attempt: 1,
        member: 'build_review', provider: 'codex', path, files: 1, bytes: 3,
        interrupted: false, skipped: 0, omittedLines: 0,
      });
      await events.emit({
        type: 'step_retry', step: 'build_review', attempt: 2, maxAttempts: 3, reason: 'retry',
        executionContext: {
          executionId: 'member-retry',
          subject: { kind: 'configured-member', parentGroup: 'ship_validation', member: 'build_review' },
        },
      });
      await expect(access(join(root, path))).resolves.toBeUndefined();
      expect(retained).toEqual([path]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('retains a failed self-host provider attempt and prunes only its successful retry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conductor-transcript-provider-retry-'));
    const events = new ConductorEventEmitter();
    const lifecycle: Array<{ type: string; path: string }> = [];
    events.on('provider_transcripts_retained', (event) => {
      if (event.type === 'provider_transcripts_retained') lifecycle.push(event);
    });
    events.on('provider_transcripts_pruned', (event) => {
      if (event.type === 'provider_transcripts_pruned') lifecycle.push(event);
    });

    let invocations = 0;
    const dispatched: string[] = [];
    const runtime = {
      key: 'codex',
      provider: {
        lifecycleCapability: { synchronousSpawnPermit: true },
        resolveSelfHostExecutable: async () => 'codex',
        prepareSelfHostAuth: async () => ({ args: [] }),
        invoke: async () => ({ success: ++invocations > 1, output: 'provider result', exitCode: invocations > 1 ? 0 : 1 }),
      },
      policy: providerDescriptor('codex').modelPolicy,
      builtIn: true,
      availability: new ModelAvailability([]),
    };
    const runtimes = new ProviderRuntimeSet([runtime] as never);
    const providerExecution: ProviderExecutionContext = {
      runtimes,
      sessions: {} as never,
      configuredProviders: ['codex'],
    };
    const runner: StepRunner = {
      run: async (step, _state, options) => {
        dispatched.push(step);
        if (step !== 'build') return { success: true };
        const result = await executeProviderCandidates({
          step,
          configuredProviders: ['codex'],
          preferredProvider: 'codex',
          runtimes,
          sessions: new ProviderSessionScope(() => 'test-session'),
          config: { llm_provider: 'codex' } as never,
          runId: 'retry-flow',
          attempt: options?.attempt,
          prepareCandidateSelfHost: providerExecution.prepareCandidateSelfHost,
          options: { prompt: 'Build.', cwd: root },
        });
        if (result.success) {
          await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify({
            tasks: [{ id: 'retry-task', status: 'completed' }],
          }));
        }
        return { success: result.success, output: result.output };
      },
    };
    const guardrails: SelfHostGuardrails = {
      resolveHarnessRoot: async () => root,
      resolveInstalledHarnessRoot: async () => ({ status: 'ok', root }),
      relink: async () => {},
      provisionSandbox: async () => { throw new Error('Codex must use provider-home isolation'); },
      provisionProviderHome: async (options) => ({
        provider: 'codex', homeDir: root, childEnv: () => ({}), childArgs: () => [],
        teardown: async () => {
          const path = join('.pipeline', 'transcripts', String(options.step), `${options.runId}-a${options.attempt}-codex`);
          await mkdir(join(root, path), { recursive: true });
          await writeFile(join(root, path, 'session.jsonl'), '{}\n');
          await events.emit({ type: 'provider_transcripts_captured', step: 'build',
            runId: options.runId ?? 'retry-flow', attempt: options.attempt ?? 1, provider: 'codex', path,
            files: 1, bytes: 3, interrupted: false, skipped: 0, omittedLines: 0 });
        },
      }),
      versionGate: async () => ({ ok: true }),
      releaseGate: async () => ({ ok: true }),
    };
    try {
      await mkdir(join(root, 'skills'));
      await mkdir(join(root, '.docs', 'plans'), { recursive: true });
      await mkdir(join(root, '.pipeline'), { recursive: true });
      await writeFile(join(root, '.docs', 'plans', 'retry.md'), '### Task 1: Retry transcript capture\n');
      await writeFile(join(root, '.pipeline', 'conduct-state.json'), JSON.stringify({
        feature_desc: 'retry-flow', complexity_tier: 'S', track: 'technical',
        bootstrap: 'done', memory: 'done', assess: 'done', explore: 'done', prd: 'skipped',
        complexity: 'done', stories: 'done', conflict_check: 'done', plan: 'done',
        coherence_check: 'done', plan_review: 'done', coverage_binding: 'done',
        architecture_diagram: 'done', architecture_review: 'done', worktree: 'done',
        acceptance_specs: 'done',
      }));
      await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify({
        tasks: [{ id: 'retry-task', status: 'pending' }],
      }));
      const conductor = new Conductor({
        projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
        featureSlug: 'retry-flow', events, stepRunner: runner, providerExecution,
        selfHostGuardrails: guardrails, daemon: true, selfHost: true, fromStep: 'build',
        mode: 'auto', verifyArtifacts: false, maxRetries: 2,
        config: { llm_provider: 'codex', harness_self_host: { sandbox_build_env: true, build_auth: { mode: 'api-key' } } } as never,
      });
      await conductor.run();

      const first = join('.pipeline', 'transcripts', 'build', 'retry-flow-a1-codex');
      const second = join('.pipeline', 'transcripts', 'build', 'retry-flow-a2-codex');
      expect({ invocations, dispatched }).toEqual({ invocations: 2, dispatched: ['build', 'build'] });
      expect(lifecycle).toEqual([
        { type: 'provider_transcripts_retained', path: first },
        { type: 'provider_transcripts_pruned', path: second },
      ]);
      await expect(access(join(root, first))).resolves.toBeUndefined();
      await expect(access(join(root, second))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
