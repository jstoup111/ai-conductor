/**
 * RED acceptance coverage for #1652.
 *
 * Distinct externally observable flow:
 * - Stories 3, 4, and 6: four consumed build_review FAILs from the same rubric
 *   stop before a fourth rebuild, persist a needs-human halt that names what
 *   repeated, and leave enough kickback/loop_halt events to reconstruct the
 *   repetition without reading the worktree's kickback ledger.
 *
 * Stories 1, 2, and 5 and the remaining negative permutations are assigned
 * to the lower-layer tests in plan Tasks 2, 4, 6, 7, 9, and 11-15. This spec
 * drives Conductor.run() because only the real FAIL routing path composes
 * verdict consumption, changing-tree kickbacks, durable tally state, halt
 * classification, and event persistence. The StepRunner and aggregate
 * verifier are deterministic process/third-party boundary fakes; local Git,
 * conductor state, ledger writes, halt writes, and the event spine are real.
 *
 * Correctness-critical production call site exercised:
 * - src/engine/conductor.ts: build_review FAIL routing and kickback consumption.
 */

import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { Conductor } from '../../src/engine/conductor.js';
import type { ConductorOptions, StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { startFeatureEventPersistence } from '../../src/engine/event-persister.js';
import { readHaltClass } from '../../src/engine/halt-marker.js';
import { readKickbackLedger } from '../../src/engine/kickback-ledger.js';
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
  const dir = await mkdtemp(join(tmpdir(), 'build-review-rubric-repeat-'));
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
  state.feature_desc = 'the-engine-cannot-detect-its-own-spinning-operator';
  state.track = 'technical';
  state.architecture_review = 'skipped';
  state.run_started_at = Date.now();
  await writeState(statePath, state as unknown as ConductState);
}

const repeatedCompletenessFailure = JSON.stringify({
  verdict: 'FAIL',
  reasons: ['completeness: src/engine/conductor.ts still permits another rubric-failure lap'],
  findings: {
    completeness: ['src/engine/conductor.ts still permits another rubric-failure lap'],
  },
  rubric: {
    tautology: false,
    scope: false,
    rootCause: false,
    completeness: true,
    wiring: false,
  },
});

type PersistedEvent = Record<string, unknown> & { type: string };

function parseJsonLines(contents: string): PersistedEvent[] {
  return contents
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as PersistedEvent);
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('acceptance: repeated rubric failures short-circuit build_review (#1652 Stories 3, 4, 6)', () => {
  it('halts on the fourth completeness failure and persists the repetition diagnosis', async () => {
    const dir = await initRepo();
    const pipelineDir = join(dir, '.pipeline');
    const statePath = join(pipelineDir, 'conduct-state.json');
    await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
    await mkdir(pipelineDir, { recursive: true });
    await writeFile(
      join(dir, '.docs', 'plans', 'the-engine-cannot-detect-its-own-spinning-operator.md'),
      '# Plan\n\n### Task 1: stop repeated rubric failures\n',
    );
    await writeFile(join(dir, '.gitignore'), '.pipeline/\n');
    await writeFile(join(dir, 'work.txt'), 'base\n');
    await git(dir, 'add', '.');
    await git(dir, 'commit', '-qm', 'base');
    await git(dir, 'checkout', '-qb', 'feature/rubric-repetition');
    await writeFile(join(dir, 'feature.txt'), 'feature\n');
    await git(dir, 'add', 'feature.txt');
    await git(dir, 'commit', '-qm', 'feature');
    await seedThroughBuildReview(statePath);

    let reviewRuns = 0;
    let buildRuns = 0;
    const runner: StepRunner = {
      run: async (step): Promise<StepRunResult> => {
        if (step === 'build_review') {
          reviewRuns += 1;
          await writeFile(join(pipelineDir, 'build-review.json'), repeatedCompletenessFailure);
          return { success: true, output: 'faithful failing completeness verdict' };
        }
        if (step === 'build') {
          buildRuns += 1;
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

    const persistence = startFeatureEventPersistence(dir, new ConductorEventEmitter());
    const options: ConductorOptions = {
      stateFilePath: statePath,
      stepRunner: runner,
      events: persistence.events,
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

    try {
      await new Conductor(options).run();
    } finally {
      persistence.stop();
    }

    expect(reviewRuns).toBe(4);
    expect(buildRuns).toBe(3);
    expect(await readHaltClass(dir)).toBe('needs-human');
    await expect(readKickbackLedger(dir)).resolves.toMatchObject({
      gates: {
        build_review: {
          cumulative: 4,
          rubricFailures: { completeness: 4 },
        },
      },
    });

    const haltReason = await readFile(join(pipelineDir, 'HALT'), 'utf-8');
    expect(haltReason).toContain('completeness');
    expect(haltReason).toContain('4');
    expect(haltReason).toContain('src/engine/conductor.ts');

    const events = parseJsonLines(await readFile(join(pipelineDir, 'events.jsonl'), 'utf-8'));
    expect(events.filter((event) => event.type === 'kickback').map((event) => event.rubricFailures)).toEqual([
      { completeness: 1 },
      { completeness: 2 },
      { completeness: 3 },
    ]);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'loop_halt',
      reason: expect.stringContaining('completeness'),
    }));
  });
});
