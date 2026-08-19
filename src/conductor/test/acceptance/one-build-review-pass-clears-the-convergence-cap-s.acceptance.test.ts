/**
 * RED acceptance coverage for #1694.
 *
 * Distinct externally observable flow covered here:
 * - Story 1 happy path 3: an already-spent build_review convergence budget
 *   survives a PASS, a downstream manual_test kickback, and the following
 *   rebuild so the next build_review FAIL reaches the existing cumulative
 *   needs-human halt.
 *
 * The remaining story criteria are single ledger, rebase-invalidation, event,
 * or exported-surface contracts assigned to plan Tasks 2-10 at the lower
 * engine/unit layer. This acceptance spec drives the real Conductor.run()
 * entry point because only that path composes PASS completion, downstream
 * navigation, a rebuilding lap, kickback consumption, and halt persistence.
 * The StepRunner and aggregate verifier are faithful third-party/process
 * boundary fakes; the conductor, local Git repository, state, ledger, and
 * event spine are real.
 */

import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { Conductor } from '../../src/engine/conductor.js';
import type { ConductorOptions, StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { readHaltClass } from '../../src/engine/halt-marker.js';
import {
  MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW,
  readKickbackLedger,
  writeKickbackLedger,
} from '../../src/engine/kickback-ledger.js';
import type { ShipmentEvidenceInput } from '../../src/engine/shipment-evidence.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeState } from '../../src/engine/state.js';
import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const dirs: string[] = [];

async function git(dir: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd: dir });
  return stdout.trim();
}

async function initRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'build-review-pass-cap-'));
  dirs.push(dir);
  await git(dir, 'init', '-q', '-b', 'main');
  await git(dir, 'config', 'user.email', 'acceptance@example.com');
  await git(dir, 'config', 'user.name', 'Acceptance Test');
  return dir;
}

async function seedThroughBuildReview(statePath: string): Promise<void> {
  const state: Record<string, unknown> = {};
  for (const step of ALL_STEPS) {
    if (step.name === 'build_review') break;
    state[step.name] = 'done';
  }
  state.build_review = 'pending';
  state.complexity_tier = 'M';
  state.feature_desc = 'one-build-review-pass-clears-the-convergence-cap-s';
  state.track = 'technical';
  state.architecture_review = 'skipped';
  state.run_started_at = Date.now();
  await writeState(statePath, state as unknown as ConductState);
}

const passVerdict = JSON.stringify({
  verdict: 'PASS',
  reasons: [],
  findings: {},
  rubric: {
    tautology: false,
    scope: false,
    rootCause: false,
    completeness: false,
    wiring: false,
  },
});

