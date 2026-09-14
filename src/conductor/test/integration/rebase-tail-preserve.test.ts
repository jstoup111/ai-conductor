import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState, readState } from '../../src/engine/state.js';
import { readVerdict } from '../../src/engine/gate-verdicts.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import type { GitRunner } from '../../src/engine/pr-labels.js';
import { currentCommitSha } from '../../src/engine/project-prelude.js';

const prospectiveMergeFixture = vi.hoisted(() => ({ forceIndeterminate: false }));

vi.mock('execa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('execa')>();
  return {
    ...actual,
    execa: (...args: Parameters<typeof actual.execa>) => {
      if (
        prospectiveMergeFixture.forceIndeterminate &&
        args[0] === 'git' &&
        Array.isArray(args[1]) &&
        args[1][0] === 'merge-tree'
      ) {
        return Promise.resolve({
          exitCode: 2,
          stdout: '',
          stderr: 'fixture: prospective merge classification unavailable',
        }) as unknown as ReturnType<typeof actual.execa>;
      }
      return actual.execa(...args);
    },
  };
});

// Task 11 (#2253): a real rebase with an unavailable exact-tree comparison
// follows the explicit conservative review transition. It must retain
// completed authoring/BUILD rather than reach either by tail position.

const execFileAsync = promisify(execFile);
const BASE = 'main';

const FRONT_DONE_M: ConductState = {
  complexity_tier: 'M',
  feature_desc: 'add foo',
  worktree: 'done',
  memory: 'done',
  explore: 'done',
  prd: 'done',
  complexity: 'done',
  stories: 'done',
  conflict_check: 'skipped',
  plan: 'done',
  coherence_check: 'done',
  coverage_binding: 'done',
  architecture_diagram: 'skipped',
  architecture_review: 'done',
  acceptance_specs: 'skipped',
};

