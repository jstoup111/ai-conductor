import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, unlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ConductState, StepName } from '../../src/types/index.js';
import { Conductor } from '../test-conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import { createProductionFinishPublicationCoordinator } from '../../src/engine/finish-publication-production.js';
import { routeFinishPublicationDisposition } from '../../src/engine/finish-publication.js';
import type { FullSuitePassEvidence } from '../../src/engine/full-suite-evidence.js';
import { readAllVerdicts, writeVerdict } from '../../src/engine/gate-verdicts.js';

vi.mock('../../src/engine/project-prelude.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/engine/project-prelude.js')>()),
  currentCommitSha: vi.fn(async () => null),
}));

const ROUTED_SENTINEL = new Error('stop after first FINISH publication route');

const PASS_EVIDENCE: FullSuitePassEvidence = {
  version: 3,
  outcome: 'PASS',
  reason: 'exit_zero',
  fingerprint: 'sha256:current-test-inputs',
  categoryFingerprints: {
    additional_inputs: 'sha256:additional-inputs',
    dependencies: 'sha256:dependencies',
    environment: 'sha256:environment',
    migrations: 'sha256:migrations',
    project_config: 'sha256:project-config',
    source: 'sha256:source',
    test_infrastructure: 'sha256:test-infrastructure',
    tests: 'sha256:tests',
  },
  provenanceHeadSha: '0123456789abcdef',
  command: 'npm test',
  workingDirectory: 'src/conductor',
  startedAt: '2026-08-15T00:00:00.000Z',
  endedAt: '2026-08-15T00:00:01.000Z',
  durationMs: 1_000,
  exitCode: 0,
  stdout: 'all tests passed\\n',
  stderr: '',
};

