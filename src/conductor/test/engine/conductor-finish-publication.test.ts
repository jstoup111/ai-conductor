import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ConductState, StepName } from '../../src/types/index.js';
import { Conductor } from '../test-conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import { createProductionFinishPublicationCoordinator } from '../../src/engine/finish-publication-production.js';

vi.mock('../../src/engine/project-prelude.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/engine/project-prelude.js')>()),
  currentCommitSha: vi.fn(async () => null),
}));

const ROUTED_SENTINEL = new Error('stop after first FINISH publication route');

describe('Conductor FINISH publication routing', () => {
  let dir: string;
  let statePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-finish-publication-'));
    statePath = join(dir, 'conduct-state.json');
    const state: Record<string, unknown> = {
      complexity_tier: 'S',
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
    { name: 'daemon', mode: 'auto' as const, daemon: true },
  ])('starts at FINISH and lets the coordinator bound %s judgment dispatches', async ({ mode, daemon }) => {
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
      feature_desc: 'finish-publication',
      worktree_branch: 'feat/finish-publication',
      pr_url: prUrl,
    };
    for (const step of [
      'bootstrap', 'memory', 'assess', 'explore', 'prd', 'complexity', 'stories',
      'conflict_check', 'plan', 'coherence_check', 'architecture_diagram',
      'architecture_review', 'worktree', 'acceptance_specs', 'build', 'build_review',
      'wiring_check', 'test_suite', 'manual_test', 'prd_audit',
      'architecture_review_as_built', 'retro', 'rebase',
    ] satisfies StepName[]) state[step] = 'done';
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
      'architecture_review', 'worktree', 'acceptance_specs', 'build', 'build_review',
      'wiring_check', 'test_suite', 'architecture_review_as_built', 'retro', 'rebase',
    ] satisfies StepName[]) state[step] = 'done';
    // The two steps a technical-track feature legitimately skips.
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
});