describe('integration/rebase-tail-preserve (Task 11, #2253)', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  async function git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', ['-C', dir, ...args]);
    return stdout.trim();
  }

  async function initRepoOnFeatureBranch(featureFile: {
    path: string;
    content: string;
  }): Promise<void> {
    await execFileAsync('git', ['init', '-b', BASE, dir]);
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
    await git('config', 'commit.gpgsign', 'false');
    await writeFile(join(dir, 'README.md'), '# base\n');
    await mkdir(join(dir, '.docs/specs'), { recursive: true });
    await mkdir(join(dir, '.docs/stories'), { recursive: true });
    await writeFile(
      join(dir, '.docs/specs/add-foo.md'),
      '# Requirements\n\n## Functional Requirements\n\n- **FR-1:** Foo is implemented.\n',
    );
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    await writeFile(
      join(dir, '.docs/plans/add-foo.md'),
      '### Task 1: Implement foo\n\n**Criterion:** S1.1\n\n**Done when:**\n- Foo is implemented.\n',
    );
    await writeFile(
      join(dir, '.docs/stories/add-foo.md'),
      '**Status:** Accepted\n\n## Story 1: Foo\n\n**Requirements:** FR-1\n\n### Happy Path\n- Given foo, when it runs, then it succeeds.\n',
    );
    await git('add', '.');
    await git('commit', '-m', 'initial commit on base');

    await git('checkout', '-b', 'feature/foo');
    await mkdir(join(dir, featureFile.path, '..'), { recursive: true }).catch(
      () => {},
    );
    await writeFile(join(dir, featureFile.path), featureFile.content);
    await git('add', '.');
    await git('commit', '-m', 'feature work');
  }

  // Base advances with ONLY a genuinely-foreign runtime file (a path the
  // feature branch never touched) — D_foreignSrc != ∅, D_featureSrc == ∅.
  async function advanceBaseForeignRuntimeOnly(): Promise<void> {
    await git('checkout', BASE);
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/foreign-only.ts'), 'export const foreignOnly = 1;\n');
    await git('add', '.');
    await git('commit', '-m', 'foreign runtime change merged to base');
    await git('checkout', 'feature/foo');
  }

  beforeEach(async () => {
    prospectiveMergeFixture.forceIndeterminate = false;
    dir = await mkdtemp(join(tmpdir(), 'rebase-tail-preserve-'));
    statePath = join(dir, '.pipeline', 'conduct-state.json');
    events = new ConductorEventEmitter();
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await mkdir(join(dir, '.docs'), { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function forceIndeterminateProspectiveMerge(): void {
    prospectiveMergeFixture.forceIndeterminate = true;
  }

  function conductorWith(runner: StepRunner): Conductor {
    const fakeGit: GitRunner = async (args) =>
      args.includes('--symbolic-full-name')
        ? { stdout: 'refs/remotes/origin/feature/x\n' }
        : { stdout: '' };
    return new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      daemon: true,
      verifyArtifacts: true,
      mode: 'auto',
      fromStep: 'build',
      maxRetries: 1,
      git: fakeGit,
      shipmentEvidence: async (input) => ({
        kind: 'valid',
        slug: input.slug,
        pr: input.implementationPr,
        recordPath: `.docs/shipped/${input.slug}.md`,
        hash: 'fixture-hash',
        commit: input.candidateCommit,
      }),
      fullSuiteVerifier: {
        ensure: async () => ({ status: 'REUSED', evidence: {} as never }),
        inspect: async () => ({ status: 'CURRENT', evidence: {} as never }),
      },
    });
  }

  async function satisfy(step: string): Promise<StepRunResult> {
    if (step === 'build') {
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: 't1', status: 'completed' }] }),
      );
    } else if (step === 'coverage_binding') {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/coverage-binding.json'), JSON.stringify({ version: 1, slug: 'add-foo', runId: 'test-run', status: 'disabled', entries: [] }));
    } else if (step === 'build_review') {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/build-review.json'),
        JSON.stringify({
          verdict: 'PASS',
          rubric: { testQuality: false },
        }),
      );
    } else if (step === 'manual_test') {
      await writeFile(
        join(dir, '.pipeline/manual-test-results.md'),
        '| Story | Result |\n|---|---|\n| foo | PASS |\n',
      );
    } else if (step === 'prd_audit') {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/prd-audit.md'),
        [
          '# PRD Audit',
          '',
          '**PRD:** present',
          '',
          '## Verdict Table',
          '',
          '| Criterion | Grade | Plan task | PRD | Evidence |',
          '|---|---|---|---|---|',
          '| S1.1 | PASS | 1 | FR-1 | foo.ts:1 |',
          '',
        ].join('\n'),
      );
    } else if (step === 'architecture_review_as_built') {
      await mkdir(join(dir, '.docs/decisions'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/architecture-review-as-built.md'),
        '# As-Built Review\n\nVerdict: APPROVED\n',
      );
    } else if (step === 'finish') {
      await writeFile(join(dir, '.pipeline/finish-choice'), 'pr\n');
      const stateResult = await readState(statePath);
      const state = stateResult.ok ? stateResult.value : {};
      state.pr_url = 'https://github.com/org/repo/pull/1';
      await writeState(statePath, state);
      await writeState(join(dir, '.pipeline/conduct-state.json'), state);
    }
    return { success: true };
  }

  function runCountingRunner(counts: Record<string, number>): StepRunner {
    return {
      run: async (step) => {
        counts[step] = (counts[step] ?? 0) + 1;
        return satisfy(step);
      },
    };
  }

  it('takes the explicit conservative path when replay proof is unavailable without replaying completed authoring or BUILD by position', async () => {
    await initRepoOnFeatureBranch({
      path: 'src/feature.ts',
      content: 'export const foo = 1;\n',
    });
    await advanceBaseForeignRuntimeOnly();
    forceIndeterminateProspectiveMerge();

    await writeState(statePath, { ...FRONT_DONE_M });
    const counts: Record<string, number> = {};
    await conductorWith(runCountingRunner(counts)).run();

    // Unproved replay conservatively re-runs the affected judged gates.
    expect(counts.prd_audit).toBe(1);
    expect(counts.architecture_review_as_built).toBe(1);

    // Re-run gates: the foreign runtime delta touches their surface, so each
    // must have been re-dispatched a second time after the rebase kickback.
    // (build_review is disabled by default config in this fixture, so it
    // never dispatches at all here; manual_test is what proves the invalidated
    // set actually re-runs while the preserved judged gates above do not.)
    expect(counts.manual_test).toBeGreaterThanOrEqual(2);

    const operation = (await readVerdict(dir, 'rebase'))?.rebaseOperation;
    expect(operation?.transition.invalidated).not.toContain('build');
    expect(operation?.transition.invalidated).not.toContain('acceptance_specs');

    // The selected reviews complete normally after the conservative pass.
    const finalStateResult = await readState(statePath);
    const finalState = finalStateResult.ok ? finalStateResult.value : {};
    expect(finalState.prd_audit).toBe('done');
    expect(finalState.architecture_review_as_built).toBe('done');
  });
});
