// Covers: task:2, task:3, task:4, task:5, task:6
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import {
  countResolvedTasks,
  resolveTaskIds,
  resolveTaskIdsWithDiagnostics,
  openRepairForTask,
  completeTaskDoneWhen,
  haltMarkerExists,
  clearHaltMarker,
  haltMarkerPath,
  readHaltMarkerContent,
  writeStallQuestionEvidence,
  writeStallHalt,
  HALT_MARKER_RELATIVE,
} from '../../src/engine/task-progress.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import {
  detectTaskCommand,
  dispatchTaskCommand,
  runTaskStart,
} from '../../src/engine/task-cli.js';
import { checkStepCompletion } from '../../src/engine/artifacts.js';
import { createRepairObligationStore, taskObligationStanding } from '../../src/engine/repair-obligations.js';
import { makeGitRunner, performRebase } from '../../src/engine/rebase.js';
import { translateAfterRebase } from '../../src/engine/rebase-translate.js';

describe('task-progress', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'task-progress-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('countResolvedTasks', () => {
    it('returns 0 when .pipeline/task-status.json is absent', async () => {
      const count = await countResolvedTasks(dir);
      expect(count).toBe(0);
    });

    it('returns 0 when the file is not valid JSON', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/task-status.json'), 'not json');
      expect(await countResolvedTasks(dir)).toBe(0);
    });

    it('counts completed + skipped tasks in the array shape', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: [
            { id: 1, status: 'completed' },
            { id: 2, status: 'completed' },
            { id: 3, status: 'skipped' },
            { id: 4, status: 'pending' },
            { id: 5, status: 'in_progress' },
          ],
        }),
      );
      expect(await countResolvedTasks(dir)).toBe(3);
    });

    it('counts completed + skipped tasks in the id-keyed map shape', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: {
            '1': { status: 'completed' },
            '2': { status: 'pending' },
            '3': { status: 'skipped' },
            '4': { status: 'completed' },
          },
        }),
      );
      expect(await countResolvedTasks(dir)).toBe(3);
    });

    it('returns 0 when the tasks field is missing or empty', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ plan_ref: 'foo' }),
      );
      expect(await countResolvedTasks(dir)).toBe(0);
    });

    it('#757: counts distinct plan task-ids carried by Task: trailers on the branch, not via the deleted derivation engine', async () => {
      // Set up a real git repo (no `.pipeline/task-status.json`-side status
      // flip involved — this proves the count is sourced from commit
      // trailers directly, per feature #773 Task 15).
      await execa('git', ['init', '-b', 'main'], { cwd: dir });
      await execa('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
      await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });

      await mkdir(join(dir, '.pipeline'), { recursive: true });
      // 4 plan tasks, all still `pending` in task-status.json — i.e. nothing
      // here would count under the old completed/skipped-only logic.
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: [
            { id: '1', status: 'pending' },
            { id: '2', status: 'pending' },
            { id: '3', status: 'pending' },
            { id: '4', status: 'pending' },
          ],
        }),
      );
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'seed'], { cwd: dir });

      // Task 1 and Task 3 have Task:-trailered commits; Task 2 and 4 do not.
      await writeFile(join(dir, 'a.txt'), 'a');
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'work on task 1\n\nTask: 1'], { cwd: dir });

      await writeFile(join(dir, 'b.txt'), 'b');
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'work on task 3\n\nTask: 3'], { cwd: dir });

      // Only task-ids 1 and 3 are resolved via trailers; 2 and 4 remain
      // untouched pending — expect exactly 2, not 0 (old code) and not 4.
      expect(await countResolvedTasks(dir)).toBe(2);
    });

    it('#773 Task 16: telemetry survives the gating demolition — countResolvedTasks is a pure read with no side effects (no writes, no throw) even against an empty/uninitialized project dir', async () => {
      // Tasks 10-14 deleted the per-task evidence-ledger GATING apparatus
      // (build predicate, citation judge, park counter, reseed/commit-msg
      // rejection). Task 15 repointed this counter at Task: trailers +
      // task-status.json as pure telemetry. This locks in that the read
      // path never mutates project state (no .pipeline writes) and never
      // throws, confirming it cannot itself gate or block a build.
      await expect(countResolvedTasks(dir)).resolves.toBe(0);
      const { readdir } = await import('node:fs/promises');
      await expect(readdir(dir)).resolves.toEqual([]);
    });
  });

  describe('Task 3: countResolvedTasks / resolveTaskIds parity (pre-refactor pin)', () => {
    it('rows-only: pins countResolvedTasks to 3 for 3 completed/skipped rows out of 5', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: [
            { id: '1', status: 'completed' },
            { id: '2', status: 'completed' },
            { id: '3', status: 'skipped' },
            { id: '4', status: 'pending' },
            { id: '5', status: 'in_progress' },
          ],
        }),
      );
      expect(await countResolvedTasks(dir)).toBe(3);
    });

    it('trailers-only: pins countResolvedTasks to 2 when rows are all pending but 2 have Task: trailers', async () => {
      await execa('git', ['init', '-b', 'main'], { cwd: dir });
      await execa('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
      await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });

      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: [
            { id: '1', status: 'pending' },
            { id: '2', status: 'pending' },
            { id: '3', status: 'pending' },
            { id: '4', status: 'pending' },
          ],
        }),
      );
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'seed'], { cwd: dir });

      await writeFile(join(dir, 'a.txt'), 'a');
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'work on task 1\n\nTask: 1'], { cwd: dir });

      await writeFile(join(dir, 'b.txt'), 'b');
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'work on task 3\n\nTask: 3'], { cwd: dir });

      expect(await countResolvedTasks(dir)).toBe(2);
    });

    it('mixed rows + trailers + alias: pins countResolvedTasks to 4 (union of completed/skipped rows and trailer/alias matches)', async () => {
      await execa('git', ['init', '-b', 'main'], { cwd: dir });
      await execa('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
      await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });

      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: [
            { id: '1', status: 'completed' },
            { id: '2', status: 'pending' },
            { id: '3', status: 'pending' },
            { id: '4', status: 'skipped' },
            { id: '5', status: 'pending' },
          ],
        }),
      );
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'seed'], { cwd: dir });

      // trailer-only id (plan id 3, bare trailer)
      await writeFile(join(dir, 'a.txt'), 'a');
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'work on task 3\n\nTask: 3'], { cwd: dir });

      // alias case: plan id 2, trailer "T2"
      await writeFile(join(dir, 'b.txt'), 'b');
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'work on task 2\n\nTask: T2'], { cwd: dir });

      // resolved set should be {1 (completed), 4 (skipped), 3 (trailer), 2 (alias)} = 4
      expect(await countResolvedTasks(dir)).toBe(4);
    });

    it('no-status-file: pins countResolvedTasks to 0 when .pipeline/task-status.json is absent', async () => {
      expect(await countResolvedTasks(dir)).toBe(0);
    });

    it('empty-rows: pins countResolvedTasks to 0 when the tasks field is missing', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ plan_ref: 'foo' }),
      );
      expect(await countResolvedTasks(dir)).toBe(0);
    });
  });

  describe('resolveTaskIds', () => {
    it('resolves completed rows, skipped rows, trailer-only ids, and canonical alias trailers', async () => {
      await execa('git', ['init', '-b', 'main'], { cwd: dir });
      await execa('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
      await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });

      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: [
            { id: '1', status: 'completed' },
            { id: '2', status: 'pending' },
            { id: '3', status: 'pending' },
            { id: '4', status: 'skipped' },
            { id: '5', status: 'pending' },
          ],
        }),
      );
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'seed'], { cwd: dir });

      // trailer-only id (plan id 3, bare trailer)
      await writeFile(join(dir, 'a.txt'), 'a');
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'work on task 3\n\nTask: 3'], { cwd: dir });

      // alias case: plan id 2, trailer "T2"
      await writeFile(join(dir, 'b.txt'), 'b');
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'work on task 2\n\nTask: T2'], { cwd: dir });

      const resolved = await resolveTaskIds(dir, ['1', '2', '3', '4', '5']);

      expect(resolved).toEqual(new Set(['1', '2', '3', '4']));
    });

    it('ignores a phantom Task trailer whose id is not in planIds', async () => {
      await execa('git', ['init', '-b', 'main'], { cwd: dir });
      await execa('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
      await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });

      await writeFile(join(dir, 'a.txt'), 'a');
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'work on task 99\n\nTask: 99'], { cwd: dir });

      const resolved = await resolveTaskIds(dir, ['1', '2', '3', '4', '5']);

      expect(resolved).toEqual(new Set());
    });

    it('degrades to rows-only resolution without throwing when projectRoot is not a git repo', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: [
            { id: '1', status: 'completed' },
            { id: '2', status: 'pending' },
          ],
        }),
      );

      const resolved = await resolveTaskIds(dir, ['1', '2']);

      expect(resolved).toEqual(new Set(['1']));
    });

    it('does not resolve rows with status in_progress or pending', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: [
            { id: '1', status: 'in_progress' },
            { id: '2', status: 'pending' },
          ],
        }),
      );

      const resolved = await resolveTaskIds(dir, ['1', '2']);

      expect(resolved).toEqual(new Set());
    });

    it('normalizes a legacy id-keyed map-shape task-status.json without throwing', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          '1': { status: 'completed' },
          '2': { status: 'pending' },
        }),
      );

      const resolved = await resolveTaskIds(dir, ['1', '2']);

      expect(resolved).toEqual(new Set(['1']));
    });
  });

  describe('current repair freshness', () => {
    type MutableRepairState = {
      repairObligations: { currentByPlan: Record<string, Record<string, string>> };
    };

    async function prepareResolverRepairState(taskRows: Array<{ id: string; status: string }> = [{ id: '2', status: 'completed' }]) {
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.docs', 'plans', 'feature.md'), '# Plan\n');
      await writeFile(join(dir, '.pipeline', 'engine-state.json'), JSON.stringify({
        activePlanPath: '.docs/plans/feature.md',
      }));
      await writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: taskRows }));
      return createRepairObligationStore(dir, join(dir, '.pipeline', 'engine-state.json'));
    }

    async function admitResolverObligation(
      repairs: ReturnType<typeof createRepairObligationStore>,
      id: string,
      authority: 'build_review' | 'prd_audit',
      head: string,
    ) {
      const admitted = await repairs.admitOrReplay(id, {
        id,
        planPath: '.docs/plans/feature.md',
        taskIds: ['2'],
        source: { findingId: id, authority, instruction: 'repair it' },
        baseline: { head, tree: `${id}-tree`, resolvedTaskIds: [] },
      });
      if (!admitted.ok) throw new Error(admitted.message);
      return admitted.obligation;
    }

    it('resolves past an open same-authority obligation superseded by a resolved current obligation', async () => {
      const repairs = await prepareResolverRepairState();
      await admitResolverObligation(repairs, 'older', 'build_review', 'orphaned-boundary');
      const current = await admitResolverObligation(repairs, 'current', 'build_review', 'current-boundary');
      await repairs.close({
        planPath: '.docs/plans/feature.md', taskId: '2', obligationId: current.id,
        evidence: { kind: 'task-done', value: 'current' },
      });

      await expect(resolveTaskIdsWithDiagnostics(dir, ['2'])).resolves.toEqual({
        resolved: new Set(['2']), unavailableReasons: new Map(),
      });
    });

    it('resolves past a superseded obligation after both baseline heads are rewritten', async () => {
      const repairs = await prepareResolverRepairState();
      const older = await admitResolverObligation(repairs, 'older', 'build_review', 'orphaned-boundary');
      const current = await admitResolverObligation(repairs, 'current', 'build_review', 'current-boundary');
      await repairs.close({
        planPath: '.docs/plans/feature.md', taskId: '2', obligationId: current.id,
        evidence: { kind: 'task-done', value: 'current' },
      });
      const rewritten = await repairs.rewriteBaselines(new Map([
        [older.id, 'translated-older'],
        [current.id, 'translated-current'],
      ]));
      expect(rewritten).toEqual({ ok: true, value: { rewritten: [older.id, current.id] } });
      const rewrittenState = await repairs.read();
      if (!rewrittenState.ok) throw new Error(rewrittenState.message);
      expect(taskObligationStanding(rewrittenState.value, current.planIdentity, '2')).toMatchObject({
        kind: 'live',
        current: { id: current.id },
        superseded: [{ id: older.id }],
      });

      const result = await resolveTaskIdsWithDiagnostics(dir, ['2']);
      expect(result.resolved).toEqual(new Set(['2']));
      expect(result.unavailableReasons.has('2')).toBe(false);
    });

    it('keeps a task unresolved when its current same-authority obligation remains open', async () => {
      const repairs = await prepareResolverRepairState();
      await admitResolverObligation(repairs, 'older', 'build_review', 'orphaned-boundary');
      await admitResolverObligation(repairs, 'current', 'build_review', 'current-boundary');

      expect((await resolveTaskIdsWithDiagnostics(dir, ['2'])).resolved).toEqual(new Set());
    });

    it('keeps a task unresolved for an open cross-authority obligation', async () => {
      const repairs = await prepareResolverRepairState();
      await admitResolverObligation(repairs, 'audit', 'prd_audit', 'audit-boundary');
      const current = await admitResolverObligation(repairs, 'current', 'build_review', 'current-boundary');
      await repairs.close({
        planPath: '.docs/plans/feature.md', taskId: '2', obligationId: current.id,
        evidence: { kind: 'task-done', value: 'current' },
      });

      expect((await resolveTaskIdsWithDiagnostics(dir, ['2'])).resolved).toEqual(new Set());
    });

    it.each([
      ['is missing', (state: MutableRepairState) => delete state.repairObligations.currentByPlan['.docs/plans/feature.md']['2']],
      ['names a missing record', (state: MutableRepairState) => { state.repairObligations.currentByPlan['.docs/plans/feature.md']['2'] = 'missing'; }],
    ])('keeps a task unresolved with the current-less reason when its current entry %s', async (_caseName, corrupt) => {
      const repairs = await prepareResolverRepairState();
      await admitResolverObligation(repairs, 'open', 'build_review', 'boundary');
      const state = JSON.parse(await readFile(join(dir, '.pipeline', 'engine-state.json'), 'utf-8')) as MutableRepairState;
      corrupt(state);
      await writeFile(join(dir, '.pipeline', 'engine-state.json'), JSON.stringify(state));

      await expect(resolveTaskIdsWithDiagnostics(dir, ['2'])).resolves.toEqual({
        resolved: new Set(),
        unavailableReasons: new Map([['2', 'repair state is unavailable: task 2 has an open repair obligation but no current obligation is recorded for it']]),
      });
    });

    it('reports no open repair when task 2 only has an open superseded obligation', async () => {
      const repairs = await prepareResolverRepairState();
      await admitResolverObligation(repairs, 'older', 'build_review', 'orphaned-boundary');
      const current = await admitResolverObligation(repairs, 'current', 'build_review', 'current-boundary');
      await repairs.close({
        planPath: '.docs/plans/feature.md', taskId: '2', obligationId: current.id,
        evidence: { kind: 'task-done', value: 'current' },
      });

      await expect(openRepairForTask(dir, '2')).resolves.toEqual({ kind: 'none' });
    });

    it('reports the open current repair instead of its superseded predecessor', async () => {
      const repairs = await prepareResolverRepairState();
      await admitResolverObligation(repairs, 'older', 'build_review', 'orphaned-boundary');
      const current = await admitResolverObligation(repairs, 'current', 'build_review', 'current-boundary');

      await expect(openRepairForTask(dir, '2')).resolves.toEqual({ kind: 'open', obligationId: current.id });
    });

    it.each([
      ['is missing', (state: MutableRepairState) => delete state.repairObligations.currentByPlan['.docs/plans/feature.md']['2']],
      ['names a missing record', (state: MutableRepairState) => { state.repairObligations.currentByPlan['.docs/plans/feature.md']['2'] = 'missing'; }],
    ])('reports a current-less repair as unavailable when its current entry %s', async (_caseName, corrupt) => {
      const repairs = await prepareResolverRepairState();
      await admitResolverObligation(repairs, 'open', 'build_review', 'boundary');
      const state = JSON.parse(await readFile(join(dir, '.pipeline', 'engine-state.json'), 'utf-8')) as MutableRepairState;
      corrupt(state);
      await writeFile(join(dir, '.pipeline', 'engine-state.json'), JSON.stringify(state));

      await expect(openRepairForTask(dir, '2')).resolves.toEqual({
        kind: 'unavailable',
        reason: 'repair state is unavailable: task 2 has an open repair obligation but no current obligation is recorded for it',
      });
    });

    it('preserves legacy completion for unbound tasks and all-resolved obligations without a current entry', async () => {
      const repairs = await prepareResolverRepairState([
        { id: '3', status: 'completed' },
        { id: '4', status: 'completed' },
      ]);
      const admitted = await repairs.admitOrReplay('resolved-4', {
        id: 'resolved-4', planPath: '.docs/plans/feature.md', taskIds: ['4'],
        source: { findingId: 'resolved-4', authority: 'build_review', instruction: 'repair it' },
        baseline: { head: 'boundary', tree: 'tree', resolvedTaskIds: [] },
      });
      if (!admitted.ok) throw new Error(admitted.message);
      await repairs.close({
        planPath: '.docs/plans/feature.md', taskId: '4', obligationId: admitted.obligation.id,
        evidence: { kind: 'task-done', value: 'resolved' },
      });
      const state = JSON.parse(await readFile(join(dir, '.pipeline', 'engine-state.json'), 'utf-8')) as MutableRepairState;
      delete state.repairObligations.currentByPlan['.docs/plans/feature.md']['4'];
      await writeFile(join(dir, '.pipeline', 'engine-state.json'), JSON.stringify(state));

      await expect(resolveTaskIdsWithDiagnostics(dir, ['3', '4'])).resolves.toEqual({
        resolved: new Set(['3', '4']), unavailableReasons: new Map(),
      });
    });

    it('resolves a plan_amendment obligation only from a Task trailer committed after its boundary', async () => {
      await execa('git', ['init', '-b', 'main'], { cwd: dir });
      await execa('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
      await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.docs', 'plans', 'feature.md'), '### Task 7: Repair the close path\n');
      await writeFile(join(dir, '.pipeline', 'engine-state.json'), JSON.stringify({
        activePlanPath: '.docs/plans/feature.md',
      }));
      await writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({
        tasks: [{ id: '7', status: 'completed' }],
      }));
      await writeFile(join(dir, 'original.txt'), 'original\n');
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'original implementation\n\nTask: 7'], { cwd: dir });
      const boundary = (await execa('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim();

      const repairs = createRepairObligationStore(dir, join(dir, '.pipeline', 'engine-state.json'));
      const admitted = await repairs.admitOrReplay('plan-amendment-close-path', {
        id: 'plan-amendment-close-path',
        planPath: '.docs/plans/feature.md',
        taskIds: ['7'],
        source: {
          findingId: 'changed-task-digest',
          authority: 'plan_amendment',
          instruction: 'Re-implement the changed task.',
        },
        baseline: { head: boundary, tree: 'tree', resolvedTaskIds: ['7'] },
      });
      if (!admitted.ok) throw new Error(admitted.message);

      // The completed row and original trailer are both before the amendment boundary.
      expect(await resolveTaskIds(dir, ['7'])).toEqual(new Set());

      await writeFile(join(dir, 'repair.txt'), 'repair\n');
      await execa('git', ['add', 'repair.txt'], { cwd: dir });
      await execa('git', ['commit', '-m', 'repair close path\n\nTask: 7'], { cwd: dir });

      expect(await resolveTaskIds(dir, ['7'])).toEqual(new Set(['7']));
    });

    type TranslatedBoundary = 'direct' | 'successor';

    /**
     * Exercise the production rebase entrypoint: the direct commit survives
     * by patch-id, the absorbed commit becomes residue, and its later
     * first-parent successor survives. The translator must persist the
     * selected boundary before task-progress reads it.
     */
    async function rebaseWithTranslatedBoundary(
      taskId: string,
      boundary: TranslatedBoundary,
    ): Promise<void> {
      await execa('git', ['init', '-b', 'main'], { cwd: dir });
      await execa('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
      await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });
      await execa('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.docs', 'plans', 'feature.md'), '# Plan\n');
      await writeFile(join(dir, '.pipeline', 'engine-state.json'), JSON.stringify({
        activePlanPath: '.docs/plans/feature.md',
      }));
      await writeFile(join(dir, 'base.txt'), 'base\n');
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'base'], { cwd: dir });
      await execa('git', ['checkout', '-q', '-b', 'feature'], { cwd: dir });

      await writeFile(join(dir, 'direct.txt'), 'direct\n');
      await execa('git', ['add', 'direct.txt'], { cwd: dir });
      await execa('git', ['commit', '-m', `direct boundary\n\nTask: ${taskId}`], { cwd: dir });
      const directBoundary = (await execa('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim();

      await writeFile(join(dir, 'absorbed.txt'), 'absorbed\n');
      await execa('git', ['add', 'absorbed.txt'], { cwd: dir });
      await execa('git', ['commit', '-m', 'absorbed boundary'], { cwd: dir });
      const residueBoundary = (await execa('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim();

      await writeFile(join(dir, 'successor.txt'), 'successor\n');
      await execa('git', ['add', 'successor.txt'], { cwd: dir });
      await execa('git', ['commit', '-m', 'surviving successor'], { cwd: dir });

      const repairs = createRepairObligationStore(dir, join(dir, '.pipeline', 'engine-state.json'));
      const admitted = await repairs.admitOrReplay(`translated-${taskId}`, {
        id: `translated-${taskId}`,
        planPath: '.docs/plans/feature.md',
        taskIds: [taskId],
        source: { findingId: `finding-${taskId}`, authority: 'build_review', instruction: 'repair it' },
        baseline: {
          head: boundary === 'direct' ? directBoundary : residueBoundary,
          tree: 'tree',
          resolvedTaskIds: [],
        },
      });
      if (!admitted.ok) throw new Error(admitted.message);

      await execa('git', ['checkout', '-q', 'main'], { cwd: dir });
      await writeFile(join(dir, 'absorbed.txt'), 'absorbed\n');
      await execa('git', ['add', 'absorbed.txt'], { cwd: dir });
      await execa('git', ['commit', '-m', 'upstream absorbs boundary'], { cwd: dir });
      await writeFile(join(dir, 'upstream.txt'), 'advanced\n');
      await execa('git', ['add', 'upstream.txt'], { cwd: dir });
      await execa('git', ['commit', '-m', 'advance base'], { cwd: dir });
      await execa('git', ['checkout', '-q', 'feature'], { cwd: dir });

      const outcome = await performRebase(makeGitRunner(dir), dir, 'main', {
        translateAfterRebase: (runner, root, onto, origHead, head, flatten) =>
          translateAfterRebase(runner, root, onto, origHead, head, undefined, undefined, flatten),
      });
      expect(outcome.kind).toBe('changed');
    }

    it('resolves a direct-translated obligation from a post-boundary Task trailer after a real rebase', async () => {
      await rebaseWithTranslatedBoundary('T1', 'direct');
      await writeFile(join(dir, 'repair.txt'), 'repair\n');
      await execa('git', ['add', 'repair.txt'], { cwd: dir });
      await execa('git', ['commit', '-m', 'repair\n\nTask: T1'], { cwd: dir });

      const resolution = await resolveTaskIdsWithDiagnostics(dir, ['1']);
      expect(resolution.resolved).toEqual(new Set(['1']));
      expect(resolution.unavailableReasons.has('1')).toBe(false);
    }, 20_000);

    it('resolves a successor-translated obligation from a post-boundary Task trailer after a real rebase', async () => {
      await rebaseWithTranslatedBoundary('T2', 'successor');
      await writeFile(join(dir, 'repair.txt'), 'repair\n');
      await execa('git', ['add', 'repair.txt'], { cwd: dir });
      await execa('git', ['commit', '-m', 'repair\n\nTask: T2'], { cwd: dir });

      const resolution = await resolveTaskIdsWithDiagnostics(dir, ['2']);
      expect(resolution.resolved).toEqual(new Set(['2']));
      expect(resolution.unavailableReasons.has('2')).toBe(false);
    }, 20_000);

    it('keeps a trailer at or before a translated boundary unresolved without an unavailable reason', async () => {
      await rebaseWithTranslatedBoundary('T3', 'direct');

      const resolution = await resolveTaskIdsWithDiagnostics(dir, ['3']);
      expect(resolution.resolved).toEqual(new Set());
      expect(resolution.unavailableReasons.has('3')).toBe(false);
    }, 20_000);

    it('keeps pre-reopen trailer and completed-row evidence unresolved at the build boundary', async () => {
      await execa('git', ['init', '-b', 'main'], { cwd: dir });
      await execa('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
      await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.docs', 'plans', 'feature.md'), '### Task 2: repaired task\n');
      await writeFile(join(dir, '.pipeline', 'engine-state.json'), JSON.stringify({
        activePlanPath: '.docs/plans/feature.md',
      }));
      await writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({
        tasks: [{ id: '2', status: 'completed' }],
      }));
      await writeFile(join(dir, 'old.txt'), 'old');
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'old completion\n\nTask: 2'], { cwd: dir });
      const boundary = (await execa('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim();

      const repairs = createRepairObligationStore(dir, join(dir, '.pipeline', 'engine-state.json'));
      const admitted = await repairs.admitOrReplay('key-1', {
        id: 'reopened-round',
        planPath: '.docs/plans/feature.md',
        taskIds: ['T2'],
        source: { findingId: 'finding-1', authority: 'build_review', instruction: 'repair it' },
        baseline: { head: boundary, tree: 'tree-before-reopen', resolvedTaskIds: ['T2'] },
      });
      if (!admitted.ok) throw new Error(admitted.message);

      const completion = await checkStepCompletion(dir, 'build', {
        projectRoot: dir,
        planPath: join(dir, '.docs', 'plans', 'feature.md'),
      });

      expect(completion).toMatchObject({ done: false, reason: expect.stringMatching(/2/) });
    });

    it('accepts a canonical task alias only when its trailer is after the repair boundary', async () => {
      await execa('git', ['init', '-b', 'main'], { cwd: dir });
      await execa('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
      await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline', 'engine-state.json'), JSON.stringify({
        activePlanPath: '.docs/plans/feature.md',
      }));
      await writeFile(join(dir, 'baseline.txt'), 'baseline');
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'baseline\n\nTask: T2'], { cwd: dir });
      const boundary = (await execa('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim();
      const repairs = createRepairObligationStore(dir, join(dir, '.pipeline', 'engine-state.json'));
      await repairs.admitOrReplay('key-2', {
        id: 'post-boundary-round',
        planPath: '.docs/plans/feature.md',
        taskIds: ['T2'],
        source: { findingId: 'finding-2', authority: 'build_review', instruction: 'repair it' },
        baseline: { head: boundary, tree: 'tree', resolvedTaskIds: [] },
      });

      // The pre-boundary alias remains visible to the legacy trailer union,
      // so only current-repair resolution can keep it unresolved here.
      expect(await resolveTaskIds(dir, ['2'])).toEqual(new Set());

      await writeFile(join(dir, 'repair.txt'), 'repair');
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'repair\n\nTask: T2'], { cwd: dir });

      expect(await resolveTaskIds(dir, ['2'])).toEqual(new Set(['2']));
    });

    it('follows a repair boundary the rebase step rewrote through rebase-rewrites.json', async () => {
      // The rebase step replays every branch commit onto a new base and
      // records old→new in .pipeline/rebase-rewrites.json, but the obligation
      // keeps the pre-rebase boundary sha. Without translation the boundary
      // is "not an ancestor of HEAD", the re-opened task can never resolve,
      // and the build stalls on no_task_progress even though the repair
      // commit is on the branch.
      await execa('git', ['init', '-b', 'main'], { cwd: dir });
      await execa('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
      await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline', 'engine-state.json'), JSON.stringify({
        activePlanPath: '.docs/plans/feature.md',
      }));
      await writeFile(join(dir, 'base.txt'), 'base');
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'base'], { cwd: dir });
      await writeFile(join(dir, 'boundary.txt'), 'boundary');
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'boundary\n\nTask: T2'], { cwd: dir });
      const oldBoundary = (await execa('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim();
      const repairs = createRepairObligationStore(dir, join(dir, '.pipeline', 'engine-state.json'));
      await repairs.admitOrReplay('key-rewritten', {
        id: 'rewritten-round',
        planPath: '.docs/plans/feature.md',
        taskIds: ['T2'],
        source: { findingId: 'finding-3', authority: 'build_review', instruction: 'repair it' },
        baseline: { head: oldBoundary, tree: 'tree', resolvedTaskIds: [] },
      });
      await writeFile(join(dir, 'repair.txt'), 'repair');
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'repair\n\nTask: T2'], { cwd: dir });
      expect(await resolveTaskIds(dir, ['2'])).toEqual(new Set(['2']));

      // Simulate the rebase step: rewrite the boundary and repair commits onto
      // an advanced base, and record the boundary hop the way rebase-translate does.
      await execa('git', ['checkout', '-q', '-b', 'newbase', `${oldBoundary}~1`], { cwd: dir });
      await writeFile(join(dir, 'upstream.txt'), 'upstream');
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'upstream change'], { cwd: dir });
      await execa('git', ['checkout', '-q', 'main'], { cwd: dir });
      await execa('git', ['rebase', '-q', 'newbase'], { cwd: dir });
      const newBoundary = (await execa('git', ['rev-parse', 'HEAD~1'], { cwd: dir })).stdout.trim();
      expect(newBoundary).not.toBe(oldBoundary);

      const untranslated = await resolveTaskIdsWithDiagnostics(dir, ['2']);
      expect(untranslated.resolved).toEqual(new Set());
      expect(untranslated.unavailableReasons.get('2')).toContain('not an ancestor of HEAD');

      await writeFile(
        join(dir, '.pipeline', 'rebase-rewrites.json'),
        JSON.stringify({ [oldBoundary]: newBoundary }),
      );
      expect(await resolveTaskIds(dir, ['2'])).toEqual(new Set(['2']));
    });

    it('keeps an open obligation authoritative when engine state records no activePlanPath', async () => {
      // #1831/#2261: a daemon-dispatched feature never runs the plan step that
      // records activePlanPath, so the obligation is keyed by the
      // convention-resolved plan. Reading the repair section through
      // activePlanPath alone reported "no repair state" and let the
      // pre-boundary trailer re-close the re-staged task.
      await execa('git', ['init', '-b', 'main'], { cwd: dir });
      await execa('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
      await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.docs', 'plans', 'feature.md'), '### Task 2: repaired task\n');
      await writeFile(
        join(dir, '.pipeline', 'conduct-state.json'),
        JSON.stringify({ feature_desc: 'feature' }),
      );
      await writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({
        tasks: [{ id: '2', status: 'completed' }],
      }));
      await writeFile(join(dir, 'old.txt'), 'old');
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'old completion\n\nTask: 2'], { cwd: dir });
      const boundary = (await execa('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim();

      const repairs = createRepairObligationStore(dir, join(dir, '.pipeline', 'engine-state.json'));
      const admitted = await repairs.admitOrReplay('key-no-active-plan', {
        id: 'reopened-round',
        planPath: '.docs/plans/feature.md',
        taskIds: ['T2'],
        source: { findingId: 'finding-1', authority: 'build_review', instruction: 'repair it' },
        baseline: { head: boundary, tree: 'tree-before-reopen', resolvedTaskIds: ['T2'] },
      });
      if (!admitted.ok) throw new Error(admitted.message);

      const engineState = JSON.parse(
        await readFile(join(dir, '.pipeline', 'engine-state.json'), 'utf-8'),
      ) as Record<string, unknown>;
      expect(engineState.activePlanPath).toBeUndefined();

      expect(await resolveTaskIds(dir, ['2'])).toEqual(new Set());
    });

    it('refuses the legacy union when obligations exist but no plan resolves', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({
        tasks: [{ id: '2', status: 'completed' }],
      }));
      const repairs = createRepairObligationStore(dir, join(dir, '.pipeline', 'engine-state.json'));
      const admitted = await repairs.admitOrReplay('key-unresolvable-plan', {
        id: 'orphan-round',
        planPath: '.docs/plans/feature.md',
        taskIds: ['2'],
        source: { findingId: 'finding-1', authority: 'build_review', instruction: 'repair it' },
        baseline: { head: 'no-such-commit', tree: 'tree', resolvedTaskIds: [] },
      });
      if (!admitted.ok) throw new Error(admitted.message);

      const resolution = await resolveTaskIdsWithDiagnostics(dir, ['2']);

      expect(resolution.resolved).toEqual(new Set());
      expect(resolution.unavailableReasons.get('2')).toContain('no active plan could be resolved');
    });

    it('leaves the legacy union alone when no obligation has ever been admitted', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline', 'engine-state.json'), JSON.stringify({}));
      await writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({
        tasks: [{ id: '2', status: 'completed' }],
      }));

      expect(await resolveTaskIds(dir, ['2'])).toEqual(new Set(['2']));
    });

    it('retains a persisted current closure when its historical boundary is unavailable', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline', 'engine-state.json'), JSON.stringify({
        activePlanPath: '.docs/plans/feature.md',
      }));
      const repairs = createRepairObligationStore(dir, join(dir, '.pipeline', 'engine-state.json'));
      const admitted = await repairs.admitOrReplay('key-3', {
        id: 'closed-round',
        planPath: '.docs/plans/feature.md',
        taskIds: ['2'],
        source: { findingId: 'finding-3', authority: 'build_review', instruction: 'repair it' },
        baseline: { head: 'no-such-commit', tree: 'tree', resolvedTaskIds: [] },
      });
      if (!admitted.ok) throw new Error(admitted.message);
      await repairs.close({
        planPath: '.docs/plans/feature.md',
        taskId: '2',
        obligationId: admitted.obligation.id,
        evidence: { kind: 'task-done', value: 'current' },
      });

      expect(await resolveTaskIds(dir, ['2'])).toEqual(new Set(['2']));
    });
  });

  describe('Done when evidence at task close', () => {
    async function prepareTaskClose(planTask: string, id = '1'): Promise<void> {
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.docs', 'plans', 'feature.md'), `# Plan\n\n${planTask}\n`);
      await writeFile(
        join(dir, '.pipeline', 'engine-state.json'),
        JSON.stringify({ activePlanPath: '.docs/plans/feature.md' }),
      );
      await writeFile(
        join(dir, '.pipeline', 'task-status.json'),
        JSON.stringify({ tasks: [{ id, status: 'pending' }] }),
      );
      expect(await runTaskStart(dir, id)).toBe(0);
    }

    async function taskRow(id = '1'): Promise<Record<string, unknown>> {
      const status = JSON.parse(
        await readFile(join(dir, '.pipeline', 'task-status.json'), 'utf-8'),
      ) as { tasks: Array<Record<string, unknown>> };
      return status.tasks.find((task) => task.id === id) ?? {};
    }

    it('closes an untagged check with free-text evidence as reported', async () => {
      await prepareTaskClose(`### Task 1: evidence required

**Done when:**
- first observable outcome
- second observable outcome
- third observable outcome`);

      const command = detectTaskCommand([
        'node', 'conduct', 'task', 'done', '1',
        '--done-when', '1=proved first',
        '--done-when', '2=proved second',
        '--done-when', '3=proved third',
      ]);

      expect(command).not.toBeNull();
      expect(await dispatchTaskCommand(command!, dir)).toBe(0);
      expect(await taskRow()).toMatchObject({
        status: 'completed',
        doneWhen: [
          { check: 'first observable outcome', evidence: 'proved first', source: 'reported' },
          { check: 'second observable outcome', evidence: 'proved second', source: 'reported' },
          { check: 'third observable outcome', evidence: 'proved third', source: 'reported' },
        ],
      });
    });

    it('closes a mixed task with verified tagged evidence and reported untagged evidence', async () => {
      await execa('git', ['init', '-b', 'main'], { cwd: dir });
      await execa('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
      await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });
      await mkdir(join(dir, 'test'), { recursive: true });
      await writeFile(
        join(dir, 'test', 'mixed-close.test.ts'),
        '// Covers: task:1\n\nit(\'closes the tagged outcome\', () => {});\n',
      );
      await execa('git', ['add', 'test/mixed-close.test.ts'], { cwd: dir });
      await execa('git', ['commit', '-m', 'seed tagged test'], { cwd: dir });
      await prepareTaskClose(`### Task 1: mixed evidence

**Done when:**
- [test] tagged observable outcome
- untagged configuration outcome`);

      const command = detectTaskCommand([
        'node', 'conduct', 'task', 'done', '1',
        '--done-when', '1=test:test/mixed-close.test.ts::closes the tagged outcome',
        '--done-when', '2=configuration was applied',
      ]);

      expect(command).not.toBeNull();
      expect(await dispatchTaskCommand(command!, dir)).toBe(0);
      expect(await taskRow()).toMatchObject({
        status: 'completed',
        doneWhen: [
          {
            check: '[test] tagged observable outcome',
            evidence: 'test:test/mixed-close.test.ts::closes the tagged outcome',
            source: 'verified',
          },
          {
            check: 'untagged configuration outcome',
            evidence: 'configuration was applied',
            source: 'reported',
          },
        ],
      });
    });

    it('records the per-check reason when the engine closes a tagged check as unverified', async () => {
      await execa('git', ['init', '-b', 'main'], { cwd: dir });
      await execa('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
      await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });
      await prepareTaskClose(`### Task 1: unverified test evidence

**Done when:**
- [test] a test must prove this outcome`);
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'seed task state'], { cwd: dir });

      await expect(completeTaskDoneWhen(dir, '1', [], [{
        index: 1,
        reason: 'the required service is unavailable in this environment',
      }])).resolves.toEqual({ kind: 'completed' });
      expect(await taskRow()).toMatchObject({
        status: 'completed',
        doneWhen: [{
          check: '[test] a test must prove this outcome',
          evidence: 'the required service is unavailable in this environment',
          source: 'unverified',
          reason: 'the required service is unavailable in this environment',
        }],
      });
      await expect(readFile(join(dir, '.pipeline', 'HALT'), 'utf8')).rejects.toThrow();
    });

    it('closes every task in a tag-free plan with the same free-text evidence', async () => {
      await prepareTaskClose(`### Task 1: first legacy-compatible close

**Done when:**
- first untagged outcome

### Task 2: second legacy-compatible close

**Done when:**
- second untagged outcome`);
      await writeFile(
        join(dir, '.pipeline', 'task-status.json'),
        JSON.stringify({
          tasks: [
            { id: '1', status: 'in_progress' },
            { id: '2', status: 'pending' },
          ],
        }),
      );
      for (const id of ['1', '2']) {
        if (id === '2') expect(await runTaskStart(dir, id)).toBe(0);
        const command = detectTaskCommand([
          'node', 'conduct', 'task', 'done', id,
          '--done-when', '1=the same free-text evidence',
        ]);
        expect(command).not.toBeNull();
        expect(await dispatchTaskCommand(command!, dir)).toBe(0);
      }

      expect(await taskRow('1')).toMatchObject({
        status: 'completed',
        doneWhen: [{
          check: 'first untagged outcome',
          evidence: 'the same free-text evidence',
          source: 'reported',
        }],
      });
      expect(await taskRow('2')).toMatchObject({
        status: 'completed',
        doneWhen: [{
          check: 'second untagged outcome',
          evidence: 'the same free-text evidence',
          source: 'reported',
        }],
      });
    });

    it('refuses close and names the missing Done when check', async () => {
      await prepareTaskClose(`### Task 1: evidence required

**Done when:**
- first observable outcome
- second observable outcome
- third observable outcome`);
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const command = detectTaskCommand([
          'node', 'conduct', 'task', 'done', '1',
          '--done-when', '1=proved first',
          '--done-when', '2=proved second',
        ]);

        expect(await dispatchTaskCommand(command!, dir)).toBe(1);
        expect(error).toHaveBeenCalledWith(expect.stringContaining('third observable outcome'));
      } finally {
        error.mockRestore();
      }
      expect(await taskRow()).toMatchObject({ status: 'in_progress' });
      expect(await taskRow()).not.toHaveProperty('doneWhen');
    });

    it('closes a task without a Done when block under the legacy rule', async () => {
      await prepareTaskClose('### Task 1: legacy close');

      const command = detectTaskCommand(['node', 'conduct', 'task', 'done', '1']);

      expect(await dispatchTaskCommand(command!, dir)).toBe(0);
      expect(await taskRow()).toMatchObject({ status: 'in_progress' });
      expect(await taskRow()).not.toHaveProperty('doneWhen');
    });

    it('closes a verify-only task through prove-closed evidence', async () => {
      await prepareTaskClose(`### Task 1: prove the current behavior is already closed

**Verify-only:** yes

**Done when:**
- first verified outcome
- second verified outcome`);

      const command = detectTaskCommand(['node', 'conduct', 'task', 'done', '1']);

      expect(await dispatchTaskCommand(command!, dir)).toBe(0);
      const row = await taskRow();
      expect(row).toMatchObject({ status: 'completed' });
      expect(row.doneWhen).toEqual([
        { check: 'first verified outcome', evidence: 'prove-closed', source: 'verify-only' },
        { check: 'second verified outcome', evidence: 'prove-closed', source: 'verify-only' },
      ]);
    });

    it('requires tagged verify-only checks to be verified or explicitly unverified while prove-closing untagged checks', async () => {
      await prepareTaskClose(`### Task 1: verify existing behavior with a test

**Verify-only:** yes

**Done when:**
- [test] tagged behavior remains covered
- untagged behavior remains closed`);

      const refusal = await completeTaskDoneWhen(dir, '1', []);
      expect(refusal).toMatchObject({
        kind: 'refused',
        message: expect.stringContaining('check 1: [test] tagged behavior remains covered'),
      });
      expect(refusal.kind === 'refused' && refusal.message).not.toContain('untagged behavior remains closed');
      expect(await taskRow()).toMatchObject({ status: 'in_progress' });

      await execa('git', ['init', '-b', 'main'], { cwd: dir });
      await execa('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
      await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });
      await mkdir(join(dir, 'test'), { recursive: true });
      await writeFile(
        join(dir, 'test', 'verify-only.test.ts'),
        '// Covers: task:1\n\nit(\'keeps tagged behavior covered\', () => {});\n',
      );
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'seed verify-only reference'], { cwd: dir });

      await expect(completeTaskDoneWhen(dir, '1', [{
        index: 1,
        evidence: 'test:test/verify-only.test.ts::keeps tagged behavior covered',
      }])).resolves.toEqual({ kind: 'completed' });
      expect(await taskRow()).toMatchObject({
        status: 'completed',
        doneWhen: [
          {
            check: '[test] tagged behavior remains covered',
            evidence: 'test:test/verify-only.test.ts::keeps tagged behavior covered',
            source: 'verified',
          },
          {
            check: 'untagged behavior remains closed',
            evidence: 'prove-closed',
            source: 'verify-only',
          },
        ],
      });
    });

    it('allows an explicit unverified close for a tagged verify-only check', async () => {
      await prepareTaskClose(`### Task 1: cannot verify existing behavior

**Verify-only:** yes

**Done when:**
- [test] tagged behavior needs an explicit close
- untagged behavior remains closed`);

      await expect(completeTaskDoneWhen(dir, '1', [], [{
        index: 1,
        reason: 'the required dependency is unavailable',
      }])).resolves.toEqual({ kind: 'completed' });
      expect(await taskRow()).toMatchObject({
        status: 'completed',
        doneWhen: [
          {
            check: '[test] tagged behavior needs an explicit close',
            evidence: 'the required dependency is unavailable',
            source: 'unverified',
            reason: 'the required dependency is unavailable',
          },
          {
            check: 'untagged behavior remains closed',
            evidence: 'prove-closed',
            source: 'verify-only',
          },
        ],
      });
    });
  });

  describe('halt marker', () => {
    it('haltMarkerPath returns the project-relative location', () => {
      expect(haltMarkerPath(dir)).toBe(join(dir, HALT_MARKER_RELATIVE));
    });

    it('haltMarkerExists returns false when missing', async () => {
      expect(await haltMarkerExists(dir)).toBe(false);
    });

    it('haltMarkerExists returns true when present', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/halt-user-input-required'), 'blocker');
      expect(await haltMarkerExists(dir)).toBe(true);
    });

    it('clearHaltMarker removes an existing marker', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/halt-user-input-required'), 'x');

      await clearHaltMarker(dir);

      expect(await haltMarkerExists(dir)).toBe(false);
    });

    it('clearHaltMarker is safe to call when the marker is absent', async () => {
      await clearHaltMarker(dir);
      expect(await haltMarkerExists(dir)).toBe(false);
    });

    it('readHaltMarkerContent returns null when the file does not exist', async () => {
      const content = await readHaltMarkerContent(dir);
      expect(content).toBeNull();
    });

    it('readHaltMarkerContent returns the raw string when the file exists', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/halt-user-input-required'), 'blocker reason');
      const content = await readHaltMarkerContent(dir);
      expect(content).toBe('blocker reason');
    });

    it('readHaltMarkerContent returns exact multi-line content', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      const multiLine = 'line 1\nline 2\nline 3';
      await writeFile(join(dir, '.pipeline/halt-user-input-required'), multiLine);
      const content = await readHaltMarkerContent(dir);
      expect(content).toBe(multiLine);
    });

    it('readHaltMarkerContent returns empty string when file is empty', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/halt-user-input-required'), '');
      const content = await readHaltMarkerContent(dir);
      expect(content).toBe('');
    });

    it('readHaltMarkerContent returns raw string with whitespace preserved', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      const whitespaceContent = '  spaces  \n\ttabs\t  ';
      await writeFile(join(dir, '.pipeline/halt-user-input-required'), whitespaceContent);
      const content = await readHaltMarkerContent(dir);
      expect(content).toBe(whitespaceContent);
    });
  });

  describe('writeStallQuestionEvidence', () => {
    it('writes multi-line content verbatim to .pipeline/build-stall-question.md and returns it', async () => {
      const content = 'line 1\nline 2\nline 3';
      const result = await writeStallQuestionEvidence(dir, content);
      expect(result).toBe(content);
      const written = await readFile(join(dir, '.pipeline/build-stall-question.md'), 'utf-8');
      expect(written).toBe(content);
    });

    it('writes placeholder when content is null', async () => {
      const placeholder = '(agent wrote no reason into halt-user-input-required)';
      const result = await writeStallQuestionEvidence(dir, null);
      expect(result).toBe(placeholder);
      const written = await readFile(join(dir, '.pipeline/build-stall-question.md'), 'utf-8');
      expect(written).toBe(placeholder);
    });

    it('writes placeholder when content is empty string', async () => {
      const placeholder = '(agent wrote no reason into halt-user-input-required)';
      const result = await writeStallQuestionEvidence(dir, '');
      expect(result).toBe(placeholder);
      const written = await readFile(join(dir, '.pipeline/build-stall-question.md'), 'utf-8');
      expect(written).toBe(placeholder);
    });

    it('writes placeholder when content is whitespace-only', async () => {
      const placeholder = '(agent wrote no reason into halt-user-input-required)';
      const result = await writeStallQuestionEvidence(dir, '   \n\t  \n  ');
      expect(result).toBe(placeholder);
      const written = await readFile(join(dir, '.pipeline/build-stall-question.md'), 'utf-8');
      expect(written).toBe(placeholder);
    });

    it('creates .pipeline directory if it does not exist', async () => {
      const content = 'test content';
      await writeStallQuestionEvidence(dir, content);
      const written = await readFile(join(dir, '.pipeline/build-stall-question.md'), 'utf-8');
      expect(written).toBe(content);
    });

    it('overwrites existing file (idempotent semantics)', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/build-stall-question.md'), 'old content');

      const newContent = 'new content';
      const result = await writeStallQuestionEvidence(dir, newContent);

      expect(result).toBe(newContent);
      const written = await readFile(join(dir, '.pipeline/build-stall-question.md'), 'utf-8');
      expect(written).toBe(newContent);
    });

    it('preserves exact whitespace in content (no trimming)', async () => {
      const contentWithWhitespace = '  leading\nmiddle  \ntrailing  ';
      const result = await writeStallQuestionEvidence(dir, contentWithWhitespace);
      expect(result).toBe(contentWithWhitespace);
      const written = await readFile(join(dir, '.pipeline/build-stall-question.md'), 'utf-8');
      expect(written).toBe(contentWithWhitespace);
    });
  });

  describe('negative paths (Task 10: stall capture negative paths)', () => {
    it('readHaltMarkerContent gracefully handles ENOENT race (marker unlinked between check and read)', async () => {
      // This test simulates a race condition where:
      // 1. haltMarkerExists returns true (file exists)
      // 2. File is deleted before readHaltMarkerContent runs
      // 3. readHaltMarkerContent should return null (not crash)
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/halt-user-input-required'), 'transient marker');

      // Verify marker exists
      expect(await haltMarkerExists(dir)).toBe(true);

      // Simulate deletion race: read should return null, not throw
      const content = await readHaltMarkerContent(dir);
      expect(content).toBe('transient marker');

      // Now actually delete it and verify graceful null return
      await rm(join(dir, '.pipeline/halt-user-input-required'));
      const contentAfterDelete = await readHaltMarkerContent(dir);
      expect(contentAfterDelete).toBeNull();
    });

    it('writeStallHalt writes empty marker as placeholder on first line', async () => {
      const placeholder = '(agent wrote no reason into halt-user-input-required)';
      const detail = 'remediation budget exhausted';

      await writeStallHalt(dir, '', detail);

      const written = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      const haltClass = await readFile(join(dir, '.pipeline/HALT.class'), 'utf-8');
      const firstLine = written.split('\n')[0];
      expect(firstLine).toBe(placeholder);
      expect(written).toContain(detail);
      expect(haltClass).toBe('needs-human');
    });

    it('writeStallHalt writes whitespace-only marker as placeholder on first line', async () => {
      const placeholder = '(agent wrote no reason into halt-user-input-required)';
      const detail = 'remediation budget exhausted';

      await writeStallHalt(dir, '   \n\t  ', detail);

      const written = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      const firstLine = written.split('\n')[0];
      expect(firstLine).toBe(placeholder);
      expect(written).toContain(detail);
    });

    it('writeStallHalt with multi-line marker writes first line verbatim to HALT', async () => {
      const question = 'Should we use Auth0?\nOr Cognito?\nOr Okta?';
      const detail = 'Need product decision';

      await writeStallHalt(dir, question, detail);

      const written = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      const lines = written.split('\n').filter((l) => l.length > 0);
      // First line should be the first line of the question (before newline)
      expect(lines[0]).toBe('Should we use Auth0?');
      expect(written).toContain(detail);
    });

    it('writeStallHalt preserves an explicit remediation halt class', async () => {
      const question = 'Which remediation boundary should own this repair?';
      const detail = 'Plan-growth allowance is exhausted.';

      await writeStallHalt(dir, question, detail, undefined, 'kickback-cap');

      expect(await readFile(join(dir, '.pipeline/HALT'), 'utf-8')).toMatch(
        /^Which remediation boundary should own this repair\?\n\nPlan-growth allowance is exhausted\./,
      );
      expect(await readFile(join(dir, '.pipeline/HALT.class'), 'utf-8')).toBe('kickback-cap');
    });

    it('writeStallHalt with null question uses placeholder', async () => {
      const placeholder = '(agent wrote no reason into halt-user-input-required)';
      const detail = 'remediation failed';

      await writeStallHalt(dir, null, detail);

      const written = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      const firstLine = written.split('\n')[0];
      expect(firstLine).toBe(placeholder);
      expect(written).toContain(detail);
    });

    it('writeStallHalt creates .pipeline directory if missing', async () => {
      const question = 'Test question';
      const detail = 'Test detail';

      // Ensure .pipeline does not exist
      expect(await haltMarkerExists(dir)).toBe(false);

      await writeStallHalt(dir, question, detail);

      const written = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      expect(written).toContain(question);
      expect(written).toContain(detail);
    });

    it('writeStallHalt returns a failed result and emits when creating .pipeline fails', async () => {
      const blockedRoot = join(dir, 'not-a-directory');
      await writeFile(blockedRoot, 'file blocks mkdir');
      const events = new ConductorEventEmitter();
      const failures: Array<{ path: string; reason: string }> = [];
      events.on('halt_marker_write_failed', (event) => {
        if (event.type === 'halt_marker_write_failed') failures.push(event);
      });

      const result = await writeStallHalt(blockedRoot, 'question', 'detail', events);

      expect(result.status).toBe('failed');
      expect(failures).toHaveLength(1);
      expect(failures[0]?.path).toBe(join(blockedRoot, '.pipeline', 'HALT'));
    });

    it('writeStallQuestionEvidence and writeStallHalt work together for capture/clear/evidence ordering', async () => {
      const question = 'First line question\nSecond line context';

      // Simulate stall capture flow (Task 3):
      // 1. Marker is written by build step
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/halt-user-input-required'), question);

      // 2. Read marker content
      const markerContent = await readHaltMarkerContent(dir);
      expect(markerContent).toBe(question);

      // 3. Write evidence from marker
      const evidence = await writeStallQuestionEvidence(dir, markerContent);
      expect(evidence).toBe(question);
      const evidenceFile = await readFile(join(dir, '.pipeline/build-stall-question.md'), 'utf-8');
      expect(evidenceFile).toBe(question);

      // 4. Clear marker
      await clearHaltMarker(dir);
      expect(await haltMarkerExists(dir)).toBe(false);

      // 5. Write HALT for degraded remediation (uses the captured evidence)
      const detail = 'remediation threw an error';
      await writeStallHalt(dir, evidence, detail);

      const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      // HALT should have first line of the original question
      expect(halt).toContain('First line question');
      expect(halt).toContain(detail);
    });
  });

});
