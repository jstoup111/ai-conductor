// Covers: task:2, task:3, task:4
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { Conductor } from './test-conductor.js';
import { readState, writeState } from '../src/engine/state.js';
import type { StepRunner } from '../src/engine/conductor.js';
import type { ConductState, StepName } from '../src/types/index.js';
import { ConductorEventEmitter } from '../src/ui/events.js';

const MANUAL_TEST_FAIL = '# Results\n\n| Story | Result |\n|--|--|\n| s1 | FAIL |\n';
const MANUAL_TEST_PASS = '# Results\n\n| Story | Result |\n|--|--|\n| s1 | PASS |\n';
const PRD_AUDIT_GAP = [
  '| FR | Verdict | Gap-class | Evidence | Accepted? |',
  '|--|--|--|--|--|',
  '| FR-1 | MISSING | impl-gap | feature.ts:1 | no |',
].join('\n');
const PRD_AUDIT_PASS = [
  '| FR | Verdict | Gap-class | Evidence | Accepted? |',
  '|--|--|--|--|--|',
  '| FR-1 | ALIGNED | | feature.ts:1 | yes |',
].join('\n');

describe('manual_test FAIL kickback restage', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function runFailKickback(
    restageState: 'failed' | 'skipped',
  ): Promise<{ state: ConductState; restageChanges: Record<string, unknown> }> {
    const dir = await mkdtemp(join(tmpdir(), 'manual-test-kickback-'));
    dirs.push(dir);
    const statePath = join(dir, '.pipeline', 'conduct-state.json');
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeState(statePath, {
      worktree: 'done', memory: 'done', explore: 'done', complexity: 'done', prd: 'done',
      stories: 'done', conflict_check: 'done', plan: 'done', coherence_check: 'done',
      architecture_diagram: 'done', architecture_review: 'done', acceptance_specs: 'done',
      build: 'done', build_review: 'done', wiring_check: 'skipped', test_suite: 'done',
      manual_test: 'pending', prd_audit: 'skipped', architecture_review_as_built: 'skipped',
      rebase: 'skipped', finish: 'pending', track: 'technical',
    } as ConductState);

    const runner: StepRunner = {
      run: async (step: StepName) => {
        if (step === 'manual_test') {
          await writeFile(join(dir, '.pipeline', 'manual-test-results.md'), MANUAL_TEST_FAIL);
          return { success: false, output: 'manual test failed' };
        }
        throw new Error(`unexpected dispatch: ${step}`);
      },
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      fromStep: 'manual_test',
      mode: 'auto',
      daemon: true,
      maxRetries: 1,
    });

    // A skipped member cannot normally dispatch, so model the controlled
    // interleaving at the incident seam: immediately after its real rewind,
    // make the status skipped before the explicit restage commit runs.
    const originalNavigate = (conductor as any).navigateStateBack.bind(conductor);
    (conductor as any).navigateStateBack = async (...args: unknown[]) => {
      const index = await originalNavigate(...args);
      if (restageState === 'skipped') {
        (args[0] as Record<string, unknown>).manual_test = 'skipped';
        await writeState(statePath, args[0] as ConductState);
        (conductor as any).persistedStateSnapshot = { ...(args[0] as ConductState) };
      }
      return index;
    };

    let restageChanges: Record<string, unknown> | undefined;
    const originalCommit = (conductor as any).commitStateChanges.bind(conductor);
    (conductor as any).commitStateChanges = async (...args: unknown[]) => {
      if (args[1] === 'restage manual_test after BUILD kickback') {
        restageChanges = { ...(args[2] as Record<string, unknown>) };
      }
      return originalCommit(...args);
    };

    await conductor.run();
    const state = await readState(statePath);
    if (!state.ok) throw new Error('kickback state must be readable');
    if (!restageChanges) throw new Error('manual_test kickback restage must occur');
    return { state: state.value, restageChanges };
  }

  it('restages a failed manual_test after its FAIL kickback', async () => {
    const result = await runFailKickback('failed');
    expect(result.restageChanges).toMatchObject({ manual_test: 'stale' });
    expect(result.state.manual_test).toBe('stale');
  });

  it('preserves a skipped manual_test at the same FAIL kickback restage site', async () => {
    const result = await runFailKickback('skipped');
    expect(result.restageChanges).not.toHaveProperty('manual_test');
    expect(result.state.manual_test).toBe('skipped');
  });
});

