/**
 * Covers: FR-1, FR-2, FR-3, FR-5, FR-7, FR-8
 *
 * Story-level RED spec for mergeability-first daemon finish. This drives the
 * real production entry point (`Conductor.runRebaseStep`) over a real local Git
 * repository. GitHub, network, LLM, and daemon-process boundaries are absent.
 *
 * Production call site under test:
 *   src/conductor/src/engine/conductor.ts:7012 — runRebaseStep
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import {
  createProtectedArtifactSeal,
  PROTECTED_ARTIFACT_SEAL_PATH,
} from '../../src/engine/protected-artifact-seal.js';
import { readState, writeState } from '../../src/engine/state.js';
import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const execFileAsync = promisify(execFile);
const BASE = 'main';

interface RebaseStepSubject {
  runRebaseStep(state: ConductState): Promise<StepRunResult>;
  lastRebaseOutcome?: { kind: string };
}

describe('mergeability-first daemon finish', () => {
  let repo: string;

  async function git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', ['-C', repo, ...args]);
    return stdout.trim();
  }

  /**
   * `baseAdvance` is the path the base gains after the feature branched. It is
   * the whole subject of the skip policy: a docs-only advance leaves every gate
   * verdict on this branch valid, while a code advance means build_review,
   * test_suite and manual_test were all graded against a base that has moved.
   */
  async function initCleanBehindFeature(
    baseAdvance: { path: string; content: string } = {
      path: 'docs/notes.md',
      content: '# base notes\n',
    },
  ): Promise<{
    featureHead: string;
    featureCommits: string[];
  }> {
    await execFileAsync('git', ['init', '-b', BASE, repo]);
    await git('config', 'user.email', 'acceptance@example.com');
    await git('config', 'user.name', 'Acceptance Test');
    await git('config', 'commit.gpgsign', 'false');

    await mkdir(join(repo, '.docs', 'plans'), { recursive: true });
    await mkdir(join(repo, 'src'), { recursive: true });
    await writeFile(join(repo, 'README.md'), '# base\n');
    await writeFile(join(repo, '.docs', 'plans', 'feature.md'), '# Approved plan\n');
    await git('add', '.');
    await git('commit', '-m', 'initial base');

    await git('checkout', '-b', 'feature/mergeable');
    await writeFile(
      join(repo, '.docs', 'plans', 'feature.md'),
      '# Approved plan\n\nImplementation ready.\n',
    );
    await writeFile(join(repo, 'src', 'feature.ts'), 'export const feature = true;\n');
    await git('add', '.');
    await git('commit', '-m', 'feature work');

    const featureHead = await git('rev-parse', 'HEAD');
    const featureCommits = (await git('rev-list', '--reverse', 'HEAD')).split('\n');
    await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit: featureHead });

    await git('checkout', BASE);
    await mkdir(join(repo, dirname(baseAdvance.path)), { recursive: true });
    await writeFile(join(repo, baseAdvance.path), baseAdvance.content);
    await git('add', baseAdvance.path);
    await git('commit', '-m', 'advance base without conflict');
    await git('checkout', 'feature/mergeable');

    return { featureHead, featureCommits };
  }

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'mergeability-first-finish-'));
    await mkdir(join(repo, '.pipeline', 'gates'), { recursive: true });
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it(
    'preserves a clean-behind feature and its verification evidence with a distinct mergeable outcome',
    async () => {
      const { featureHead, featureCommits } = await initCleanBehindFeature();
      const statePath = join(repo, '.pipeline', 'conduct-state.json');
      const initialState = {
        feature_desc: 'mergeability-first finish',
        manual_test: 'done',
        build: 'done',
        build_review: 'done',
        wiring_check: 'done',
        test_suite: 'done',
        prd_audit: 'done',
        architecture_review_as_built: 'done',
        rebase: 'pending',
      } as ConductState;
      await writeState(statePath, initialState);

      const preservedGatePaths = [
        'build',
        'build_review',
        'wiring_check',
        'test_suite',
        'manual_test',
        'prd_audit',
        'architecture_review_as_built',
      ].map((gate) => join(repo, '.pipeline', 'gates', `${gate}.json`));
      for (const [index, path] of preservedGatePaths.entries()) {
        await writeFile(
          path,
          `${JSON.stringify({
            satisfied: true,
            reason: `pre-finish evidence ${index}`,
            checkedAt: 1_700_000_000_000 + index,
          })}\n`,
        );
      }
      const evidenceBefore = await Promise.all(
        preservedGatePaths.map((path) => readFile(path, 'utf8')),
      );
      const sealPath = join(repo, PROTECTED_ARTIFACT_SEAL_PATH);
      const sealBefore = await readFile(sealPath, 'utf8');
      const worktreeStatusBefore = await git('status', '--porcelain');

      const translateAfterRebase = vi.fn(async () => {});
      const runner: StepRunner = {
        run: async () => ({ success: true }),
        translateAfterRebase,
      };
      const events = new ConductorEventEmitter();
      const emit = vi.spyOn(events, 'emit');
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: repo,
        daemon: true,
        mode: 'auto',
        baseBranch: BASE,
      });
      const subject = conductor as unknown as RebaseStepSubject;

      const result = await subject.runRebaseStep(initialState);

      const finalStateResult = await readState(statePath);
      const finalState = finalStateResult.ok ? finalStateResult.value : {};
      const evidenceAfter = await Promise.all(
        preservedGatePaths.map((path) => readFile(path, 'utf8')),
      );
      const eventTypes = emit.mock.calls.map(([event]) => String(event.type));

      expect({
        success: result.success,
        outcome: subject.lastRebaseOutcome?.kind,
        head: await git('rev-parse', 'HEAD'),
        commits: (await git('rev-list', '--reverse', 'HEAD')).split('\n'),
        worktreeStatus: await git('status', '--porcelain'),
        evidencePreserved: evidenceAfter,
        sealPreserved: await readFile(sealPath, 'utf8'),
        translationCalls: translateAfterRebase.mock.calls.length,
        rebaseState: finalState.rebase,
        hasExactMergeableSkipEvent: eventTypes.includes('rebase_mergeable_skip'),
      }).toEqual({
        success: true,
        outcome: 'mergeable_skip',
        head: featureHead,
        commits: featureCommits,
        worktreeStatus: worktreeStatusBefore,
        evidencePreserved: evidenceBefore,
        sealPreserved: sealBefore,
        translationCalls: 0,
        rebaseState: 'done',
        hasExactMergeableSkipEvent: true,
      });
    },
    30_000,
  );

  it(
    'does NOT skip when the base advanced with code — the gates were graded against a base that moved',
    async () => {
      const { featureHead } = await initCleanBehindFeature({
        path: 'src/sibling.ts',
        content: 'export const sibling = true;\n',
      });
      const statePath = join(repo, '.pipeline', 'conduct-state.json');
      const initialState = {
        feature_desc: 'mergeability-first finish',
        manual_test: 'done',
        build: 'done',
        build_review: 'done',
        rebase: 'pending',
      } as ConductState;
      await writeState(statePath, initialState);

      const events = new ConductorEventEmitter();
      const emit = vi.spyOn(events, 'emit');
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: { run: async () => ({ success: true }) } as StepRunner,
        events,
        projectRoot: repo,
        daemon: true,
        mode: 'auto',
        baseBranch: BASE,
      });
      const subject = conductor as unknown as RebaseStepSubject;

      const result = await subject.runRebaseStep(initialState);
      const eventTypes = emit.mock.calls.map(([event]) => String(event.type));

      expect({
        success: result.success,
        outcome: subject.lastRebaseOutcome?.kind,
        headMoved: (await git('rev-parse', 'HEAD')) !== featureHead,
        skipped: eventTypes.includes('rebase_mergeable_skip'),
      }).toEqual({
        success: true,
        // The branch is textually mergeable, so the real rebase runs cleanly and
        // classifies as a code-changing rebase — which kicks the downstream
        // gates back for re-verification instead of shipping stale verdicts.
        outcome: 'changed',
        headMoved: true,
        skipped: false,
      });
    },
    30_000,
  );

  it('fails closed into the existing integration recovery when the target disappears', async () => {
    const { featureHead } = await initCleanBehindFeature();
    await git('branch', '-D', BASE);
    const statePath = join(repo, '.pipeline', 'conduct-state.json');
    const state = {
      feature_desc: 'mergeability-first finish',
      manual_test: 'done',
      rebase: 'pending',
    } as ConductState;
    await writeState(statePath, state);

    const events = new ConductorEventEmitter();
    const emit = vi.spyOn(events, 'emit');
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: async () => ({ success: true }) },
      events,
      projectRoot: repo,
      daemon: true,
      mode: 'auto',
      baseBranch: BASE,
    });
    const subject = conductor as unknown as RebaseStepSubject;

    const result = await subject.runRebaseStep(state);
    const eventTypes = emit.mock.calls.map(([event]) => String(event.type));
    const halt = await readFile(join(repo, '.pipeline', 'HALT'), 'utf8');

    expect({
      success: result.success,
      outcome: subject.lastRebaseOutcome?.kind,
      head: await git('rev-parse', 'HEAD'),
      mergeableSkipReported: eventTypes.some(
        (type) => type.includes('mergeable') && type.includes('skip'),
      ),
      halted: halt.length > 0,
    }).toEqual({
      success: true,
      outcome: 'conflict_halt',
      head: featureHead,
      mergeableSkipReported: false,
      halted: true,
    });
  });
});