const failVerdict = JSON.stringify({
  verdict: 'FAIL',
  reasons: ['completeness: the approved convergence repair is incomplete'],
  findings: { completeness: ['the approved convergence repair is incomplete'] },
  rubric: {
    tautology: false,
    scope: false,
    rootCause: false,
    completeness: true,
    wiring: false,
  },
});

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('acceptance: a build_review PASS does not clear convergence (#1694 Story 1)', () => {
  it('halts at the existing cumulative cap after PASS, downstream kickback, rebuild, and FAIL', async () => {
    const dir = await initRepo();
    const pipelineDir = join(dir, '.pipeline');
    const statePath = join(pipelineDir, 'conduct-state.json');
    await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
    await mkdir(pipelineDir, { recursive: true });
    await writeFile(
      join(dir, '.docs', 'plans', 'one-build-review-pass-clears-the-convergence-cap-s.md'),
      '# Plan\n\n### Task 1: retain convergence across PASS\n',
    );
    await writeFile(join(dir, '.gitignore'), '.pipeline/\n');
    await writeFile(join(dir, 'work.txt'), 'base\n');
    await git(dir, 'add', '.');
    await git(dir, 'commit', '-qm', 'base');
    await git(dir, 'checkout', '-qb', 'feature/pass-retains-convergence');
    await writeFile(join(dir, 'feature.txt'), 'feature\n');
    await git(dir, 'add', 'feature.txt');
    await git(dir, 'commit', '-qm', 'feature');
    await seedThroughBuildReview(statePath);

    await writeKickbackLedger(dir, {
      version: 1,
      gates: {
        build_review: {
          count: 1,
          cumulative: MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW,
          treeHash: await git(dir, 'rev-parse', 'HEAD^{tree}'),
          lastReason: 'fifth consumed review kickback',
          priorVerdict: false,
          resolvedBefore: 1,
        },
      },
    });

    let reviewRuns = 0;
    let buildRuns = 0;
    let manualTestRuns = 0;
    const runner: StepRunner = {
      run: async (step): Promise<StepRunResult> => {
        if (step === 'build_review') {
          reviewRuns += 1;
          await writeFile(
            join(pipelineDir, 'build-review.json'),
            reviewRuns === 1 ? passVerdict : failVerdict,
          );
          return { success: true };
        }
        if (step === 'manual_test') {
          manualTestRuns += 1;
          await writeFile(
            join(pipelineDir, 'manual-test-results.md'),
            '# Results\n\n| Story | Result |\n|---|---|\n| downstream regression | FAIL |\n',
          );
          return { success: true };
        }
        if (step === 'build') {
          buildRuns += 1;
          if (buildRuns > 1) {
            return {
              success: false,
              output: 'sentinel: cumulative halt did not stop a second rebuild',
            };
          }
          await writeFile(join(dir, 'work.txt'), `repair ${buildRuns}\n`);
          await writeFile(
            join(pipelineDir, 'task-status.json'),
            JSON.stringify({ tasks: [{ id: '1', status: 'completed' }] }),
          );
          await git(dir, 'add', 'work.txt');
          await git(dir, 'commit', '-qm', `repair ${buildRuns}`);
          return { success: true };
        }
        return { success: false, output: `unexpected dispatch: ${step}` };
      },
      resetSession: async () => {},
    };

    const haltReasons: string[] = [];
    const events = new ConductorEventEmitter();
    events.on('loop_halt', (event) => {
      if (event.type === 'loop_halt') haltReasons.push(event.reason);
    });

    const options: ConductorOptions = {
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      fromStep: 'build_review',
      verifyArtifacts: true,
      maxRetries: 1,
      config: {
        build_review: { enabled: true },
        kickback_escalation: { enabled: false },
      },
      fullSuiteVerifier: {
        ensure: async () => ({ status: 'REUSED', evidence: {} as never }),
        inspect: async () => ({ status: 'CURRENT', evidence: {} as never }),
      },
      git: async (args) => {
        if (args[0] === 'rev-parse' && args.includes('@{u}')) {
          return { stdout: 'refs/remotes/origin/main' };
        }
        return { stdout: '' };
      },
      shipmentEvidence: async (input: ShipmentEvidenceInput) => ({
        kind: 'valid',
        slug: input.slug,
        pr: input.implementationPr,
        recordPath: `.docs/shipped/${input.slug}.md`,
        hash: 'fixture-hash',
        commit: input.candidateCommit,
      }),
    };

    await new Conductor(options).run();

    expect(reviewRuns).toBe(2);
    expect(manualTestRuns).toBe(1);
    expect(buildRuns).toBe(1);
    expect(await readHaltClass(dir)).toBe('needs-human');
    expect(haltReasons).toHaveLength(1);
    expect(haltReasons[0]).toContain('build_review');
    expect(haltReasons[0]).toContain(String(MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW + 1));
    expect(haltReasons[0]).toContain(String(MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW));
    await expect(readKickbackLedger(dir)).resolves.toMatchObject({
      gates: {
        build_review: {
          cumulative: MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW + 1,
        },
      },
    });
    await expect(readFile(join(pipelineDir, 'HALT'), 'utf-8')).resolves.toContain(
      'build_review cumulative kickback cap exceeded',
    );
  }, 60_000);
});