describe('validation-group kickback restages', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function runValidationKickback(input: {
    manualTest: 'FAIL' | 'PASS';
    gapMembers: StepName[];
    skippedAfterNavigation?: StepName;
  }): Promise<{ state: ConductState; restageChanges: Record<string, unknown> }> {
    const dir = await mkdtemp(join(tmpdir(), 'validation-kickback-'));
    dirs.push(dir);
    const statePath = join(dir, '.pipeline', 'conduct-state.json');
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeState(statePath, {
      worktree: 'done', memory: 'done', explore: 'done', complexity: 'done', prd: 'done',
      stories: 'done', conflict_check: 'done', plan: 'done', coherence_check: 'done',
      architecture_diagram: 'done', architecture_review: 'done', acceptance_specs: 'done',
      build: 'done', build_review: 'done', wiring_check: 'skipped', test_suite: 'done',
      manual_test: 'pending', prd_audit: 'pending', architecture_review_as_built: 'pending',
      rebase: 'skipped', finish: 'pending', track: 'product', complexity_tier: 'M',
    } as ConductState);
    await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
    await mkdir(join(dir, '.docs', 'stories'), { recursive: true });
    await mkdir(join(dir, '.docs', 'specs'), { recursive: true });
    const planPath = join(dir, '.docs', 'plans', 'validation-kickback.md');
    await Promise.all([
      writeFile(planPath, '### Task 1: Repair the validation gap\n\n**Criterion:** S1.1\n'),
      writeFile(join(dir, '.docs', 'stories', 'validation-kickback.md'), '## Story 1\n\n### Happy Path\n\n- The repair succeeds.\n'),
      writeFile(join(dir, '.docs', 'specs', 'validation-kickback.md'), '## Functional Requirements\n\n- **FR-1:** The repair succeeds.\n'),
      writeFile(join(dir, '.pipeline', 'engine-state.json'), JSON.stringify({ activePlanPath: planPath })),
    ]);

    const runner: StepRunner = {
      run: async (step: StepName) => {
        if (step === 'manual_test') {
          await writeFile(
            join(dir, '.pipeline', 'manual-test-results.md'),
            input.manualTest === 'FAIL' ? MANUAL_TEST_FAIL : MANUAL_TEST_PASS,
          );
        } else if (step === 'prd_audit') {
          await writeFile(
            join(dir, '.pipeline', 'prd-audit.md'),
            input.gapMembers.includes('prd_audit') ? PRD_AUDIT_GAP : PRD_AUDIT_PASS,
          );
        } else if (step === 'architecture_review_as_built') {
          await writeFile(join(dir, '.pipeline', 'architecture-review-as-built.md'), [
            '# As-Built Architecture Review', '',
            input.gapMembers.includes('architecture_review_as_built') ? 'Verdict: BLOCKED\n\n## Blocking Findings\n| Finding | Class | Governing clause | Summary |\n| --- | --- | --- | --- |\n| ARCH-1 | REMEDIABLE | Task 1 | Missing guard |' : '**Verdict:** APPROVED',
          ].join('\n'));
        } else if (step === 'build') {
          return { success: false, error: 'stop after restage observation' };
        }
        return { success: true };
      },
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      fromStep: 'manual_test',
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 1,
    });

    (conductor as any).planRemediation = async () => ({
      kind: 'route', target: 'build', evidence: 'validated gap', hint: 'repair the gap',
    });
    const originalNavigate = (conductor as any).navigateStateBack.bind(conductor);
    (conductor as any).navigateStateBack = async (...args: unknown[]) => {
      const index = await originalNavigate(...args);
      const state = args[0] as ConductState;
      if (input.skippedAfterNavigation) {
        state[input.skippedAfterNavigation] = 'skipped';
        await writeState(statePath, state);
        (conductor as any).persistedStateSnapshot = { ...state };
      }
      return index;
    };
    let restagedState: ConductState | undefined;
    let restageChanges: Record<string, unknown> | undefined;
    const restageName = input.manualTest === 'FAIL'
      ? 'restage validation group after kickback'
      : 'restage validation gaps after kickback';
    const originalCommit = (conductor as any).commitStateChanges.bind(conductor);
    (conductor as any).commitStateChanges = async (...args: unknown[]) => {
      if (args[1] === restageName) {
        restageChanges = { ...(args[2] as Record<string, unknown>) };
      }
      await originalCommit(...args);
      if (args[1] === restageName) {
        restagedState = { ...(args[0] as ConductState) };
      }
    };

    await conductor.run();
    if (!restagedState) throw new Error('validation kickback restage must occur');
    if (!restageChanges) throw new Error('validation kickback restage changes must be captured');
    return { state: restagedState, restageChanges };
  }

  it('preserves the skipped manual-test member while restaging the done gap member after a consolidated kickback', async () => {
    const result = await runValidationKickback({
      manualTest: 'FAIL', gapMembers: ['prd_audit'], skippedAfterNavigation: 'manual_test',
    });
    expect(result.restageChanges).toMatchObject({ prd_audit: 'stale' });
    expect(result.restageChanges).not.toHaveProperty('manual_test');
    expect([result.state.manual_test, result.state.prd_audit]).toEqual(['skipped', 'stale']);
  });

  it('restages the ran validation gap member', async () => {
    const result = await runValidationKickback({
      manualTest: 'PASS', gapMembers: ['prd_audit'],
    });
    expect(result.restageChanges).toMatchObject({ prd_audit: 'stale' });
    expect(result.state.prd_audit).toBe('stale');
  });

  it('preserves a skipped validation gap member', async () => {
    const result = await runValidationKickback({
      manualTest: 'PASS', gapMembers: ['prd_audit'], skippedAfterNavigation: 'prd_audit',
    });
    expect(result.restageChanges).not.toHaveProperty('prd_audit');
    expect(result.state.prd_audit).toBe('skipped');
  });
});