describe('Conductor FINISH publication routing', () => {
  let dir: string;
  let statePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-finish-publication-'));
    statePath = join(dir, 'conduct-state.json');
    const state: Record<string, unknown> = {
      complexity_tier: 'S',
      track: 'technical',
      feature_desc: 'finish-publication',
    };
    for (const step of [
      'bootstrap', 'memory', 'assess', 'explore', 'prd', 'complexity', 'stories',
      'conflict_check', 'plan', 'coherence_check', 'architecture_diagram',
      'architecture_review', 'worktree', 'acceptance_specs', 'build', 'build_review',
      'wiring_check', 'test_suite', 'manual_test', 'prd_audit',
      'architecture_review_as_built', 'retro', 'rebase',
    ] satisfies StepName[]) {
      state[step] = 'done';
    }
    await writeState(statePath, state as ConductState);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it.each([
    { name: 'interactive', mode: 'interactive' as const, daemon: false },
    { name: 'default foreground', mode: 'default' as const, daemon: false },
    { name: 'foreground auto', mode: 'auto' as const, daemon: false },
    // Daemon mode is deliberately covered here: even in mocked-dispatch mode,
    // wiring a coordinator must not reinstate a coordinator-only fence
    // exemption.
    { name: 'daemon auto with coordinator', mode: 'auto' as const, daemon: true },
  ])('starts at FINISH and lets the coordinator bound %s judgment dispatches', async ({ mode, daemon }) => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline', 'manual-test-results.md'),
      '# Manual Test Results\n\n## Attempt 1 — 2026-08-16T00:00:00Z\n\n| Story | Result |\n|---|---|\n| Story 1 | PASS |\n',
    );
    // The daemon row reaches the real fence.  These are the minimal fresh
    // SHIP reports it recomputes before allowing the injected coordinator.
    await writeFile(
      join(dir, '.pipeline', 'prd-audit.md'),
      '| FR | Verdict | Gap-class | Evidence | Accepted? |\n|----|----|----|----|----|\n| FR-1 | ALIGNED | n/a | test.ts:1 | — |\n',
    );
    await writeFile(
      join(dir, '.pipeline', 'architecture-review-as-built.md'),
      '# As-Built Review\n\nVerdict: APPROVED\n',
    );
    if (daemon) {
      const persisted = await readState(statePath);
      if (!persisted.ok) throw new Error('test fixture state must be readable');
      await writeState(statePath, {
        ...persisted.value,
        complexity_tier: 'M',
        architecture_review: 'skipped',
      });
    }
    const calls: StepName[] = [];
    const dispositions: string[] = [];
    const events = new ConductorEventEmitter();
    events.on('finish_publication_disposition', (event) => {
      if (event.type === 'finish_publication_disposition') dispositions.push(event.disposition);
    });
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        calls.push(step);
        return { success: true };
      }),
    };
    const coordinator = {
      advance: vi.fn(async ({ dispatchJudgment }) => {
        if (mode !== 'default') await dispatchJudgment({
          kind: 'finish_pr_prose_quality',
          pullRequestUrl: 'https://example.test/pr/17',
          qualityScope: ['title', 'body'],
          maximumPasses: 1,
        });
        return { kind: 'complete' } as const;
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      finishPublication: coordinator,
      events,
      projectRoot: dir,
      fromStep: 'finish',
      mode,
      daemon,
      ...(daemon ? { config: { steps: { manual_test: { disable: true } } } } : {}),
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
    });

    await conductor.run();

    expect(coordinator.advance).toHaveBeenCalledOnce();
    expect(calls).toEqual(mode === 'default' ? [] : ['finish']);
    expect(dispositions).toEqual(['complete']);
    await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('keeps the FINISH fence disabled for a non-daemon mocked dispatch even with non-green evidence', async () => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline', 'manual-test-results.md'),
      '# Manual Test Results\n\n| Story | Result |\n|---|---|\n| Story 1 | FAIL |\n',
    );
    const events = new ConductorEventEmitter();
    const kickbacks: Array<{ from: StepName; to: StepName }> = [];
    events.on('kickback', (event) => {
      if (event.type === 'kickback') kickbacks.push({ from: event.from, to: event.to });
    });
    const advance = vi.fn(async () => ({ kind: 'complete' } as const));

    await new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      finishPublication: { advance },
      events,
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'default',
      daemon: false,
      verifyArtifacts: false,
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
    }).run();

    expect(advance).toHaveBeenCalledOnce();
    expect(kickbacks).toEqual([]);
  });

  it('keeps a done manual_test with FAIL rows non-green before the coordinator can publish', async () => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline', 'manual-test-results.md'),
      '# Manual Test Results\n\n## Attempt 1\n\n| Story | Result |\n|---|---|\n| Story 1 | FAIL |\n',
    );
    const persisted = await readState(statePath);
    if (!persisted.ok) throw new Error('test fixture state must be readable');
    await writeState(statePath, {
      ...persisted.value,
      complexity_tier: 'M',
      architecture_review: 'skipped',
      manual_test: 'stale',
    });
    const events = new ConductorEventEmitter();
    const kickbacks: Array<{ from: StepName; to: StepName }> = [];
    events.on('kickback', (event) => {
      if (event.type === 'kickback') kickbacks.push({ from: event.from, to: event.to });
    });
    const advance = vi.fn(async () => ({ kind: 'complete' } as const));
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        if (step === 'manual_test') throw ROUTED_SENTINEL;
        return { success: true };
      }),
    };

    await new Conductor({
      stateFilePath: statePath, stepRunner: runner, finishPublication: { advance }, events,
      projectRoot: dir, fromStep: 'finish', mode: 'auto', daemon: true, verifyArtifacts: false,
      git: async () => ({ stdout: '' }), gh: async () => ({ stdout: '' }), runGh: async () => ({ stdout: '' }),
    }).run();

    expect(advance).not.toHaveBeenCalled();
    expect(runner.run).toHaveBeenCalledWith('manual_test', expect.anything(), expect.anything());
    expect(kickbacks).toEqual([{ from: 'finish', to: 'manual_test' }]);
  });

  it('redirects several non-green validators to the earliest one without demoting a green sibling', async () => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline', 'manual-test-results.md'),
      '# Manual Test Results\n\n## Attempt 1\n\n| Story | Result |\n|---|---|\n| Story 1 | PASS |\n',
    );
    const persisted = await readState(statePath);
    if (!persisted.ok) throw new Error('test fixture state must be readable');
    await writeState(statePath, {
      ...persisted.value,
      complexity_tier: 'M', track: 'product', architecture_review: 'done',
      manual_test: 'stale', prd_audit: 'stale', architecture_review_as_built: 'done',
    });
    const architectureEvidence = join(dir, '.pipeline', 'architecture-review-as-built.md');
    await writeFile(architectureEvidence, '# As-Built Review\n\nVerdict: APPROVED\n');
    const freshMtime = new Date(Date.now() + 5_000);
    await utimes(architectureEvidence, freshMtime, freshMtime);
    await writeVerdict(dir, 'architecture_review_as_built', { satisfied: true, checkedAt: 1 });
    const events = new ConductorEventEmitter();
    const kickbacks: Array<{ from: StepName; to: StepName }> = [];
    events.on('kickback', (event) => {
      if (event.type === 'kickback') kickbacks.push({ from: event.from, to: event.to });
    });
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        if (step === 'prd_audit') throw ROUTED_SENTINEL;
        return { success: true };
      }),
    };

    await new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      finishPublication: { advance: vi.fn(async () => ({ kind: 'complete' } as const)) },
      events,
      projectRoot: dir, fromStep: 'finish', mode: 'auto', daemon: true, verifyArtifacts: false,
      git: async () => ({ stdout: '' }), gh: async () => ({ stdout: '' }), runGh: async () => ({ stdout: '' }),
    }).run();

    const after = await readState(statePath);
    const verdicts = await readAllVerdicts(dir);
    expect(kickbacks).toEqual([{ from: 'finish', to: 'manual_test' }]);
    expect(runner.run).toHaveBeenCalledWith('manual_test', expect.anything(), expect.anything());
    expect(after.ok && after.value.architecture_review_as_built).toBe('done');
    expect(verdicts.architecture_review_as_built).toMatchObject({ satisfied: true });
    await expect(readFile(join(dir, '.pipeline', 'architecture-review-as-built.md'), 'utf8')).resolves.toContain('APPROVED');
  });

  it('preserves green validator evidence across repeated docs-only FINISH laps without rerunning test_suite', async () => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline', 'manual-test-results.md'),
      '# Manual Test Results\n\n## Attempt 1 — 2026-08-16T00:00:00Z\n\n| Story | Result |\n|---|---|\n| Story 1 | PASS |\n',
    );
    const persisted = await readState(statePath);
    if (!persisted.ok) throw new Error('test fixture state must be readable');
    await writeFile(
      join(dir, '.pipeline', 'prd-audit.md'),
      '| FR | Verdict | Gap-class | Evidence | Accepted? |\n|----|----|----|----|----|\n| FR-1 | ALIGNED | n/a | test.ts:1 | — |\n',
    );
    await writeFile(join(dir, '.pipeline', 'architecture-review-as-built.md'), '# As-Built Review\n\nVerdict: APPROVED\n');
    await writeState(statePath, {
      ...persisted.value,
      complexity_tier: 'M',
      track: 'technical',
      architecture_review: 'skipped',
      manual_test: 'done',
      prd_audit: 'done',
      architecture_review_as_built: 'done',
    });
    for (const step of ['manual_test', 'prd_audit', 'architecture_review_as_built'] as const) {
      await writeVerdict(dir, step, { satisfied: true, checkedAt: Date.now() });
    }
    const ensure = vi.fn(async () => ({ status: 'REUSED' as const, evidence: PASS_EVIDENCE }));
    const inspect = vi.fn(async () => ({ status: 'CURRENT' as const, evidence: PASS_EVIDENCE }));
    const kickbacks: Array<{ from: StepName; to: StepName }> = [];
    const events = new ConductorEventEmitter();
    events.on('kickback', (event) => {
      if (event.type === 'kickback') kickbacks.push({ from: event.from, to: event.to });
    });
    let finishRuns = 0;
    const runnerRun = vi.fn(async (step: StepName) => {
      if (step === 'manual_test') {
        await writeFile(
          join(dir, '.pipeline', 'manual-test-results.md'),
          '# Manual Test Results\n\n## Attempt 2 — 2026-08-16T00:00:00Z\n\n| Story | Result |\n|---|---|\n| Story 1 | PASS |\n',
        );
        return { success: true };
      }
      if (step === 'finish') {
        finishRuns++;
        return finishRuns === 1
          ? { success: false, publicationDisposition: { kind: 'publication_progress', transition: 'ready_pr' } }
          : { success: true, publicationDisposition: { kind: 'complete' } };
      }
      return { success: true };
    });
    const runner: StepRunner = {
      run: runnerRun,
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'default',
      daemon: true,
      fullSuiteVerifier: { ensure, inspect },
      git: async () => ({ stdout: '' }), gh: async () => ({ stdout: '' }), runGh: async () => ({ stdout: '' }),
    });

    await conductor.run();

    const verdicts = await readAllVerdicts(dir);
    const after = await readState(statePath);
    expect(runnerRun.mock.calls.map(([step]) => step)).toEqual(['manual_test', 'finish', 'finish']);
    expect(ensure).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
    expect(after.ok && [after.value.manual_test, after.value.prd_audit, after.value.architecture_review_as_built]).toEqual(['done', 'done', 'done']);
    for (const step of ['manual_test', 'prd_audit', 'architecture_review_as_built'] as const) {
      expect(verdicts[step]).toMatchObject({ satisfied: true });
    }
    expect(kickbacks).toEqual([{ from: 'finish', to: 'manual_test' }]);
    await expect(readFile(join(dir, '.pipeline', 'manual-test-results.md'), 'utf8')).resolves.toContain('PASS');
  });

  it('treats malformed validator evidence as non-green without deleting prior evidence', async () => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    const evidencePath = join(dir, '.pipeline', 'manual-test-results.md');
    await writeFile(evidencePath, '# Manual Test Results\n\n| Story | Result |\n|---|---|\n| Story 1 | MAYBE |\n');
    const persisted = await readState(statePath);
    if (!persisted.ok) throw new Error('test fixture state must be readable');
    await writeState(statePath, {
      ...persisted.value,
      complexity_tier: 'M', architecture_review: 'skipped', manual_test: 'done',
    });
    const events = new ConductorEventEmitter();
    const kickbacks: Array<{ from: StepName; to: StepName }> = [];
    events.on('kickback', (event) => {
      if (event.type === 'kickback') kickbacks.push({ from: event.from, to: event.to });
    });
    const advance = vi.fn(async () => ({ kind: 'complete' } as const));
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        if (step === 'manual_test') throw ROUTED_SENTINEL;
        return { success: true };
      }),
    };

    await new Conductor({
      stateFilePath: statePath, stepRunner: runner, finishPublication: { advance }, events,
      projectRoot: dir, fromStep: 'finish', mode: 'auto', daemon: true, verifyArtifacts: false,
      git: async () => ({ stdout: '' }), gh: async () => ({ stdout: '' }), runGh: async () => ({ stdout: '' }),
    }).run();

    expect(advance).not.toHaveBeenCalled();
    expect(kickbacks).toEqual([{ from: 'finish', to: 'manual_test' }]);
    const verdict = await readAllVerdicts(dir);
    expect(verdict.manual_test).toMatchObject({ satisfied: false });
  });

  it('retries a publication-only result at FINISH without dispatching BUILD or remediation', async () => {
    const calls: Array<{ step: StepName; retryReason?: string }> = [];
    const dispositions: string[] = [];
    const events = new ConductorEventEmitter();
    events.on('finish_publication_disposition', (event) => {
      if (event.type === 'finish_publication_disposition') dispositions.push(event.disposition);
    });
    const runner: StepRunner = {
      run: vi.fn(async (step, _state, options) => {
        calls.push({ step, retryReason: options?.retryReason });
        if (calls.length > 1) throw ROUTED_SENTINEL;
        return {
          success: false,
          publicationDisposition: {
            kind: 'publication_retry',
            transition: 'ready_pr',
            reason: 'presentation_repair_failed',
          },
        };
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'auto',
      maxRetries: 2,
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
      escalateBuildFailure: vi.fn(async () => ({})),
    });

    await conductor.run();

    expect(calls.map(({ step }) => step)).toEqual(['finish', 'finish']);
    expect(calls.map(({ step }) => step)).not.toContain('build');
    expect(calls.map(({ step }) => step)).not.toContain('remediate');
    expect(dispositions).toEqual(['retry_finish']);
    expect(calls[1]?.retryReason).toContain('Retry only the incomplete publication transition.');
    expect(calls[1]?.retryReason).toContain('presentation_repair_failed');
    await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).resolves.toContain(
      ROUTED_SENTINEL.message,
    );
  });

  it('re-enters FINISH after verified publication progress without charging a retry', async () => {
    const stepRetries: StepName[] = [];
    const events = new ConductorEventEmitter();
    events.on('step_retry', (event) => {
      if (event.type === 'step_retry') stepRetries.push(event.step);
    });
    const advance = vi.fn()
      .mockResolvedValueOnce({ kind: 'publication_progress', transition: 'ready_pr' } as const)
      .mockResolvedValueOnce({ kind: 'complete' } as const);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      finishPublication: { advance },
      events,
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'default',
      maxRetries: 1,
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
    });

    await conductor.run();

    const state = await readState(statePath);
    expect({
      finish: state.ok ? state.value.finish : undefined,
      publicationAdvances: advance.mock.calls.length,
      stepRetries,
    }).toEqual({ finish: 'done', publicationAdvances: 2, stepRetries: [] });
  });

  it('keeps the full retry allowance after five publication advances', async () => {
    const stepRetries: StepName[] = [];
    const events = new ConductorEventEmitter();
    events.on('step_retry', (event) => {
      if (event.type === 'step_retry') stepRetries.push(event.step);
    });
    const advance = vi.fn()
      .mockResolvedValueOnce({ kind: 'publication_progress', transition: 'establish_pr' } as const)
      .mockResolvedValueOnce({ kind: 'publication_progress', transition: 'write_shipped_record' } as const)
      .mockResolvedValueOnce({ kind: 'publication_progress', transition: 'judge_pr_prose' } as const)
      .mockResolvedValueOnce({ kind: 'publication_progress', transition: 'ready_pr' } as const)
      .mockResolvedValueOnce({ kind: 'publication_progress', transition: 'record_outcome' } as const)
      .mockResolvedValueOnce({ kind: 'complete' } as const);
    const progressConductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      finishPublication: { advance },
      events,
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'default',
      maxRetries: 3,
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
    });

    await progressConductor.run();

    expect(advance).toHaveBeenCalledTimes(6);
    // Task 4's progress route must remain silent; this test's five advances
    // must not be indistinguishable from charged retry events.
    expect(stepRetries).toEqual([]);

    const retryCalls: StepName[] = [];
    const retryConductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: {
        run: vi.fn(async (step) => {
          retryCalls.push(step);
          return {
            success: false,
            publicationDisposition: {
              kind: 'publication_retry',
              transition: 'ready_pr',
              reason: 'presentation_repair_failed',
            },
          };
        }),
      },
      events,
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'auto',
      maxRetries: 3,
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
      escalateBuildFailure: vi.fn(async () => ({})),
    });

    await retryConductor.run();

    expect(retryCalls).toEqual(['finish', 'finish', 'finish']);
    expect(stepRetries).toEqual(['finish', 'finish']);
    await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).resolves.toContain(
      'FINISH publication retry exhausted: presentation_repair_failed',
    );
  });

  it.each([
    {
      name: 'repeated ready_pr progress',
      transitions: ['ready_pr'] as const,
      lastTransition: 'ready_pr',
    },
    {
      name: 'alternating publication progress',
      transitions: ['establish_pr', 'ready_pr'] as const,
      lastTransition: 'ready_pr',
    },
  ])('halts %s at the fourteen-transition allowance', async ({ transitions, lastTransition }) => {
    const advance = vi.fn(async () => {
      // The sentinel bounds the pre-fix infinite loop. A correct implementation
      // halts after the fourteenth verified transition and never reaches it
      // (two passes over each of the seven publication transitions).
      if (advance.mock.calls.length > 14) throw ROUTED_SENTINEL;
      return {
        kind: 'publication_progress',
        transition: transitions[(advance.mock.calls.length - 1) % transitions.length],
      } as const;
    });
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      finishPublication: { advance },
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'default',
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
    });

    await conductor.run();

    expect({
      publicationAdvances: advance.mock.calls.length,
      halt: await readFile(join(dir, '.pipeline/HALT'), 'utf8').catch(() => ''),
      haltClass: await readFile(join(dir, '.pipeline/HALT.class'), 'utf8').catch(() => ''),
    }).toEqual({
      publicationAdvances: 14,
      halt: expect.stringContaining(lastTransition),
      haltClass: 'needs-human',
    });
  });

  it('halts on the FIRST attempt for a non-retryable publication reason, without spending the budget', async () => {
    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        calls.push(step);
        return {
          success: false,
          publicationDisposition: {
            kind: 'publication_retry',
            transition: 'establish_pr',
            // The remote carries work this checkout never observed. Re-running
            // the identical transition pushes the identical lease against the
            // identical remote-tracking ref, so every further attempt is
            // guaranteed to reach this same halt ~9s later.
            reason: 'draft_pr_lease-rejected',
          },
        };
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'auto',
      maxRetries: 6,
      events: new ConductorEventEmitter(),
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
      escalateBuildFailure: vi.fn(async () => ({})),
    });

    await conductor.run();

    expect(calls).toEqual(['finish']);
    const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf8');
    expect(halt).toContain('draft_pr_lease-rejected');
    expect(halt).toContain('not retryable');
    // Distinguishable from the exhausted-budget halt: the operator must not be
    // left wondering whether six attempts were spent.
    expect(halt).not.toContain('retry exhausted');
  });

  it('still spends the full retry budget for a transient publication reason', async () => {
    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        calls.push(step);
        return {
          success: false,
          publicationDisposition: {
            kind: 'publication_retry',
            transition: 'ready_pr',
            // A GitHub call that failed once can succeed on the next attempt.
            reason: 'presentation_repair_failed',
          },
        };
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'auto',
      maxRetries: 3,
      events: new ConductorEventEmitter(),
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
      escalateBuildFailure: vi.fn(async () => ({})),
    });

    await conductor.run();

    expect(calls).toEqual(['finish', 'finish', 'finish']);
    await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).resolves.toContain(
      'FINISH publication retry exhausted: presentation_repair_failed',
    );
  });

  it('routes a production accepted judgment through FINISH progress without a needs-human HALT', async () => {
    const pipeline = join(dir, '.pipeline');
    const productionStatePath = join(pipeline, 'conduct-state.json');
    const prUrl = 'https://example.test/pr/17';
    let pullRequest = {
      url: prUrl,
      title: 'feat: draft publication',
      body: '<!-- conductor:pr-body-floor -->\n\nDraft opened automatically.',
      isDraft: true,
    };
    await mkdir(pipeline);
    await mkdir(join(dir, '.docs', 'shipped'), { recursive: true });
    await writeFile(join(dir, '.docs', 'shipped', 'finish-publication.md'), 'shipped\n');
    const state: Record<string, unknown> = {
      complexity_tier: 'S',
      // This focused coordinator fixture has no product or architecture
      // evidence. Declare its real SHIP membership instead of leaving the
      // daemon fence to redispatch absent validators forever.
      track: 'technical',
      feature_desc: 'finish-publication',
      worktree_branch: 'feat/finish-publication',
      pr_url: prUrl,
    };
    for (const step of [
      'bootstrap', 'memory', 'assess', 'explore', 'prd', 'complexity', 'stories',
      'conflict_check', 'plan', 'coherence_check', 'architecture_diagram',
      'worktree', 'acceptance_specs', 'build', 'build_review',
      'wiring_check', 'test_suite', 'manual_test', 'prd_audit',
      'architecture_review_as_built', 'retro', 'rebase',
    ] satisfies StepName[]) state[step] = 'done';
    // A technical feature with no approved architecture decision has no
    // as-built review to run; its downstream validator is skipped by the
    // ordinary upstream-skip rule.
    state.architecture_review = 'skipped';
    await writeState(productionStatePath, state as ConductState);
    const runner: StepRunner = {
      run: vi.fn(async () => {
        pullRequest = {
          ...pullRequest,
          title: 'feat: publish coherent finish',
          body: 'Reader-facing summary of the completed change.',
        };
        return { success: true, publicationDisposition: { kind: 'accepted' } };
      }),
    };
    const events = new ConductorEventEmitter();
    const dispositions: string[] = [];
    events.on('finish_publication_disposition', (event) => {
      if (event.type === 'finish_publication_disposition') dispositions.push(event.disposition);
    });
    const coordinator = createProductionFinishPublicationCoordinator({
      projectRoot: dir,
      stateFilePath: productionStatePath,
      baseBranch: 'main',
      git: async (args) => args[0] === 'rev-parse'
        ? { stdout: 'refs/remotes/origin/feat/finish-publication\n' }
        : { stdout: '' },
      gh: async (args) => {
        if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify(pullRequest) };
        if (args[0] === 'pr' && args[1] === 'ready') {
          pullRequest.isDraft = false;
          return { stdout: '' };
        }
        throw new Error(`unexpected gh command: ${args.join(' ')}`);
      },
      observeReleaseReadiness: async () => 'present',
      recordFinish: async () => {
        await writeFile(join(pipeline, 'finish-choice'), 'pr\n');
        return 0;
      },
    });
    const conductor = new Conductor({
      stateFilePath: productionStatePath, stepRunner: runner, finishPublication: coordinator,
      events, projectRoot: dir, fromStep: 'finish', mode: 'auto', daemon: true,
      verifyArtifacts: false,
      git: async () => ({ stdout: '' }), gh: async () => ({ stdout: '' }), runGh: async () => ({ stdout: '' }),
    });

    await conductor.run();

    expect(runner.run).toHaveBeenCalledOnce();
    expect(dispositions).not.toContain('retry_finish');
    expect(dispositions).not.toContain('human_required');
    await expect(readFile(join(pipeline, 'HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  // Regression: a technical-track feature resolves manual_test and prd_audit by
  // SKIPPING them — there is no UI to test and no PRD to audit. The production
  // evidence observers compared those statuses to 'done' alone, so a skip read
  // as missing evidence, preflight raised `ship_evidence_invalid`, and the
  // router halted needs-human on a feature whose work was entirely green.
  it('treats a skipped SHIP step as resolved evidence rather than a missing-evidence HALT', async () => {
    const pipeline = join(dir, '.pipeline');
    const productionStatePath = join(pipeline, 'conduct-state.json');
    const prUrl = 'https://example.test/pr/18';
    let pullRequest = {
      url: prUrl,
      title: 'feat: draft publication',
      body: '<!-- conductor:pr-body-floor -->\n\nDraft opened automatically.',
      isDraft: true,
    };
    await mkdir(pipeline);
    await mkdir(join(dir, '.docs', 'shipped'), { recursive: true });
    await writeFile(join(dir, '.docs', 'shipped', 'finish-publication.md'), 'shipped\n');
    const state: Record<string, unknown> = {
      complexity_tier: 'M',
      track: 'technical',
      feature_desc: 'finish-publication',
      worktree_branch: 'feat/finish-publication',
      pr_url: prUrl,
    };
    for (const step of [
      'bootstrap', 'memory', 'assess', 'explore', 'prd', 'complexity', 'stories',
      'conflict_check', 'plan', 'coherence_check', 'architecture_diagram',
      'worktree', 'acceptance_specs', 'build', 'build_review',
      'wiring_check', 'test_suite', 'architecture_review_as_built', 'retro', 'rebase',
    ] satisfies StepName[]) state[step] = 'done';
    // This feature has no approved architecture decision, so its as-built
    // validator is legitimately skipped through the upstream-skip rule.
    state.architecture_review = 'skipped';
    // The two other SHIP validators a technical-track feature legitimately skips.
    state.manual_test = 'skipped';
    state.prd_audit = 'skipped';
    await writeState(productionStatePath, state as ConductState);
    const runner: StepRunner = {
      run: vi.fn(async () => {
        pullRequest = {
          ...pullRequest,
          title: 'feat: publish coherent finish',
          body: 'Reader-facing summary of the completed change.',
        };
        return { success: true, publicationDisposition: { kind: 'accepted' } };
      }),
    };
    const events = new ConductorEventEmitter();
    const dispositions: string[] = [];
    events.on('finish_publication_disposition', (event) => {
      if (event.type === 'finish_publication_disposition') dispositions.push(event.disposition);
    });
    const coordinator = createProductionFinishPublicationCoordinator({
      projectRoot: dir,
      stateFilePath: productionStatePath,
      baseBranch: 'main',
      git: async (args) => args[0] === 'rev-parse'
        ? { stdout: 'refs/remotes/origin/feat/finish-publication\n' }
        : { stdout: '' },
      gh: async (args) => {
        if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify(pullRequest) };
        if (args[0] === 'pr' && args[1] === 'ready') {
          pullRequest.isDraft = false;
          return { stdout: '' };
        }
        throw new Error(`unexpected gh command: ${args.join(' ')}`);
      },
      observeReleaseReadiness: async () => 'present',
      recordFinish: async () => {
        await writeFile(join(pipeline, 'finish-choice'), 'pr\n');
        return 0;
      },
    });
    const conductor = new Conductor({
      stateFilePath: productionStatePath, stepRunner: runner, finishPublication: coordinator,
      events, projectRoot: dir, fromStep: 'finish', mode: 'auto', daemon: true,
      verifyArtifacts: false,
      git: async () => ({ stdout: '' }), gh: async () => ({ stdout: '' }), runGh: async () => ({ stdout: '' }),
    });

    await conductor.run();

    expect(dispositions).not.toContain('human_required');
    // No HALT at all is the expected outcome; `?? ''` keeps the assertion
    // reporting the offending reason when one IS written.
    const halt = await readFile(join(pipeline, 'HALT'), 'utf8').catch(() => '');
    expect(halt).not.toContain('ship_evidence_invalid');
  });

  it.each([
    [
      'a cited implementation defect',
      'build-review FAIL: src/engine/finish-publication.ts:497 returns an invalid implementation proof',
    ],
    [
      'a stale BUILD proof',
      'stale BUILD proof: .pipeline/gates/build.json predates the current HEAD',
    ],
  ])('routes %s back to BUILD with its evidence', async (_caseName, evidence) => {
    const calls: Array<{ step: StepName; retryReason?: string }> = [];
    const kickbacks: Array<{ from: StepName; to: StepName; evidence?: string }> = [];
    const dispositions: string[] = [];
    const events = new ConductorEventEmitter();
    events.on('kickback', (event) => {
      if (event.type === 'kickback') kickbacks.push(event);
    });
    events.on('finish_publication_disposition', (event) => {
      if (event.type === 'finish_publication_disposition') dispositions.push(event.disposition);
    });
    const runner: StepRunner = {
      run: vi.fn(async (step, _state, options) => {
        calls.push({ step, retryReason: options?.retryReason });
        if (step === 'build') throw ROUTED_SENTINEL;
        return {
          success: false,
          publicationDisposition: { kind: 'implementation_invalid', evidence },
        };
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'auto',
      maxRetries: 2,
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
      escalateBuildFailure: vi.fn(async () => ({})),
    });

    await conductor.run();

    expect(calls.map(({ step }) => step)).toEqual(['finish', 'build']);
    expect(calls[1]?.retryReason).toContain(evidence);
    expect(kickbacks).toContainEqual(expect.objectContaining({
      from: 'finish', to: 'build', evidence,
    }));
    expect(calls.map(({ step }) => step)).not.toContain('remediate');
    expect(dispositions).toEqual(['retry_build']);
    await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).resolves.toContain(
      ROUTED_SENTINEL.message,
    );
  });

  it.each([
    ['failed', 'failed' as const],
    ['stale', 'stale' as const],
    ['missing', undefined],
  ])(
    'replays BUILD verification after implementation-invalid FINISH when prior verification state is %s',
    async (_caseName, priorStatus) => {
      const timeline: StepName[] = [];
      let verificationStatesAtBuild: Pick<ConductState, 'test_suite' | 'build_review'> | undefined;
      const ensure = vi.fn(async () => {
        timeline.push('test_suite');
        return {
          status: 'REUSED',
          evidence: PASS_EVIDENCE,
        } as const;
      });
      const runner: StepRunner = {
        run: vi.fn(async (step, state) => {
          timeline.push(step);
          if (step === 'build') {
            verificationStatesAtBuild = {
              test_suite: state.test_suite,
              build_review: state.build_review,
            };
          }
          if (step === 'finish') {
            return {
              success: false,
              publicationDisposition: {
                kind: 'implementation_invalid',
                evidence: 'implementation_evidence_invalid',
              },
            };
          }
          if (step === 'build_review') throw ROUTED_SENTINEL;
          return { success: true };
        }),
      };
      const persisted = await readState(statePath);
      if (!persisted.ok) throw new Error('test fixture state must be readable');
      const retryState = { ...persisted.value } as Record<string, unknown>;
      for (const step of ['test_suite', 'build_review']) {
        if (priorStatus === undefined) delete retryState[step];
        else retryState[step] = priorStatus;
      }
      await writeState(statePath, retryState as ConductState);

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events: new ConductorEventEmitter(),
        projectRoot: dir,
        fromStep: 'finish',
        mode: 'auto',
        maxRetries: 1,
        fullSuiteVerifier: {
          ensure,
          inspect: async () => ({ status: 'CURRENT', evidence: PASS_EVIDENCE } as const),
        },
        git: async () => ({ stdout: '' }),
        gh: async () => ({ stdout: '' }),
        runGh: async () => ({ stdout: '' }),
      });

      await conductor.run();

      expect(timeline).toEqual(['finish', 'build', 'test_suite', 'build_review']);
      expect(ensure).toHaveBeenCalledOnce();
      expect(verificationStatesAtBuild).toEqual({
        test_suite: 'stale',
        build_review: 'stale',
      });
      await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).resolves.toContain(
        ROUTED_SENTINEL.message,
      );
    },
  );

  it('does not route a publication error without implementation evidence to BUILD', async () => {
    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        calls.push(step);
        return {
          success: false,
          publicationDisposition: {
            kind: 'publication_retry',
            transition: 'ready_pr',
            reason: 'presentation_repair_failed',
          },
        };
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'auto',
      maxRetries: 1,
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
      escalateBuildFailure: vi.fn(async () => ({})),
    });

    await conductor.run();

    expect(calls).toEqual(['finish']);
    expect(calls).not.toContain('build');
    expect(calls).not.toContain('remediate');
  });

  it.each([
    { kind: 'complete', reason: 'contradictory' },
    { kind: 'unknown' },
  ])('halts unknown publication disposition without broad remediation', async (publicationDisposition) => {
    const calls: StepName[] = [];
    const dispositions: string[] = [];
    const events = new ConductorEventEmitter();
    events.on('finish_publication_disposition', (event) => {
      if (event.type === 'finish_publication_disposition') dispositions.push(event.disposition);
    });
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        calls.push(step);
        return { success: false, publicationDisposition };
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'auto',
      maxRetries: 2,
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
      escalateBuildFailure: vi.fn(async () => ({})),
    });

    await conductor.run();

    expect(calls).toEqual(['finish']);
    expect(calls).not.toContain('build');
    expect(calls).not.toContain('remediate');
    expect(dispositions).toEqual(['human_required']);
    await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).resolves.toContain(
      'publication disposition',
    );
  });

  it.each([
    {
      name: 'an unknown transition',
      disposition: { kind: 'publication_progress', transition: 'publish_everywhere' },
    },
    {
      name: 'an extra key',
      disposition: { kind: 'publication_progress', transition: 'ready_pr', reason: 'unexpected' },
    },
  ])('fails closed for publication progress carrying %s', ({ disposition }) => {
    expect(routeFinishPublicationDisposition(disposition)).toEqual({
      kind: 'halt',
      reason: 'Unknown or contradictory FINISH publication disposition; human review required.',
    });
  });

  it('accepts the observed establish-record-establish publication revisit without a HALT', async () => {
    const stepRetries: StepName[] = [];
    const events = new ConductorEventEmitter();
    events.on('step_retry', (event) => {
      if (event.type === 'step_retry') stepRetries.push(event.step);
    });
    const advance = vi.fn()
      .mockResolvedValueOnce({ kind: 'publication_progress', transition: 'establish_pr' } as const)
      .mockResolvedValueOnce({ kind: 'publication_progress', transition: 'write_shipped_record' } as const)
      .mockResolvedValueOnce({ kind: 'publication_progress', transition: 'establish_pr' } as const)
      .mockResolvedValueOnce({ kind: 'publication_progress', transition: 'ready_pr' } as const)
      .mockResolvedValueOnce({ kind: 'publication_progress', transition: 'record_outcome' } as const)
      .mockResolvedValueOnce({ kind: 'complete' } as const);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      finishPublication: { advance },
      events,
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'default',
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
    });

    await conductor.run();

    expect(advance).toHaveBeenCalledTimes(6);
    expect(stepRetries).toEqual([]);
    const state = await readState(statePath);
    expect(state.ok && state.value.finish).toBe('done');
    await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(readFile(join(dir, '.pipeline/HALT.class'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('starts a fresh FINISH entry with a fresh publication progress allowance', async () => {
    const exhaustedAdvance = vi.fn(async () => ({
      kind: 'publication_progress' as const,
      transition: 'ready_pr' as const,
    }));
    const exhausted = new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      finishPublication: { advance: exhaustedAdvance },
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'default',
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
    });
    await exhausted.run();
    expect(exhaustedAdvance).toHaveBeenCalledTimes(14);

    await unlink(join(dir, '.pipeline/HALT'));
    await unlink(join(dir, '.pipeline/HALT.class'));
    const freshAdvance = vi.fn()
      .mockResolvedValueOnce({ kind: 'publication_progress', transition: 'ready_pr' } as const)
      .mockResolvedValueOnce({ kind: 'complete' } as const);
    const fresh = new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      finishPublication: { advance: freshAdvance },
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'default',
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
    });

    await fresh.run();

    expect(freshAdvance).toHaveBeenCalledTimes(2);
    const state = await readState(statePath);
    expect(state.ok && state.value.finish).toBe('done');
    await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(readFile(join(dir, '.pipeline/HALT.class'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it.each([
    {
      name: 'a transient retry', behavior: 'retry_then_sentinel', calls: 2, retries: 1,
      halt: ROUTED_SENTINEL.message,
    },
    {
      name: 'retry exhaustion', behavior: 'retry_exhaustion', calls: 3, retries: 2,
      halt: 'FINISH publication retry exhausted: draft_pr_failed',
    },
    {
      name: 'a non-retryable first observation', behavior: 'non_retryable', calls: 1, retries: 0,
      halt: 'draft_pr_lease-rejected is not retryable',
    },
    {
      name: 'a BUILD kickback', behavior: 'build_kickback', calls: 2, retries: 0,
      halt: ROUTED_SENTINEL.message,
    },
    {
      name: 'a human-required result', behavior: 'human_required', calls: 1, retries: 0,
      halt: 'operator must reconcile the publication state',
    },
  ] as const)('keeps legacy routing accounting for %s', async ({ behavior, calls: expectedCalls, retries, halt }) => {
    const calls: StepName[] = [];
    const stepRetries: StepName[] = [];
    const events = new ConductorEventEmitter();
    events.on('step_retry', (event) => {
      if (event.type === 'step_retry') stepRetries.push(event.step);
    });
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        calls.push(step);
        if (behavior === 'retry_then_sentinel' && calls.length === 2) throw ROUTED_SENTINEL;
        if (behavior === 'build_kickback' && step === 'build') throw ROUTED_SENTINEL;
        if (behavior === 'build_kickback') {
          return {
            success: false,
            publicationDisposition: { kind: 'implementation_invalid', evidence: 'BUILD proof is stale' },
          };
        }
        if (behavior === 'human_required') {
          return {
            success: false,
            publicationDisposition: { kind: 'human_required', reason: 'operator must reconcile the publication state' },
          };
        }
        return {
          success: false,
          publicationDisposition: {
            kind: 'publication_retry',
            transition: 'establish_pr',
            reason: behavior === 'non_retryable'
              ? 'draft_pr_lease-rejected'
              : 'draft_pr_failed',
          },
        };
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      fromStep: 'finish',
      mode: 'auto',
      maxRetries: 3,
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
      escalateBuildFailure: vi.fn(async () => ({})),
    });

    await conductor.run();

    expect(calls).toHaveLength(expectedCalls);
    expect(stepRetries).toHaveLength(retries);
    await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).resolves.toContain(halt);
  });
});
