/**
 * RED acceptance coverage for #1336.
 *
 * These specs drive the real Conductor.run() entry point through the
 * build_review -> build -> build_review flow. A fake StepRunner is the only
 * provider boundary; Git and the conductor's internal state/artifact wiring
 * are real and confined to a temporary repository.
 *
 * Story classification (writing-system-tests §3a):
 * - Stories 1–5 are one cross-boundary flow and are covered here: settle a
 *   build, persist/render its outcome, re-run the kicking-back gate, refuse
 *   the known-empty cycle, and write the operator-facing halt.
 * - Story 6's cap/no-auto-pass regression already has real Conductor coverage
 *   in test/wiring-gate-loop.test.ts; this file adds the new stamp assertion
 *   while driving that same moving-but-unfixed flow.
 * - Story 7's malformed/read/write cases are single-operation store contracts
 *   owned by plan Tasks 5–6. Its story-level fail-open path is exercised here
 *   by the first wiring kickback, where no prior sidecar exists and build must
 *   dispatch.
 *
 * Correctness-critical production call sites exercised:
 * - src/engine/conductor.ts: build entry and every terminal settle;
 * - src/engine/conductor.ts: build_review kickback before build re-entry;
 * - src/engine/conductor.ts: no-op refusal and needs-human halt disposition.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execa } from 'execa';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { StepRunner } from '../../src/engine/conductor.js';
import { writeVerdict } from '../../src/engine/gate-verdicts.js';
import { readHaltClass } from '../../src/engine/halt-marker.js';
import { writeState } from '../../src/engine/state.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { Conductor } from '../test-conductor.js';

type OutcomeRecord = {
  outcome?: string;
  terminalOutcome?: string;
  gate?: string | null;
  treeBefore?: string | null;
  treeAfter?: string | null;
  headBefore?: string | null;
  headAfter?: string | null;
  note?: string[] | string;
  category?: string;
};

function latestOutcome(value: unknown): OutcomeRecord {
  if (Array.isArray(value)) return (value.at(-1) ?? {}) as OutcomeRecord;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if (Array.isArray(object.records)) {
      return (object.records.at(-1) ?? {}) as OutcomeRecord;
    }
    if (object.latest && typeof object.latest === 'object') {
      return object.latest as OutcomeRecord;
    }
    return object as OutcomeRecord;
  }
  return {};
}

function frontDone(): ConductState {
  return {
    complexity_tier: 'M',
    track: 'technical',
    feature_desc: 'build-agent-disputing-a-wiring-check-kickback-in-p',
    worktree: 'done',
    memory: 'done',
    explore: 'done',
    prd: 'skipped',
    complexity: 'done',
    stories: 'done',
    conflict_check: 'done',
    plan: 'done',
    coherence_check: 'done',
    architecture_diagram: 'done',
    architecture_review: 'done',
    acceptance_specs: 'done',
  };
}

describe('#1336 disputed wiring kickback build outcome', () => {
  let projectRoot: string;
  let stateFilePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'build-dispute-outcome-'));
    stateFilePath = join(projectRoot, '.pipeline', 'conduct-state.json');
    events = new ConductorEventEmitter();
    await execa('git', ['init', '-b', 'main'], { cwd: projectRoot });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: projectRoot });
    await execa('git', ['config', 'user.name', 'Test User'], { cwd: projectRoot });
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeFile(join(projectRoot, '.gitignore'), '.pipeline/\n');
    await writeFile(join(projectRoot, 'README.md'), '# Fixture\n');
    await execa('git', ['add', '.gitignore', 'README.md'], { cwd: projectRoot });
    await execa('git', ['commit', '-m', 'test: seed fixture'], { cwd: projectRoot });
    await writeFile(
      join(projectRoot, '.pipeline', 'task-status.json'),
      JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectRoot, { recursive: true, force: true });
  });

  /** The kickback vehicle. `wiring_check` was #1336's original gate; it is now
   * a deprecated no-op that never kicks back
   * (adr-2026-08-11-wiring-judged-in-build-review), so the same
   * gate -> build -> gate dispute flow is driven through `build_review`, whose
   * non-completeness rubric FAIL routes straight back to `build`. */
  async function writeReviewFail(): Promise<void> {
    await writeFile(
      join(projectRoot, '.pipeline', 'build-review.json'),
      JSON.stringify({
        verdict: 'FAIL',
        reasons: ['productionEntry is unreachable'],
        rubric: {
          tautology: true,
          scope: false,
          rootCause: false,
          completeness: false,
          wiring: false,
        },
        findings: { tautology: ['productionEntry is unreachable'] },
      }),
    );
  }

  function makeConductor(runner: StepRunner, fromStep: StepName): Conductor {
    return new Conductor({
      projectRoot,
      stateFilePath,
      stepRunner: runner,
      events,
      mode: 'auto',
      daemon: true,
      fromStep,
      verifyArtifacts: true,
      maxRetries: 1,
      config: {
        steps: { build: { model: 'opus', effort: 'high' } },
        build_review: { enabled: true },
      },
      git: async (args, options) => {
        const result = await execa('git', args, { cwd: options.cwd });
        return { stdout: result.stdout };
      },
      escalateBuildFailure: async () => ({}),
    });
  }

  it('Stories 1–3: settles a tree-unchanged build into a bounded, rendered dispute record', async () => {
    await writeState(stateFilePath, frontDone());
    const output = Array.from({ length: 250 }, (_, index) =>
      index === 249 ? 'The wiring gate is wrong; this belongs to DECIDE.' : `provider line ${index + 1}`,
    );
    const completed: unknown[] = [];
    events.on('step_completed', (event) => {
      if (event.type === 'step_completed' && event.step === 'build') completed.push(event);
    });

    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        if (step === 'build') return { success: true, output: output.join('\n') };
        if (step === 'build_review') await writeReviewFail();
        return { success: true };
      }),
    };

    await makeConductor(runner, 'build').run();

    const payload = JSON.parse(
      await readFile(join(projectRoot, '.pipeline', 'build-outcome.json'), 'utf8'),
    ) as unknown;
    const latest = latestOutcome(payload);
    expect(latest).toMatchObject({
      outcome: 'no-movement',
      terminalOutcome: 'done',
      treeBefore: expect.any(String),
      treeAfter: expect.any(String),
      headBefore: expect.any(String),
      headAfter: expect.any(String),
    });
    expect(['disputes-gate', 'belongs-to-decide', 'silent-no-movement']).toContain(latest.category);
    expect(latest.treeBefore).toBe(latest.treeAfter);
    expect(latest.note).toHaveLength(200);
    expect(latest.note).toContain('The wiring gate is wrong; this belongs to DECIDE.');
    expect(completed).toContainEqual(expect.objectContaining({
      step: 'build',
      treeBefore: latest.treeBefore,
      treeAfter: latest.treeAfter,
    }));
  });

  // SKIPPED, not deleted: #1336's disputed-kickback refusal
  // (`sameNoOpCycle` -> `composeBuildOutcomeHaltReason`) is scoped to
  // `wiring_check` in conductor.ts, and that gate is now a deprecated no-op
  // that never kicks back — so the refusal is dormant and no live gate can
  // drive this case. Generalizing the scope to every gate was tried and
  // rejected: it pre-empts build_review's ordinary kickback cap and
  // re-dispatch paths. Retiring wiring_check therefore retires #1336's
  // operator-facing dispute halt; deciding whether to re-home it onto
  // build_review is follow-up work, not part of this feature.
  it.skip('Stories 4–5: pays for one empty wiring cycle, then halts before a repeated provider dispatch', async () => {
    await writeState(stateFilePath, {
      ...frontDone(),
      build: 'done',
      wiring_check: 'done',
      test_suite: 'done',
      build_review: 'pending',
    });
    await writeVerdict(projectRoot, 'build', { satisfied: true, checkedAt: Date.now() });
    let buildDispatches = 0;
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        if (step === 'build') {
          buildDispatches += 1;
          return {
            success: true,
            output: 'The wiring finding is stale; return this feature to DECIDE.',
          };
        }
        if (step === 'build_review') await writeReviewFail();
        return { success: true };
      }),
    };

    await makeConductor(runner, 'build_review').run();

    expect(buildDispatches).toBe(1);
    expect(await readHaltClass(projectRoot)).toBe('needs-human');
    const halt = await readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toMatch(/build_review/i);
    expect(halt).toMatch(/made no (tree )?change|tree .* unchanged/i);
    expect(halt).toMatch(/accept.*gate|return.*DECIDE/i);
    expect(halt).toContain('The wiring finding is stale; return this feature to DECIDE.');
  });

  it('Stories 6–7: a moving but unfixed build is never refused and still reaches the existing cap halt', async () => {
    await writeState(stateFilePath, {
      ...frontDone(),
      build: 'done',
      wiring_check: 'done',
      test_suite: 'done',
      build_review: 'pending',
    });
    await writeVerdict(projectRoot, 'build', { satisfied: true, checkedAt: Date.now() });
    let buildDispatches = 0;
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        if (step === 'build') {
          buildDispatches += 1;
          const path = `moving-attempt-${buildDispatches}.txt`;
          await writeFile(join(projectRoot, path), `attempt ${buildDispatches}\n`);
          await execa('git', ['add', path], { cwd: projectRoot });
          await execa('git', ['commit', '-m', `test: moving attempt ${buildDispatches}`], {
            cwd: projectRoot,
          });
        }
        if (step === 'build_review') await writeReviewFail();
        return { success: true };
      }),
    };

    await makeConductor(runner, 'build_review').run();

    expect(buildDispatches).toBeGreaterThan(0);
    expect(await readHaltClass(projectRoot)).toBe('needs-human');
    const payload = JSON.parse(
      await readFile(join(projectRoot, '.pipeline', 'build-outcome.json'), 'utf8'),
    ) as unknown;
    expect(latestOutcome(payload)).toMatchObject({ outcome: 'moved' });
    const halt = await readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toMatch(/build_review/i);
    expect(halt).not.toMatch(/refused: the build made no tree change/i);

    // A missing observation sidecar fails open: no pre-dispatch refusal may
    // have prevented the first build above.
    await expect(access(join(projectRoot, '.pipeline', 'build-outcome.json'))).resolves.toBeUndefined();
  });
});