describe('build_review kickback restage', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function runBuildReviewKickback(
    manualTest: 'skipped' | 'done',
  ): Promise<{ state: ConductState; restageChanges: Record<string, unknown> }> {
    const dir = await mkdtemp(join(tmpdir(), 'build-review-kickback-'));
    dirs.push(dir);
    const statePath = join(dir, '.pipeline', 'conduct-state.json');
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeState(statePath, {
      run_started_at: 1,
      complexity_tier: 'S',
      track: 'technical',
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      prd: 'done',
      stories: 'done',
      conflict_check: 'skipped',
      plan: 'done',
      architecture_diagram: 'skipped',
      architecture_review: 'skipped',
      acceptance_specs: 'skipped',
      build: 'done',
      wiring_check: 'skipped',
      test_suite: 'done',
      build_review: 'pending',
      manual_test: manualTest,
    } as ConductState);
    await writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({
      tasks: [{ id: '1', status: 'completed' }],
    }));

    const runner: StepRunner = {
      run: async (step) => {
        if (step === 'build_review') {
          await writeFile(join(dir, '.pipeline', 'build-review.json'), JSON.stringify({
            verdict: 'FAIL',
            rubric: { testQuality: true },
            findings: { testQuality: ['restage required'] },
          }));
          return { success: true };
        }
        if (step === 'build') throw new Error('stop after build_review restage');
        throw new Error(`unexpected dispatch: ${step}`);
      },
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      fromStep: 'build_review',
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 1,
      config: {
        build_review: { enabled: true },
        kickback_escalation: { enabled: false },
        cumulative_kickback_bound: { enabled: false },
      },
    } as never);

    let restageChanges: Record<string, unknown> | undefined;
    const originalCommit = (conductor as any).commitStateChanges.bind(conductor);
    (conductor as any).commitStateChanges = async (...args: unknown[]) => {
      if (args[1] === 'restage BUILD review after kickback') {
        restageChanges = { ...(args[2] as Record<string, unknown>) };
      }
      return originalCommit(...args);
    };

    await conductor.run().catch((error: unknown) => {
      if (!(error instanceof Error) || error.message !== 'stop after build_review restage') throw error;
    });
    const state = await readState(statePath);
    if (!state.ok) throw new Error('build_review kickback state must be readable');
    if (!restageChanges) throw new Error('build_review kickback restage must occur');
    return { state: state.value, restageChanges };
  }

  it('preserves skipped manual_test while restaging build_review through its kickback site', async () => {
    const result = await runBuildReviewKickback('skipped');

    expect(result.restageChanges).toMatchObject({ build_review: 'stale' });
    expect(result.restageChanges).not.toHaveProperty('manual_test');
    expect(result.state).toMatchObject({ build_review: 'stale', manual_test: 'skipped' });
  });

  it('restages a ran manual_test through the same build_review kickback site', async () => {
    const result = await runBuildReviewKickback('done');

    expect(result.restageChanges).toMatchObject({ build_review: 'stale', manual_test: 'stale' });
    expect(result.state).toMatchObject({ build_review: 'stale', manual_test: 'stale' });
  });
});
