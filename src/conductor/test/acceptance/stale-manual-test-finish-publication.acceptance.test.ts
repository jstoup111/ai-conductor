/**
 * Acceptance coverage for
 * .docs/stories/stale-manual-test-discovered-at-finish-is-unroutab.md.
 *
 * This is the uncovered multi-step Story 2 seam: Conductor.run() reaches the
 * current-HEAD SHIP fence with the production publication coordinator wired,
 * redirects to manual_test, re-runs it, returns to FINISH, and publishes.
 * Git and GitHub remain faithful in-memory fakes at the external boundary.
 *
 * Existing coverage retained by this feature:
 * - ship-tail-publication-fence-922.acceptance.test.ts owns generic missing,
 *   unreadable, skipped-member, explicit-navigation, and parallel rerun cases.
 * - gate-loop.test.ts owns a genuinely failing manual_test and its bounded
 *   needs-human halt.
 */

import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { PASSING_FULL_SUITE_VERIFIER } from '../test-conductor.js';
import { createProductionFinishPublicationCoordinator } from '../../src/engine/finish-publication-production.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { readState, writeState } from '../../src/engine/state.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('stale SHIP evidence at FINISH converges through the production coordinator', () => {
  it.each([
    {
      label: 'manual_test was marked stale after review-lap commits',
      manualTestState: 'stale' as const,
      existingEvidence: false,
    },
    {
      label: 'ship-tail rebase and maintain_documentation commits invalidated a stamped manual_test verdict while state still says done',
      manualTestState: 'done' as const,
      existingEvidence: true,
    },
  ])('reruns and publishes unattended when $label', async ({ manualTestState, existingEvidence }) => {
    const root = await mkdtemp(join(tmpdir(), 'stale-manual-test-finish-'));
    roots.push(root);
    const pipeline = join(root, '.pipeline');
    const stateFilePath = join(pipeline, 'conduct-state.json');
    const prUrl = 'https://github.com/acme/widget/pull/1613';
    await mkdir(pipeline, { recursive: true });

    const state: Record<string, unknown> = {
      feature_desc: 'stale-manual-test-discovered-at-finish-is-unroutab',
      worktree_branch: 'feat/stale-manual-test',
      complexity_tier: 'M',
      track: 'technical',
      pr_url: prUrl,
    };
    for (const step of ALL_STEPS) {
      if (step.name === 'finish') break;
      state[step.name] = 'done';
    }
    Object.assign(state, {
      architecture_review: 'skipped',
      manual_test: manualTestState,
      prd_audit: 'skipped',
      architecture_review_as_built: 'skipped',
      retro: 'skipped',
      rebase: 'done',
      // The custom documentation-maintenance tail commit lands after rebase.
      // It leaves manual_test's pre-tail code stamp behind the current run.
      maintain_documentation: 'done',
    });
    await writeState(stateFilePath, state as ConductState);
    await mkdir(join(root, '.docs', 'shipped'), { recursive: true });
    await writeFile(
      join(root, '.docs', 'shipped', 'stale-manual-test-discovered-at-finish-is-unroutab.md'),
      'shipped\n',
    );

    // The second observed shape arrives at FINISH with a clean PASS already
    // recorded. Its stamp predates the ship-tail's runtime rebase and the
    // following documentation-maintenance commit, so the fence must rerun
    // manual_test for stamp drift rather than mistaking absent evidence for
    // the cause.
    const preShipTailCodeStamp = 'manual-test-before-ship-tail-rebase';
    if (existingEvidence) {
      await writeFile(
        join(pipeline, 'manual-test-results.md'),
        '# Manual Test Results\n\n| Story | Result |\n|---|---|\n| Story 2 | PASS |\n',
      );
      await writeFile(
        join(pipeline, 'manual-test-fail-evidence.json'),
        JSON.stringify({ codeStamp: preShipTailCodeStamp }),
      );
      await expect(access(join(pipeline, 'manual-test-results.md'))).resolves.toBeUndefined();
      await expect(readFile(join(pipeline, 'manual-test-fail-evidence.json'), 'utf8')).resolves.toContain(
        preShipTailCodeStamp,
      );
    }

    let manualTestRuns = 0;
    let publicationObservedBeforeValidation = false;
    let pullRequest = {
      url: prUrl,
      title: 'feat: draft publication',
      body: '<!-- conductor:pr-body-floor -->\n\nDraft opened automatically.',
      isDraft: true,
    };
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        if (step === 'manual_test') {
          manualTestRuns++;
          await writeFile(
            join(pipeline, 'manual-test-results.md'),
            '# Manual Test Results\n\n| Story | Result |\n|---|---|\n| Story 2 | PASS |\n',
          );
          return { success: true };
        }
        if (step === 'finish') {
          pullRequest = {
            ...pullRequest,
            title: 'fix: rerun stale SHIP validation before publication',
            body: 'Reader-facing summary of the completed stale-validator repair.',
          };
          return { success: true, publicationDisposition: { kind: 'accepted' } };
        }
        return { success: true };
      }),
    };
    const gh = vi.fn(async (args: string[]) => {
      if (args[0] === 'auth' && args[1] === 'status') return { stdout: '' };
      if (args[0] === 'pr' && args[1] === 'view') {
        return { stdout: JSON.stringify(pullRequest) };
      }
      if (args[0] === 'pr' && args[1] === 'ready') {
        pullRequest = { ...pullRequest, isDraft: false };
        return { stdout: '' };
      }
      throw new Error(`unexpected GitHub command: ${args.join(' ')}`);
    });
    const git = vi.fn(async (args: string[]) => {
      if (args[0] === 'remote') return { stdout: 'origin\n' };
      if (args[0] === 'rev-list') return { stdout: '1\n' };
      if (args[0] === 'rev-parse') return { stdout: 'refs/remotes/origin/feat/stale-manual-test\n' };
      if (args[0] === 'merge-base' || args[0] === 'push') return { stdout: '' };
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    });
    const events = new ConductorEventEmitter();
    const finishKickbacks: Array<{ from: StepName; to: StepName }> = [];
    events.on('kickback', (event) => {
      if (event.type === 'kickback' && event.from === 'finish') {
        finishKickbacks.push({ from: event.from, to: event.to });
      }
    });

    const conductor = new Conductor({
      projectRoot: root,
      stateFilePath,
      stepRunner: runner,
      events,
      mode: 'auto',
      daemon: true,
      fromStep: 'finish',
      maxRetries: 1,
      verifyArtifacts: false,
      finishPublication: createProductionFinishPublicationCoordinator({
        projectRoot: root,
        stateFilePath,
        baseBranch: 'main',
        git,
        gh,
        acquireInteractiveIntent: async () => 'pr',
        observeReleaseReadiness: async () => {
          if (manualTestRuns === 0) publicationObservedBeforeValidation = true;
          return 'present';
        },
        writeShippedRecord: async () => 0,
        recordFinish: async () => {
          await writeFile(join(pipeline, 'finish-choice'), 'pr\n');
          return 0;
        },
      }),
      git,
      gh,
    });

    await conductor.run();

    const finalState = await readState(stateFilePath);
    expect(publicationObservedBeforeValidation).toBe(false);
    expect(manualTestRuns).toBe(1);
    expect(finishKickbacks).toEqual([{ from: 'finish', to: 'manual_test' }]);
    expect(finalState.ok && finalState.value.finish).toBe('done');
    expect(pullRequest.isDraft).toBe(false);
    await expect(readFile(join(pipeline, 'finish-choice'), 'utf8')).resolves.toBe('pr\n');
    await expect(access(join(pipeline, 'HALT'))).rejects.toThrow();
  });

  it('halts at the manual_test per-gate cap when the FINISH fence repeatedly finds FAIL evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stale-manual-test-finish-cap-'));
    roots.push(root);
    const pipeline = join(root, '.pipeline');
    const stateFilePath = join(pipeline, 'conduct-state.json');
    await mkdir(pipeline, { recursive: true });
    const state: Record<string, unknown> = {
      feature_desc: 'stale-manual-test-discovered-at-finish-is-unroutab',
      worktree_branch: 'feat/stale-manual-test',
      complexity_tier: 'L',
      track: 'technical',
    };
    for (const step of ALL_STEPS) {
      if (step.name === 'finish') break;
      state[step.name] = 'done';
    }
    Object.assign(state, {
      architecture_review: 'skipped',
      build_review: 'skipped',
      manual_test: 'stale',
      prd_audit: 'skipped',
      architecture_review_as_built: 'skipped',
      retro: 'skipped',
      rebase: 'done',
    });
    await writeState(stateFilePath, state as ConductState);
    await writeFile(
      join(pipeline, 'task-status.json'),
      JSON.stringify({ tasks: [{ id: 't1', status: 'completed' }] }),
    );
    let manualTestRuns = 0;
    let buildRuns = 0;
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        if (step === 'manual_test') {
          manualTestRuns++;
          await writeFile(
            join(pipeline, 'manual-test-results.md'),
            '# Manual Test Results\n\n| Story | Result |\n|---|---|\n| Story 2 | FAIL |\n',
          );
        }
        if (step === 'build') {
          buildRuns++;
          await writeFile(
            join(pipeline, 'task-status.json'),
            JSON.stringify({
              tasks: [
                { id: 't1', status: 'completed' },
                ...Array.from({ length: buildRuns }, (_, index) => ({
                  id: `progress-${index + 1}`,
                  status: 'completed',
                })),
              ],
            }),
          );
        }
        return { success: true };
      }),
    };
    const events = new ConductorEventEmitter();
    const kickbacks: Array<{ from: StepName; to: StepName }> = [];
    events.on('kickback', (event) => {
      if (event.type === 'kickback') kickbacks.push({ from: event.from, to: event.to });
    });
    const conductor = new Conductor({
      projectRoot: root,
      stateFilePath,
      stepRunner: runner,
      events,
      mode: 'auto',
      daemon: true,
      fromStep: 'finish',
      maxRetries: 1,
      verifyArtifacts: true,
      finishPublication: { advance: vi.fn(async () => ({ kind: 'complete' } as const)) },
      config: { kickback_escalation: { enabled: false } },
      fullSuiteVerifier: PASSING_FULL_SUITE_VERIFIER,
      sleepFn: async () => undefined,
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
    });
    await conductor.run();

    expect(kickbacks).toEqual([
      { from: 'finish', to: 'manual_test' },
      { from: 'manual_test', to: 'build' },
      { from: 'manual_test', to: 'build' },
    ]);
    expect(manualTestRuns).toBe(3);
    expect(buildRuns).toBe(2);
    await expect(readFile(join(pipeline, 'HALT'), 'utf8')).resolves.toContain(
      'manual-test FAIL unresolved after 2 build kickback(s) (cap 2)',
    );
    await expect(readFile(join(pipeline, 'HALT.class'), 'utf8')).resolves.toBe('mechanical');
  });
});
