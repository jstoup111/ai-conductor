/**
 * Covers: S7.1, S7.3, FR-9, task:16
 *
 * Acceptance coverage for operator-authorized cumulative kickback recovery.
 * The daemon's real re-kick boundary must consume one matching authorization
 * before its ordinary needs-human retention branch, clear only that halt, and
 * then let the normal conductor select the earliest unsatisfied step.
 *
 * The injected authorization consumer is the durable-control-state boundary;
 * no GitHub, LLM, process, or other third-party service is reached.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import {
  clearMarker,
  HALT_MARKER,
  listHaltedWorktrees,
  readHaltReason,
  rekickSweep,
  type RekickSweepDeps,
} from '../../src/engine/daemon-rekick.js';
import { consumeKickbackResumeAuthorization } from '../../src/engine/kickback-budget.js';
import { readKickbackLedger } from '../../src/engine/kickback-ledger.js';
import { writeState } from '../../src/engine/state.js';
import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const SLUG = 'authorized-kickback-recovery';
const BASE_SHA = 'a'.repeat(40);

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

describe('authorized cumulative-cap recovery returns to normal daemon ownership', () => {
  let root: string;
  let worktreeBase: string;
  let worktree: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kickback-budget-recovery-acceptance-'));
    worktreeBase = join(root, '.worktrees');
    worktree = join(worktreeBase, SLUG);
    await mkdir(join(worktree, '.pipeline'), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('consumes the exact authorization, clears its needs-human halt, and resumes at BUILD', async () => {
    await writeFile(
      join(worktree, '.pipeline', 'kickback-ledger.json'),
      JSON.stringify({
        version: 1,
        gates: {
          build_review: {
            count: 2,
            cumulative: 0,
            treeHash: 'tree-after-reset',
            lastReason: 'semantic review failure',
            priorVerdict: false,
            resolvedBefore: 0,
            effectiveLimit: 5,
            exhaustedEvidence: {
              gate: 'build_review',
              count: 6,
              limit: 5,
              generation: 'cap-generation-1',
              latestReason: 'semantic review failure',
            },
            adjustments: [
              {
                id: 'adjustment-1',
                kind: 'reset',
                beforeCount: 6,
                afterCount: 0,
                beforeLimit: 5,
                afterLimit: 5,
                operator: 'approved-operator',
                rationale: 'the previous review contract is obsolete',
                at: '2026-08-30T12:00:00.000Z',
              },
            ],
            resumeAuthorization: {
              adjustmentId: 'adjustment-1',
              gate: 'build_review',
              haltClass: 'needs-human',
              generation: 'cap-generation-1',
            },
          },
        },
      }),
      'utf8',
    );
    await writeFile(join(worktree, HALT_MARKER), 'build_review cumulative cap exceeded\n', 'utf8');
    await writeFile(join(worktree, '.pipeline', 'HALT.class'), 'needs-human\n', 'utf8');

    const deps: RekickSweepDeps = {
      listHaltedWorktrees: () => listHaltedWorktrees(worktreeBase),
      readHaltReason: (slug) => readHaltReason(worktreeBase, slug),
      hasRebaseInProgress: async () => false,
      abortRebase: async () => {
        throw new Error('no rebase should be aborted');
      },
      clearMarker: (slug) => clearMarker(join(worktreeBase, slug)),
      lastRekickSha: new Map(),
      isOperatorParked: async () => false,
      isProcessed: async () => false,
      readHaltClass: async () => 'needs-human',
      consumeKickbackResumeAuthorization: (slug) =>
        consumeKickbackResumeAuthorization(join(worktreeBase, slug)),
    };

    const sweep = await rekickSweep(deps, BASE_SHA);

    expect(sweep).toEqual({ cleared: [SLUG], skipped: [] });
    expect(await exists(join(worktree, HALT_MARKER))).toBe(false);
    await expect(readKickbackLedger(worktree)).resolves.toMatchObject({
      gates: { build_review: { exhaustedEvidence: { generation: 'cap-generation-1' } } },
    });
    expect((await readKickbackLedger(worktree)).gates.build_review?.resumeAuthorization).toBeUndefined();

    // The authorization was consumed by the real ledger transaction, so a
    // later needs-human sweep cannot clear a newly written marker.
    await writeFile(join(worktree, HALT_MARKER), 'build_review cumulative cap exceeded again\n', 'utf8');
    const secondSweep = await rekickSweep({ ...deps, lastRekickSha: new Map() }, 'b'.repeat(40));
    expect(secondSweep).toEqual({ cleared: [], skipped: [SLUG] });
    expect(await exists(join(worktree, HALT_MARKER))).toBe(true);

    const state: ConductState = {
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      prd: 'done',
      complexity: 'done',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done',
      coherence_check: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      acceptance_specs: 'done',
      build: 'pending',
      track: 'product',
      complexity_tier: 'M',
      feature_desc: SLUG,
      worktree_branch: `feat/${SLUG}`,
    };
    const stateFilePath = join(worktree, '.pipeline', 'conduct-state.json');
    await writeState(stateFilePath, state);

    const dispatched: string[] = [];
    const runner: StepRunner = {
      run: async (step) => {
        dispatched.push(step);
        return { success: false, output: 'sentinel: stop after resumed BUILD dispatch' };
      },
    };
    const conductor = new Conductor({
      projectRoot: worktree,
      stateFilePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      mode: 'default',
      daemon: true,
      resume: true,
      maxRetries: 1,
      baseBranch: 'main',
      worktreeBranch: `feat/${SLUG}`,
      sleepFn: async () => {},
      escalateBuildFailure: async () => ({}),
    });

    await conductor.run();

    expect(dispatched).toEqual(['build']);
  });
});
