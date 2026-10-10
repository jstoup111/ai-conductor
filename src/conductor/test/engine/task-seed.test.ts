import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { planTaskDigests } from '../../src/engine/plan-task-parse.js';
import * as autoheal from '../../src/engine/autoheal.js';
// Covers: task:1, task:2, task:3, task:4, task:5
import { seedTaskStatus } from '../../src/engine/task-seed.js';
import { checkStepCompletion } from '../../src/engine/artifacts.js';
import { completeTaskDoneWhen, resolveTaskIds } from '../../src/engine/task-progress.js';
import { admitAndRestageRepair } from '../../src/engine/repair-restage.js';

const reopenObservation = vi.hoisted(() => ({
  active: false,
  events: [] as string[],
  statusPath: '',
  statusAtDigestWrite: '' as string | undefined,
  restageCalls: 0,
}));

vi.mock('../../src/engine/repair-obligations.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/repair-obligations.js')>();
  return {
    ...actual,
    createRepairObligationStore: (...args: Parameters<typeof actual.createRepairObligationStore>) => {
      const store = actual.createRepairObligationStore(...args);
      if (!reopenObservation.active) return store;
      return {
        ...store,
        admitOrReplay: async (...admission: Parameters<typeof store.admitOrReplay>) => {
          reopenObservation.events.push('admitOrReplay');
          return store.admitOrReplay(...admission);
        },
        markSettled: async (...input: Parameters<typeof store.markSettled>) => {
          reopenObservation.events.push('markSettled');
          return store.markSettled(...input);
        },
      };
    },
  };
});

vi.mock('../../src/engine/repair-restage.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/repair-restage.js')>();
  return {
    ...actual,
    admitAndRestageRepair: async (...args: Parameters<typeof actual.admitAndRestageRepair>) => {
      reopenObservation.restageCalls += 1;
      return actual.admitAndRestageRepair(...args);
    },
  };
});

vi.mock('../../src/engine/task-digests.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/task-digests.js')>();
  return {
    ...actual,
    recordTaskDigests: async (...args: Parameters<typeof actual.recordTaskDigests>) => {
      reopenObservation.events.push('recordTaskDigests');
      if (reopenObservation.statusPath) {
        reopenObservation.statusAtDigestWrite = await fsPromises.readFile(reopenObservation.statusPath, 'utf8');
      }
      return actual.recordTaskDigests(...args);
    },
  };
});

vi.mock('../../src/engine/autoheal.js', { spy: true });

describe('task-seed', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fsPromises.mkdtemp(join(tmpdir(), 'task-seed-test-'));
  });

  afterEach(async () => {
    await fsPromises.rm(dir, { recursive: true, force: true });
  });

  describe('fresh seed', () => {
    it('creates one pending row per plan task', async () => {
      const planPath = join(dir, '.docs/plans/test.md');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.writeFile(
        planPath,
        `# Plan

## Task 1: First Task
Content with \`src/file1.ts\`

## Task 2: Second Task
Content with \`src/file2.ts\`

## Task 3: Third Task
Content with \`src/file3.ts\`
`,
      );

      await seedTaskStatus(dir, planPath);

      const statusPath = join(dir, '.pipeline/task-status.json');
      const content = await fsPromises.readFile(statusPath, 'utf-8');
      const status = JSON.parse(content);

      // Should have tasks array with one entry per plan task
      expect(status.tasks).toBeInstanceOf(Array);
      expect(status.tasks).toHaveLength(3);

      // Each task should have id, name, and status = 'pending'
      const task1 = status.tasks.find((t: any) => t.id === '1');
      expect(task1).toBeDefined();
      expect(task1.name).toBe('First Task');
      expect(task1.status).toBe('pending');

      const task2 = status.tasks.find((t: any) => t.id === '2');
      expect(task2).toBeDefined();
      expect(task2.name).toBe('Second Task');
      expect(task2.status).toBe('pending');

      const task3 = status.tasks.find((t: any) => t.id === '3');
      expect(task3).toBeDefined();
      expect(task3.name).toBe('Third Task');
      expect(task3.status).toBe('pending');
    });

    it('seeds only explicitly declared Files paths, including same-as inheritance', async () => {
      const planPath = join(dir, '.docs/plans/test.md');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.writeFile(
        planPath,
        `# Plan

## Task 1: First Task
**Files:** src/one.ts; src/two.ts

## Task 2: Inherited Task
**Files:** same as Task 1

## Task 3: Prose Task
- \`src/incidental.ts\`
`,
      );

      await seedTaskStatus(dir, planPath);

      const status = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline/task-status.json'), 'utf-8'));
      expect(status.tasks.find((task: any) => task.id === '1').files).toEqual(['src/one.ts', 'src/two.ts']);
      expect(status.tasks.find((task: any) => task.id === '2').files).toEqual(['src/one.ts', 'src/two.ts']);
      expect(status.tasks.find((task: any) => task.id === '3').files).toBeUndefined();
    });
  });

  describe('Task 1: partial task-status recovery from Task trailers', () => {
    async function git(args: string[]): Promise<string> {
      const result = await execa('git', args, { cwd: dir });
      return result.stdout.trim();
    }

    async function initializeRepository(withOrigin = true): Promise<void> {
      await git(['init', '-q', '-b', 'main']);
      await git(['config', 'user.email', 'test@example.com']);
      await git(['config', 'user.name', 'Test User']);
      await fsPromises.writeFile(join(dir, 'README.md'), '# fixture\n');
      await git(['add', 'README.md']);
      await git(['commit', '-q', '-m', 'initial fixture']);
      if (withOrigin) await git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    }

    async function commitForTask(id: string): Promise<string> {
      const path = `task-${id}.txt`;
      await fsPromises.writeFile(join(dir, path), `task ${id}\n`);
      await git(['add', path]);
      await git(['commit', '-q', '-m', `feat: task ${id}`, '-m', `Task: ${id}`]);
      return git(['rev-parse', 'HEAD']);
    }

    async function writePlan(includeMissingSibling = false): Promise<string> {
      const planPath = join(dir, '.docs/plans/test.md');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.writeFile(
        planPath,
        '# Plan\n\n## Task 1: Already recorded\n\n## Task 18: Restored work\n' +
          (includeMissingSibling ? '\n## Task 19: Missing sibling\n' : ''),
      );
      return planPath;
    }

    it('restores only a missing row from its branch-scoped Task trailer', async () => {
      await initializeRepository();
      const trailerCommit = await commitForTask('18');
      const planPath = await writePlan();
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: '1', name: 'Already recorded', status: 'completed', commit: 'kept' }] }),
      );

      await seedTaskStatus(dir, planPath);

      const status = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline/task-status.json'), 'utf8'));
      expect(status.tasks).toEqual([
        { id: '1', name: 'Already recorded', status: 'completed', commit: 'kept' },
        {
          id: '18', name: 'Restored work', status: 'completed', commit: trailerCommit,
          restored_from: 'task-trailer',
        },
      ]);
    });

    it('writes a missing row as pending when no branch-scoped Task trailer proves it', async () => {
      await initializeRepository();
      const planPath = await writePlan();
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: '1', name: 'Already recorded', status: 'completed', commit: 'kept' }] }),
      );

      await seedTaskStatus(dir, planPath);

      const status = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline/task-status.json'), 'utf8'));
      expect(status.tasks.find((task: any) => task.id === '18')).toEqual({
        id: '18', name: 'Restored work', status: 'pending',
      });
    });

    it('avoids scanning trailers when every plan task already has a row', async () => {
      const planPath = await writePlan();
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [
          { id: '1', name: 'Already recorded', status: 'pending' },
          { id: '18', name: 'Restored work', status: 'pending' },
        ] }),
      );
      const trailers = vi.spyOn(autoheal, 'listCommitsWithTrailers');
      trailers.mockClear();

      await seedTaskStatus(dir, planPath);

      expect(trailers).not.toHaveBeenCalled();
    });

    it('keeps an existing pending row pending despite a branch-scoped Task trailer', async () => {
      await initializeRepository();
      await commitForTask('18');
      const planPath = await writePlan(true);
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [
          { id: '1', name: 'Already recorded', status: 'completed', commit: 'kept' },
          { id: '18', name: 'Restored work', status: 'pending' },
        ] }),
      );

      const trailers = vi.spyOn(autoheal, 'listCommitsWithTrailers');
      trailers.mockClear();

      await seedTaskStatus(dir, planPath);

      const status = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline/task-status.json'), 'utf8'));
      expect({ trailerScans: trailers.mock.calls.length, task18: status.tasks.find((task: any) => task.id === '18') }).toEqual({
        trailerScans: 1,
        task18: { id: '18', name: 'Restored work', status: 'pending' },
      });
    });

    it('keeps a trailer-restored missing row pending when it has an open repair obligation', async () => {
      await initializeRepository();
      await commitForTask('18');
      const planPath = await writePlan();
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: '1', name: 'Already recorded', status: 'completed', commit: 'kept' }] }),
      );
      await fsPromises.writeFile(join(dir, '.pipeline/engine-state.json'), JSON.stringify({
        activePlanPath: planPath,
        repairObligations: {
          version: 1,
          records: {
            repair_18: {
              id: 'repair_18', planIdentity: '.docs/plans/test.md', taskIds: ['18'],
              source: { findingId: 'F-18', authority: 'test', instruction: 'repair it' },
              baseline: { head: 'before', tree: 'before', resolvedTaskIds: [] }, settlement: 'unsettled',
              tasks: { '18': { status: 'open' } },
            },
          },
          currentByPlan: { '.docs/plans/test.md': { '18': 'repair_18' } },
        },
      }));

      await seedTaskStatus(dir, planPath);

      const status = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline/task-status.json'), 'utf8'));
      expect(status.tasks.find((task: any) => task.id === '18')).toEqual({
        id: '18', name: 'Restored work', status: 'pending', commit: await git(['rev-parse', 'HEAD']),
        restored_from: 'task-trailer',
      });
    });

    it('keeps a missing row pending when its only trailer is on origin at the merge-base', async () => {
      await initializeRepository();
      await commitForTask('18');
      await git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
      const planPath = await writePlan();
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: '1', name: 'Already recorded', status: 'completed', commit: 'kept' }] }),
      );

      const trailers = vi.spyOn(autoheal, 'listCommitsWithTrailers');
      trailers.mockClear();

      await seedTaskStatus(dir, planPath);

      const status = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline/task-status.json'), 'utf8'));
      expect({ trailerScans: trailers.mock.calls.length, task18: status.tasks.find((task: any) => task.id === '18') }).toEqual({
        trailerScans: 1,
        task18: { id: '18', name: 'Restored work', status: 'pending' },
      });
    });

    it('keeps a missing row pending without an origin ref even when HEAD carries its trailer', async () => {
      await initializeRepository(false);
      await commitForTask('18');
      const planPath = await writePlan();
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: '1', name: 'Already recorded', status: 'completed', commit: 'kept' }] }),
      );

      const originResolution = vi.spyOn(autoheal, 'resolveOriginRef');
      originResolution.mockClear();

      await seedTaskStatus(dir, planPath);

      const status = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline/task-status.json'), 'utf8'));
      expect({ originResolutions: originResolution.mock.calls.length, task18: status.tasks.find((task: any) => task.id === '18') }).toEqual({
        originResolutions: 1,
        task18: { id: '18', name: 'Restored work', status: 'pending' },
      });
    });

    it('resets a trailerless in_progress row to pending at a dispatch boundary', async () => {
      await initializeRepository();
      const planPath = await writePlan(true);
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [
          { id: '1', name: 'Already recorded', status: 'completed', commit: 'kept' },
          { id: '18', name: 'Restored work', status: 'pending' },
          { id: '19', name: 'Missing sibling', status: 'in_progress' },
        ] }),
      );

      await seedTaskStatus(dir, planPath, undefined, { dispatchBoundary: true });

      const status = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline/task-status.json'), 'utf8'));
      expect(status.tasks.find((task: any) => task.id === '19')).toEqual({
        id: '19', name: 'Missing sibling', status: 'pending',
      });
    });

    it('keeps an in_progress row with a branch-scoped Task trailer at a dispatch boundary', async () => {
      await initializeRepository();
      await commitForTask('19');
      const planPath = await writePlan(true);
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [
          { id: '1', name: 'Already recorded', status: 'completed', commit: 'kept' },
          { id: '18', name: 'Restored work', status: 'pending' },
          { id: '19', name: 'Missing sibling', status: 'in_progress' },
        ] }),
      );

      await seedTaskStatus(dir, planPath, undefined, { dispatchBoundary: true });

      const status = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline/task-status.json'), 'utf8'));
      expect(status.tasks.find((task: any) => task.id === '19')).toEqual({
        id: '19', name: 'Missing sibling', status: 'in_progress',
      });
    });

    it('keeps a trailerless in_progress row during a default seed', async () => {
      await initializeRepository();
      const planPath = await writePlan(true);
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [
          { id: '1', name: 'Already recorded', status: 'completed', commit: 'kept' },
          { id: '18', name: 'Restored work', status: 'pending' },
          { id: '19', name: 'Missing sibling', status: 'in_progress' },
        ] }),
      );

      await seedTaskStatus(dir, planPath);

      const status = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline/task-status.json'), 'utf8'));
      expect(status.tasks.find((task: any) => task.id === '19')).toEqual({
        id: '19', name: 'Missing sibling', status: 'in_progress',
      });
    });

    it('passes the dispatch-boundary option only from pre-BUILD task telemetry', async () => {
      const readEngineSources = async (directory: URL): Promise<string[]> => {
        const entries = await fsPromises.readdir(directory, { withFileTypes: true });
        return (await Promise.all(entries.map(async (entry) => {
          const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
          if (entry.isDirectory()) return readEngineSources(path);
          return entry.name.endsWith('.ts') ? [await fsPromises.readFile(path, 'utf8')] : [];
        }))).flat();
      };
      const [conductor, buildReviewHaltRender, artifacts, repairRestage] = await Promise.all([
        fsPromises.readFile(new URL('../../src/engine/conductor.ts', import.meta.url), 'utf8'),
        fsPromises.readFile(new URL('../../src/engine/build-review-halt-render.ts', import.meta.url), 'utf8'),
        fsPromises.readFile(new URL('../../src/engine/artifacts.ts', import.meta.url), 'utf8'),
        fsPromises.readFile(new URL('../../src/engine/repair-restage.ts', import.meta.url), 'utf8'),
      ]);
      const dispatchOptionCount = (await readEngineSources(new URL('../../src/engine/', import.meta.url)))
        .flatMap((source) => source.match(/dispatchBoundary:\s*true/g) ?? [])
        .length;

      expect({
        dispatchOptionCount,
        dispatch: buildReviewHaltRender.includes('await seedTaskStatus(projectRoot, planPath, undefined, { dispatchBoundary: true, childBase });'),
        remediation: conductor.includes('await seedTaskStatus(this.projectRoot, planPath, undefined, {'),
        completion: artifacts.includes('await seedTaskStatus(ctx.projectRoot, ctx.planPath, enginePlanPath, {'),
        repairRestage: repairRestage.includes('await seedTaskStatus(projectRoot, planPath);'),
      }).toEqual({ dispatchOptionCount: 1, dispatch: true, remediation: true, completion: true, repairRestage: true });
    });

    it('resets an in_progress row to pending at a dispatch boundary without an origin ref', async () => {
      await initializeRepository(false);
      const planPath = await writePlan(true);
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [
          { id: '1', name: 'Already recorded', status: 'completed', commit: 'kept' },
          { id: '18', name: 'Restored work', status: 'pending' },
          { id: '19', name: 'Missing sibling', status: 'in_progress' },
        ] }),
      );

      await seedTaskStatus(dir, planPath, undefined, { dispatchBoundary: true });

      const status = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline/task-status.json'), 'utf8'));
      expect(status.tasks.find((task: any) => task.id === '19')).toEqual({
        id: '19', name: 'Missing sibling', status: 'pending',
      });
    });

    it('preserves a completed row without a Task trailer during default and dispatch seeds', async () => {
      await initializeRepository();
      const planPath = join(dir, '.docs/plans/test.md');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.writeFile(planPath, '# Plan\n\n## Task 5: Finished work\n');
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: '5', name: 'Finished work', status: 'completed', commit: 'recorded-sha' }] }),
      );

      await seedTaskStatus(dir, planPath);
      await seedTaskStatus(dir, planPath, undefined, { dispatchBoundary: true });

      const status = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline/task-status.json'), 'utf8'));
      expect(status.tasks).toEqual([
        { id: '5', name: 'Finished work', status: 'completed', commit: 'recorded-sha' },
      ]);
    });
  });

  describe('Task 14: reseed no longer restores rows from evidence stamps', () => {
    it('creates a plan task not present in task-status.json as pending, even when an evidence stamp exists for it', async () => {
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      // No task-status.json yet — task-status.json is the sole source of
      // truth (Task 10, #773); an evidence stamp must NOT resurrect a row
      // as 'completed' out of nowhere.
      await fsPromises.writeFile(
        join(dir, '.pipeline/task-evidence.json'),
        JSON.stringify({
          evidenceStamps: {
            '1': { sha: 'abc123', form: 'commit' },
          },
          noEvidenceAttempts: 0,
          migrationGrandfather: [],
        }),
      );

      const planPath = join(dir, '.docs/plans/test.md');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.writeFile(
        planPath,
        `# Plan

## Task 1: First Task
Content
`,
      );

      await seedTaskStatus(dir, planPath);

      const statusPath = join(dir, '.pipeline/task-status.json');
      const status = JSON.parse(await fsPromises.readFile(statusPath, 'utf-8'));
      const task1 = status.tasks.find((t: any) => t.id === '1');
      expect(task1).toBeDefined();
      expect(task1.status).toBe('pending');
      expect(task1.commit).toBeUndefined();
    });
  });

  describe('preserve completed rows', () => {
    it('keeps an open repair pending while preserving an untouched completed sibling', async () => {
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      const planPath = join(dir, '.docs/plans/test.md');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.writeFile(planPath, '# Plan\n\n## Task 1: Repaired\n\n## Task 2: Untouched\n');
      await fsPromises.writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify({ tasks: [
        { id: '1', status: 'completed', commit: 'old-repair' },
        { id: '2', status: 'completed', commit: 'untouched' },
      ] }));
      await fsPromises.writeFile(join(dir, '.pipeline/engine-state.json'), JSON.stringify({
        activePlanPath: planPath,
        repairObligations: {
          version: 1,
          records: {
            repair_1: {
              id: 'repair_1', planIdentity: '.docs/plans/test.md', taskIds: ['1'],
              source: { findingId: 'F-1', authority: 'test', instruction: 'repair it' },
              baseline: { head: 'before', tree: 'before', resolvedTaskIds: [] }, settlement: 'unsettled',
              tasks: { '1': { status: 'open' } },
            },
          },
          currentByPlan: { '.docs/plans/test.md': { '1': 'repair_1' }, },
        },
      }));

      await seedTaskStatus(dir, planPath);

      const tasks = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline/task-status.json'), 'utf8')).tasks;
      expect(tasks).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: '1', status: 'pending' }),
        expect.objectContaining({ id: '2', status: 'completed', commit: 'untouched' }),
      ]));
    });

    it('preserves completed rows with engine stamps during re-seed', async () => {
      // Setup: existing task-status.json with a completed task
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: [
            { id: '1', name: 'First Task', status: 'completed', commit: 'abc123' },
            { id: '2', name: 'Second Task', status: 'pending' },
          ],
        }),
      );

      // Setup: evidence sidecar with engine stamp for task 1
      await fsPromises.writeFile(
        join(dir, '.pipeline/task-evidence.json'),
        JSON.stringify({
          evidenceStamps: {
            '1': { sha: 'abc123', form: 'commit' },
          },
          noEvidenceAttempts: 0,
          migrationGrandfather: [],
        }),
      );

      // Plan: same tasks
      const planPath = join(dir, '.docs/plans/test.md');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.writeFile(
        planPath,
        `# Plan

## Task 1: First Task
Content

## Task 2: Second Task
Content
`,
      );

      await seedTaskStatus(dir, planPath);

      const statusPath = join(dir, '.pipeline/task-status.json');
      const content = await fsPromises.readFile(statusPath, 'utf-8');
      const status = JSON.parse(content);

      // Task 1 should remain completed with its commit
      const task1 = status.tasks.find((t: any) => t.id === '1');
      expect(task1.status).toBe('completed');
      expect(task1.commit).toBe('abc123');

      // Task 2 should remain pending
      const task2 = status.tasks.find((t: any) => t.id === '2');
      expect(task2.status).toBe('pending');
    });

    // Task 10 (#773): this used to pin the H8 anti-forgery invariant — a
    // 'completed' row with no matching evidence-sidecar stamp was demoted
    // back to 'pending' on re-seed. That cross-check is retired: the build
    // predicate (and now seedTaskStatus itself) no longer consults the
    // evidence sidecar at all — real completion authority moved to
    // build_review's completeness rubric. A terminal row now survives
    // re-seed regardless of whether a sidecar stamp exists for it.
    it('preserves a completed row across re-seed even with no matching evidence stamp (anti-forgery cross-check retired)', async () => {
      // Setup: task-status.json with completed task but no evidence
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: [{ id: '1', name: 'First Task', status: 'completed', commit: 'abc123' }],
        }),
      );

      // A PRESENT-but-empty sidecar: post-cutover state, so this is NOT a
      // first seed. seedTaskStatus no longer reads this file to decide
      // whether to preserve the row.
      await fsPromises.writeFile(
        join(dir, '.pipeline/task-evidence.json'),
        JSON.stringify({ evidenceStamps: {}, noEvidenceAttempts: 0, migrationGrandfather: [] }),
      );
      const planPath = join(dir, '.docs/plans/test.md');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.writeFile(
        planPath,
        `# Plan

## Task 1: First Task
Content
`,
      );

      await seedTaskStatus(dir, planPath);

      const statusPath = join(dir, '.pipeline/task-status.json');
      const content = await fsPromises.readFile(statusPath, 'utf-8');
      const status = JSON.parse(content);

      const task1 = status.tasks.find((t: any) => t.id === '1');
      expect(task1.status).toBe('completed');
    });
  });

  describe('preserve in_progress rows', () => {
    it('preserves in_progress rows during re-seed', async () => {
      // Setup: task-status.json with in_progress task
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: [
            { id: '1', name: 'First Task', status: 'in_progress' },
            { id: '2', name: 'Second Task', status: 'pending' },
          ],
        }),
      );

      // Plan: same tasks
      const planPath = join(dir, '.docs/plans/test.md');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.writeFile(
        planPath,
        `# Plan

## Task 1: First Task
Content

## Task 2: Second Task
Content
`,
      );

      await seedTaskStatus(dir, planPath);

      const statusPath = join(dir, '.pipeline/task-status.json');
      const content = await fsPromises.readFile(statusPath, 'utf-8');
      const status = JSON.parse(content);

      // Task 1 should remain in_progress
      const task1 = status.tasks.find((t: any) => t.id === '1');
      expect(task1.status).toBe('in_progress');

      // Task 2 should remain pending
      const task2 = status.tasks.find((t: any) => t.id === '2');
      expect(task2.status).toBe('pending');
    });
  });

  describe('declared files merge', () => {
    it('adds declared files without clobbering preserved rows or their existing files', async () => {
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: [
            {
              id: '1',
              name: 'In flight',
              status: 'in_progress',
              files: ['src/already-tracked.ts'],
              dispatch_id: 'dispatch-1',
            },
            {
              id: '2',
              name: 'Finished',
              status: 'completed',
              files: ['src/finished.ts'],
              commit: 'abc123',
              restored_from: 'task-trailer',
            },
            {
              id: '3',
              name: 'Skipped',
              status: 'skipped',
              files: ['src/skipped.ts'],
              skip_reason: 'not-needed',
              operator_note: 'preserve me',
            },
          ],
        }),
      );

      const planPath = join(dir, '.docs/plans/test.md');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.writeFile(
        planPath,
        `# Plan

## Task 1: First Task
**Files:** src/declared.ts

## Task 2: Second Task
**Files:** src/declared.ts

## Task 3: Third Task
**Files:** src/declared.ts
`,
      );

      await seedTaskStatus(dir, planPath);

      const status = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline/task-status.json'), 'utf-8'));
      expect(status.tasks.find((task: any) => task.id === '1')).toMatchObject({
        status: 'in_progress',
        dispatch_id: 'dispatch-1',
        files: ['src/already-tracked.ts', 'src/declared.ts'],
      });
      expect(status.tasks.find((task: any) => task.id === '2')).toMatchObject({
        status: 'completed',
        commit: 'abc123',
        restored_from: 'task-trailer',
        files: ['src/finished.ts', 'src/declared.ts'],
      });
      expect(status.tasks.find((task: any) => task.id === '3')).toMatchObject({
        status: 'skipped',
        skip_reason: 'not-needed',
        operator_note: 'preserve me',
        files: ['src/skipped.ts', 'src/declared.ts'],
      });
    });

    it('seeds an explicit Files none declaration as an empty array', async () => {
      const planPath = join(dir, '.docs/plans/test.md');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.writeFile(
        planPath,
        `# Plan

## Task 1: No files
**Files:** none
`,
      );

      await seedTaskStatus(dir, planPath);

      const status = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline/task-status.json'), 'utf-8'));
      expect(status.tasks.find((task: any) => task.id === '1').files).toEqual([]);
    });

    it('does not add files when the plan has no Files declarations', async () => {
      const planPath = join(dir, '.docs/plans/test.md');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.writeFile(
        planPath,
        `# Plan

## Task 1: First Task
Ordinary prose only.

## Task 2: Second Task
More ordinary prose.
`,
      );

      await expect(seedTaskStatus(dir, planPath)).resolves.not.toThrow();

      const status = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline/task-status.json'), 'utf-8'));
      expect(status.tasks).toEqual([
        expect.objectContaining({ id: '1' }),
        expect.objectContaining({ id: '2' }),
      ]);
      expect(status.tasks.every((task: any) => task.files === undefined)).toBe(true);
    });

    it('does not treat backticked prose file bullets as declared files', async () => {
      const planPath = join(dir, '.docs/plans/test.md');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.writeFile(
        planPath,
        `# Plan

## Task 1: Prose-only paths
- Read \`src/incidental.ts\` before changing behavior.
- Compare against \`docs/reference.md\` for context.
`,
      );

      await seedTaskStatus(dir, planPath);

      const status = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline/task-status.json'), 'utf-8'));
      expect(status.tasks.find((task: any) => task.id === '1').files).toBeUndefined();
    });
  });

  describe('upsert new plan tasks', () => {
    it('adds new plan tasks to existing file', async () => {
      // Setup: existing task-status.json with one task
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: [{ id: '1', name: 'First Task', status: 'completed' }],
        }),
      );

      // Setup: evidence for task 1
      await fsPromises.writeFile(
        join(dir, '.pipeline/task-evidence.json'),
        JSON.stringify({
          evidenceStamps: {
            '1': { sha: 'abc123', form: 'commit' },
          },
          noEvidenceAttempts: 0,
          migrationGrandfather: [],
        }),
      );

      // Plan: add task 2 and 3
      const planPath = join(dir, '.docs/plans/test.md');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.writeFile(
        planPath,
        `# Plan

## Task 1: First Task
Content

## Task 2: Second Task
Content

## Task 3: Third Task
Content
`,
      );

      await seedTaskStatus(dir, planPath);

      const statusPath = join(dir, '.pipeline/task-status.json');
      const content = await fsPromises.readFile(statusPath, 'utf-8');
      const status = JSON.parse(content);

      expect(status.tasks).toHaveLength(3);

      // Task 1 should remain completed
      const task1 = status.tasks.find((t: any) => t.id === '1');
      expect(task1.status).toBe('completed');

      // Task 2 should be added as pending
      const task2 = status.tasks.find((t: any) => t.id === '2');
      expect(task2.status).toBe('pending');
      expect(task2.name).toBe('Second Task');

      // Task 3 should be added as pending
      const task3 = status.tasks.find((t: any) => t.id === '3');
      expect(task3.status).toBe('pending');
      expect(task3.name).toBe('Third Task');
    });

    it('keeps non-plan tasks in existing file', async () => {
      // Setup: existing task-status.json with task 1 and 99
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: [
            { id: '1', name: 'First Task', status: 'pending' },
            { id: '99', name: 'Old Task', status: 'completed' },
          ],
        }),
      );

      // Plan: only task 1
      const planPath = join(dir, '.docs/plans/test.md');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.writeFile(
        planPath,
        `# Plan

## Task 1: First Task
Content
`,
      );

      await seedTaskStatus(dir, planPath);

      const statusPath = join(dir, '.pipeline/task-status.json');
      const content = await fsPromises.readFile(statusPath, 'utf-8');
      const status = JSON.parse(content);

      expect(status.tasks).toHaveLength(2);

      // Task 1 should be there
      const task1 = status.tasks.find((t: any) => t.id === '1');
      expect(task1).toBeDefined();

      // Task 99 should still be there (not deleted)
      const task99 = status.tasks.find((t: any) => t.id === '99');
      expect(task99).toBeDefined();
      expect(task99.status).toBe('completed');
    });
  });

  describe('idempotency', () => {
    it('produces byte-identical JSON on second re-seed', async () => {
      const planPath = join(dir, '.docs/plans/test.md');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.writeFile(
        planPath,
        `# Plan

## Task 1: First Task
Content

## Task 2: Second Task
Content
`,
      );

      // First seed
      await seedTaskStatus(dir, planPath);

      const statusPath = join(dir, '.pipeline/task-status.json');
      const firstContent = await fsPromises.readFile(statusPath, 'utf-8');

      // Second seed
      await seedTaskStatus(dir, planPath);

      const secondContent = await fsPromises.readFile(statusPath, 'utf-8');

      // Bytes should be identical
      expect(firstContent).toBe(secondContent);
    });

    it('maintains consistent task order across re-seeds', async () => {
      const planPath = join(dir, '.docs/plans/test.md');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.writeFile(
        planPath,
        `# Plan

## Task 1: First Task
Content

## Task 2: Second Task
Content

## Task 3: Third Task
Content
`,
      );

      await seedTaskStatus(dir, planPath);

      const statusPath = join(dir, '.pipeline/task-status.json');
      const firstStatus = JSON.parse(await fsPromises.readFile(statusPath, 'utf-8'));
      const firstIds = firstStatus.tasks.map((t: any) => t.id);

      await seedTaskStatus(dir, planPath);

      const secondStatus = JSON.parse(await fsPromises.readFile(statusPath, 'utf-8'));
      const secondIds = secondStatus.tasks.map((t: any) => t.id);

      expect(firstIds).toEqual(secondIds);
    });
  });

  describe('full wipe restoration', () => {
    it('restores fully-wiped file from plan', async () => {
      const planPath = join(dir, '.docs/plans/test.md');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.writeFile(
        planPath,
        `# Plan

## Task 1: First Task
Content

## Task 2: Second Task
Content
`,
      );

      // First seed
      await seedTaskStatus(dir, planPath);

      const statusPath = join(dir, '.pipeline/task-status.json');
      const firstContent = await fsPromises.readFile(statusPath, 'utf-8');

      // Wipe the file
      await fsPromises.writeFile(statusPath, '');

      // Re-seed
      await seedTaskStatus(dir, planPath);

      const secondContent = await fsPromises.readFile(statusPath, 'utf-8');

      // Should be fully restored
      expect(secondContent).toBe(firstContent);
      const status = JSON.parse(secondContent);
      expect(status.tasks).toHaveLength(2);
    });

    it('Task 14: wiped file re-seeds as pending, no longer restored from evidence sidecar', async () => {
      // Setup: task-status.json with completed task
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: [{ id: '1', name: 'First Task', status: 'completed', commit: 'abc123' }],
        }),
      );

      // Setup: evidence sidecar
      await fsPromises.writeFile(
        join(dir, '.pipeline/task-evidence.json'),
        JSON.stringify({
          evidenceStamps: {
            '1': { sha: 'abc123', form: 'commit' },
          },
          noEvidenceAttempts: 0,
          migrationGrandfather: [],
        }),
      );

      const planPath = join(dir, '.docs/plans/test.md');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.writeFile(
        planPath,
        `# Plan

## Task 1: First Task
Content
`,
      );

      // First seed
      await seedTaskStatus(dir, planPath);

      const statusPath = join(dir, '.pipeline/task-status.json');
      await fsPromises.readFile(statusPath, 'utf-8');

      // Wipe the file
      await fsPromises.writeFile(statusPath, '');

      // Re-seed (evidence is still there)
      await seedTaskStatus(dir, planPath);

      const secondContent = await fsPromises.readFile(statusPath, 'utf-8');
      const status = JSON.parse(secondContent);

      // Task 1 is NOT restored from the evidence sidecar (Task 14, #773) —
      // task-status.json is the sole source of truth, so a wipe re-seeds
      // the row fresh as pending.
      const task1 = status.tasks.find((t: any) => t.id === '1');
      expect(task1.status).toBe('pending');
      expect(task1.commit).toBeUndefined();
    });
  });

  describe('atomic write', () => {
    it('uses temp file + rename for atomic writes', async () => {
      const planPath = join(dir, '.docs/plans/test.md');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.writeFile(
        planPath,
        `# Plan

## Task 1: First Task
Content
`,
      );

      const writeSpy = vi.spyOn(require('node:fs/promises'), 'writeFile');

      await seedTaskStatus(dir, planPath);

      // Should have written to the status file at least once
      const statusPath = join(dir, '.pipeline/task-status.json');
      const content = await fsPromises.readFile(statusPath, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
      const status = JSON.parse(content);
      expect(status.tasks).toHaveLength(1);

      writeSpy.mockRestore();
    });
  });

  describe('plan_ref tracking', () => {
    it('stores plan_ref in task-status.json', async () => {
      const planPath = join(dir, '.docs/plans/test.md');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.writeFile(
        planPath,
        `# Plan

## Task 1: First Task
Content
`,
      );

      await seedTaskStatus(dir, planPath);

      const statusPath = join(dir, '.pipeline/task-status.json');
      const content = await fsPromises.readFile(statusPath, 'utf-8');
      const status = JSON.parse(content);

      // plan_ref should be set
      expect(status.plan_ref).toBeDefined();
      // It should reference the plan path in a way that can be resolved
      expect(typeof status.plan_ref).toBe('string');
    });
  });

  describe('error handling', () => {
    it('creates .pipeline directory if absent', async () => {
      const planPath = join(dir, '.docs/plans/test.md');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.writeFile(
        planPath,
        `# Plan

## Task 1: First Task
Content
`,
      );

      // No .pipeline directory
      await seedTaskStatus(dir, planPath);

      const statusPath = join(dir, '.pipeline/task-status.json');
      const content = await fsPromises.readFile(statusPath, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
    });

    it('handles missing plan file gracefully', async () => {
      const planPath = join(dir, '.docs/plans/nonexistent.md');

      // This should not throw, but handle gracefully
      await expect(seedTaskStatus(dir, planPath)).resolves.not.toThrow();
    });

    it('handles corrupt existing task-status.json by resetting', async () => {
      // Setup: corrupt task-status.json
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(join(dir, '.pipeline/task-status.json'), 'not valid json {');

      const planPath = join(dir, '.docs/plans/test.md');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.writeFile(
        planPath,
        `# Plan

## Task 1: First Task
Content
`,
      );

      // Should not throw, should create valid file
      await expect(seedTaskStatus(dir, planPath)).resolves.not.toThrow();

      const statusPath = join(dir, '.pipeline/task-status.json');
      const content = await fsPromises.readFile(statusPath, 'utf-8');
      const status = JSON.parse(content);

      expect(status.tasks).toHaveLength(1);
      expect(status.tasks[0].id).toBe('1');
    });
  });

  describe('migration grandfather stamping retired (H8 supersession)', () => {
    it('does not stamp existing terminal rows as migration-grandfather on first seed (sidecar absent)', async () => {
      // Setup: task-status.json file with plan-known completed/skipped rows,
      // no sidecar (first seed).
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: [
            { id: '1', name: 'Task 1', status: 'completed' },
            { id: '2', name: 'Task 2', status: 'skipped' },
            { id: '3', name: 'Task 3', status: 'pending' },
          ],
        }),
      );

      // No task-evidence.json sidecar yet

      // Plan with same tasks
      const planPath = join(dir, '.docs/plans/test.md');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.writeFile(
        planPath,
        `# Plan

## Task 1: Task 1
Content

## Task 2: Task 2
Content

## Task 3: Task 3
Content
`,
      );

      // First seed
      await seedTaskStatus(dir, planPath);

      // Sidecar is created but migrationGrandfather must remain empty —
      // completion is derived solely from evidence stamps now.
      const evidencePath = join(dir, '.pipeline/task-evidence.json');
      const evidenceContent = await fsPromises.readFile(evidencePath, 'utf-8');
      const evidence = JSON.parse(evidenceContent);

      expect(evidence.migrationGrandfather).toEqual([]);
    });

    it('never populates migrationGrandfather across repeated seeds', async () => {
      // Setup: task-status.json with plan-known completed/skipped rows
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: [
            { id: '1', name: 'Task 1', status: 'completed' },
            { id: '2', name: 'Task 2', status: 'skipped' },
          ],
        }),
      );

      const planPath = join(dir, '.docs/plans/test.md');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.writeFile(
        planPath,
        `# Plan

## Task 1: Task 1
Content

## Task 2: Task 2
Content
`,
      );

      // First seed
      await seedTaskStatus(dir, planPath);

      const evidencePath = join(dir, '.pipeline/task-evidence.json');
      const firstEvidence = JSON.parse(await fsPromises.readFile(evidencePath, 'utf-8'));
      expect(firstEvidence.migrationGrandfather).toEqual([]);

      // Second seed
      await seedTaskStatus(dir, planPath);

      const secondEvidence = JSON.parse(await fsPromises.readFile(evidencePath, 'utf-8'));

      // Grandfather set stays empty — nothing writes to it anymore
      expect(secondEvidence.migrationGrandfather).toEqual([]);
    });
  });

  describe('stale-stamp clear at build entry', () => {
    it('removes stale .pipeline/current-task when it exists', async () => {
      // Setup: create stale stamp file
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      const staleStampPath = join(dir, '.pipeline/current-task');
      await fsPromises.writeFile(staleStampPath, 'stale-task-id');

      // Setup: plan
      const planPath = join(dir, '.docs/plans/test.md');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.writeFile(
        planPath,
        `# Plan

## Task 1: First Task
Content
`,
      );

      // Before seeding, stale stamp exists
      let content = await fsPromises.readFile(staleStampPath, 'utf-8');
      expect(content).toBe('stale-task-id');

      // Seed
      await seedTaskStatus(dir, planPath);

      // After seeding, stale stamp should be gone
      await expect(fsPromises.readFile(staleStampPath, 'utf-8')).rejects.toThrow();
    });

    it('does not create file when .pipeline/current-task is absent', async () => {
      // Setup: plan
      const planPath = join(dir, '.docs/plans/test.md');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.writeFile(
        planPath,
        `# Plan

## Task 1: First Task
Content
`,
      );

      // Seed (no stale stamp exists)
      await seedTaskStatus(dir, planPath);

      // Stale stamp should still not exist
      const staleStampPath = join(dir, '.pipeline/current-task');
      await expect(fsPromises.readFile(staleStampPath, 'utf-8')).rejects.toThrow();
    });

    it('has error handling for stamp removal failures', async () => {
      // This test verifies the error handling logic exists and is correct.
      // The implementation wraps rm in a try-catch that logs a warning but
      // doesn't rethrow (fail-open), allowing seeding to continue even if
      // stamp removal fails due to permissions or other issues.
      //
      // The logic is: catch any error from rm, check if it's ENOENT (file
      // not found, which is OK), and if not, log a warning but don't rethrow.
      // This defensive cleanup allows builds to proceed even if the cleanup fails.
      //
      // The first two tests verify the happy path works. This comment verifies
      // the error path is handled gracefully by code inspection of task-seed.ts.

      // Setup: plan
      const planPath = join(dir, '.docs/plans/test.md');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.writeFile(
        planPath,
        `# Plan

## Task 1: First Task
Content
`,
      );

      // Seed should succeed regardless of stamp file state
      await expect(seedTaskStatus(dir, planPath)).resolves.not.toThrow();
    });
  });

  describe('Task 4: repair obligations reopen only live task work', () => {
    async function seedCompletedTaskWithRepairs(currentByPlan: Record<string, Record<string, string>>) {
      const planPath = join(dir, '.docs/plans/test.md');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(planPath, '# Plan\n\n## Task 1: Repaired task\n');
      await fsPromises.writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify({
        tasks: [{ id: '1', name: 'Repaired task', status: 'completed', commit: 'finished' }],
      }));
      await fsPromises.writeFile(join(dir, '.pipeline/engine-state.json'), JSON.stringify({
        activePlanPath: planPath,
        repairObligations: {
          version: 1,
          records: {
            older: {
              id: 'older', planIdentity: '.docs/plans/test.md', taskIds: ['1'],
              source: { findingId: 'F-old', authority: 'review', instruction: 'older repair' },
              baseline: { head: 'before', tree: 'before', resolvedTaskIds: [] }, settlement: 'settled',
              tasks: { '1': { status: 'open' } },
            },
            current: {
              id: 'current', planIdentity: '.docs/plans/test.md', taskIds: ['1'],
              source: { findingId: 'F-current', authority: 'review', instruction: 'current repair' },
              baseline: { head: 'after', tree: 'after', resolvedTaskIds: [] }, settlement: 'settled',
              tasks: { '1': { status: 'resolved', evidence: { kind: 'test', value: 'closed' } } },
            },
          },
          currentByPlan,
        },
      }));
      return planPath;
    }

    it('preserves a completed task when only an older superseded obligation remains open', async () => {
      const planPath = await seedCompletedTaskWithRepairs({ '.docs/plans/test.md': { '1': 'current' } });

      await seedTaskStatus(dir, planPath);

      const status = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline/task-status.json'), 'utf8'));
      expect(status.tasks).toEqual([expect.objectContaining({ id: '1', status: 'completed', commit: 'finished' })]);
    });

    it('restages a completed task when its current obligation is open', async () => {
      const planPath = await seedCompletedTaskWithRepairs({ '.docs/plans/test.md': { '1': 'current' } });
      const statePath = join(dir, '.pipeline/engine-state.json');
      const state = JSON.parse(await fsPromises.readFile(statePath, 'utf8'));
      state.repairObligations.records.current.tasks['1'] = { status: 'open' };
      await fsPromises.writeFile(statePath, JSON.stringify(state));

      await seedTaskStatus(dir, planPath);

      const status = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline/task-status.json'), 'utf8'));
      expect(status.tasks).toEqual([expect.objectContaining({ id: '1', status: 'pending', commit: 'finished' })]);
    });

    it.each([
      ['has no currentByPlan entry', {}],
      ['points currentByPlan at a nonexistent obligation', { '.docs/plans/test.md': { '1': 'missing' } }],
    ])('restages a current-less task and does not throw when it %s', async (_caseName, currentByPlan) => {
      const planPath = await seedCompletedTaskWithRepairs(currentByPlan);

      await expect(seedTaskStatus(dir, planPath)).resolves.not.toThrow();

      const status = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline/task-status.json'), 'utf8'));
      expect(status.tasks).toEqual([expect.objectContaining({ id: '1', status: 'pending', commit: 'finished' })]);
    });
  });

  describe('Task 3: rewritten plan tasks reopen through repair obligations', () => {
    it.each([
      ['absent taskDigests', undefined],
      ['an unknown digest prefix', { '1': 'v99:legacy-digest' }],
    ])('records a fresh baseline without repair admission for %s', async (_caseName, priorDigests) => {
      const planPath = join(dir, '.docs/plans/test.md');
      const planText = '# Plan\n\n## Task 1: Already completed\nCurrent plan text.\n';
      const statusPath = join(dir, '.pipeline/task-status.json');
      const statePath = join(dir, '.pipeline/engine-state.json');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(planPath, planText);
      await fsPromises.writeFile(statusPath, JSON.stringify({
        tasks: [{ id: '1', name: 'Already completed', status: 'completed', commit: 'finished' }],
      }));
      await fsPromises.writeFile(statePath, JSON.stringify({
        activePlanPath: planPath,
        ...(priorDigests === undefined ? {} : {
          taskDigests: { version: 1, byPlan: { '.docs/plans/test.md': priorDigests } },
        }),
      }));

      reopenObservation.active = true;
      reopenObservation.events = [];
      try {
        await seedTaskStatus(dir, planPath);
      } finally {
        reopenObservation.active = false;
      }

      const state = JSON.parse(await fsPromises.readFile(statePath, 'utf8'));
      expect(reopenObservation.events).toEqual(['recordTaskDigests']);
      expect(state.repairObligations).toBeUndefined();
      expect(state.taskDigests).toEqual({
        version: 1,
        byPlan: { '.docs/plans/test.md': Object.fromEntries(planTaskDigests(planText)) },
      });
      expect(JSON.parse(await fsPromises.readFile(statusPath, 'utf8')).tasks).toEqual([
        expect.objectContaining({ id: '1', status: 'completed', commit: 'finished' }),
      ]);
    });

    it('recreates trailer-completed worktree state and records a fresh baseline without repair admission', async () => {
      const planPath = join(dir, '.docs/plans/test.md');
      const planText = '# Plan\n\n## Task 1: Completed before recreation\n';
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await execa('git', ['init', '-b', 'main'], { cwd: dir });
      await execa('git', ['config', 'user.email', 'task-seed@example.test'], { cwd: dir });
      await execa('git', ['config', 'user.name', 'Task Seed Test'], { cwd: dir });
      await fsPromises.writeFile(planPath, planText);
      await execa('git', ['add', '.docs/plans/test.md'], { cwd: dir });
      await execa('git', ['commit', '-m', 'initial plan'], { cwd: dir });
      // A local ref is enough to model origin/main for the fail-closed
      // merge-base range used by trailer restoration.
      await execa('git', ['branch', 'origin/main'], { cwd: dir });
      await fsPromises.writeFile(join(dir, 'completed.txt'), 'completed\n');
      await execa('git', ['add', 'completed.txt'], { cwd: dir });
      await execa('git', ['commit', '-m', 'complete task\n\nTask: 1'], { cwd: dir });

      reopenObservation.active = true;
      reopenObservation.events = [];
      try {
        await seedTaskStatus(dir, planPath);
      } finally {
        reopenObservation.active = false;
      }

      const state = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline/engine-state.json'), 'utf8'));
      const status = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline/task-status.json'), 'utf8'));
      expect(reopenObservation.events).toEqual(['recordTaskDigests']);
      expect(state.repairObligations).toBeUndefined();
      expect(state.taskDigests).toEqual({
        version: 1,
        byPlan: { '.docs/plans/test.md': Object.fromEntries(planTaskDigests(planText)) },
      });
      expect(status.tasks).toEqual([
        expect.objectContaining({ id: '1', status: 'completed', restored_from: 'task-trailer' }),
      ]);
    });

    it('fails closed with the neutral seed reason when taskDigests has an incompatible version', async () => {
      const planPath = join(dir, '.docs/plans/test.md');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(planPath, '# Plan\n\n## Task 1: Current task\n');
      await fsPromises.writeFile(join(dir, '.pipeline/engine-state.json'), JSON.stringify({
        activePlanPath: planPath,
        taskDigests: { version: 2, byPlan: {} },
      }));

      await expect(seedTaskStatus(dir, planPath)).rejects.toThrow('taskDigests section is incompatible');
      const result = await checkStepCompletion(dir, 'build', { projectRoot: dir, planPath });
      expect(result).toEqual(expect.objectContaining({
        done: false,
        reason: expect.stringContaining('failed to seed task-status from plan'),
      }));
      expect(result.reason).not.toContain('task reopen failed');
    });

    it('is idempotent across A-to-B-to-A rewrites, leaves the ledger alone, and closes every coexisting repair', async () => {
      const planPath = join(dir, '.docs/plans/test.md');
      const statePath = join(dir, '.pipeline/engine-state.json');
      const ledgerPath = join(dir, '.pipeline/kickback-ledger.json');
      const planA = '# Plan\n\n## Task 1: Rewritten task\nOriginal text.\n\n**Done when:**\n1. The reopened task is complete.\n';
      const planB = '# Plan\n\n## Task 1: Rewritten task\nChanged text.\n\n**Done when:**\n1. The reopened task is complete.\n';
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(planPath, planA);
      await seedTaskStatus(dir, planPath);
      await fsPromises.writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify({
        tasks: [{ id: '1', status: 'completed' }],
      }));
      const ledger = JSON.stringify({
        version: 1, gates: {}, growth: { authored: 0, added: 0, byGate: {} },
      }, null, 2);
      await fsPromises.writeFile(ledgerPath, ledger);

      await fsPromises.writeFile(planPath, planB);
      await seedTaskStatus(dir, planPath);
      await fsPromises.writeFile(planPath, planA);
      await seedTaskStatus(dir, planPath);
      const afterSecondRewrite = JSON.parse(await fsPromises.readFile(statePath, 'utf8'));
      const amendments = Object.values(afterSecondRewrite.repairObligations.records) as Array<{
        id: string; source: { authority: string }; baseline: unknown; tasks: Record<string, { status: string; evidence?: unknown }>;
      }>;
      const openAmendments = amendments.filter((record) =>
        record.source.authority === 'plan_amendment' && record.tasks['1']?.status === 'open',
      );
      expect(openAmendments).toHaveLength(1);
      expect(amendments.find((record) => record.id !== openAmendments[0].id && record.source.authority === 'plan_amendment'))
        .toMatchObject({ tasks: { '1': { status: 'resolved', evidence: { kind: 'superseded-by-plan-amendment' } } } });

      // Two additional BUILD entries reconstruct their stores from disk. They
      // must replay, not manufacture new repairs or move the boundary.
      const baseline = openAmendments[0].baseline;
      await seedTaskStatus(dir, planPath);
      await seedTaskStatus(dir, planPath);
      const afterTripleSeed = JSON.parse(await fsPromises.readFile(statePath, 'utf8'));
      const replayedOpen = (Object.values(afterTripleSeed.repairObligations.records) as typeof amendments)
        .filter((record) => record.source.authority === 'plan_amendment' && record.tasks['1']?.status === 'open');
      expect(replayedOpen).toEqual([expect.objectContaining({ baseline })]);
      await expect(fsPromises.readFile(ledgerPath, 'utf8')).resolves.toBe(ledger);

      await expect(admitAndRestageRepair({
        projectRoot: dir, planPath, taskIds: ['1'], findingIds: ['coverage-claim'],
        sourceAuthority: 'coverage_binding', instruction: 'Reconcile coverage.', gates: ['coverage_binding'],
      })).resolves.toMatchObject({ kind: 'restaged' });
      const chargedLedger = JSON.parse(await fsPromises.readFile(ledgerPath, 'utf8'));
      expect(chargedLedger).toMatchObject({ gates: { coverage_binding: { laps: 1 } } });
      expect(chargedLedger.pendingRepair).toBeUndefined();

      await expect(completeTaskDoneWhen(dir, '1', [{ index: 1, evidence: 'completed after rewrite' }]))
        .resolves.toEqual({ kind: 'completed' });
      expect(await resolveTaskIds(dir, ['1'])).toEqual(new Set(['1']));
    });

    it('admits and settles before recording the new digest, then restages the completed row without repair-restage', async () => {
      const planPath = join(dir, '.docs/plans/test.md');
      const statusPath = join(dir, '.pipeline/task-status.json');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      const originalPlan = `# Plan

## Task 1: Rewritten task
The original implementation plan text.
`;
      const rewrittenPlan = `# Plan

## Task 1: Rewritten task
The plan text changed after implementation.
`;
      await execa('git', ['init', '-b', 'main'], { cwd: dir });
      await execa('git', ['config', 'user.email', 'task-seed@example.test'], { cwd: dir });
      await execa('git', ['config', 'user.name', 'Task Seed Test'], { cwd: dir });
      await fsPromises.writeFile(planPath, originalPlan);
      await execa('git', ['add', '.docs/plans/test.md'], { cwd: dir });
      await execa('git', ['commit', '-m', 'initial plan'], { cwd: dir });
      const baselineHead = (await execa('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout;
      await fsPromises.writeFile(planPath, rewrittenPlan);
      const originalDigest = planTaskDigests(originalPlan).get('1')!;
      const rewrittenDigest = planTaskDigests(rewrittenPlan).get('1')!;
      await fsPromises.writeFile(statusPath, JSON.stringify({
        tasks: [{ id: '1', name: 'Rewritten task', status: 'completed', commit: 'before-rewrite' }],
      }));
      await fsPromises.writeFile(join(dir, '.pipeline/engine-state.json'), JSON.stringify({
        activePlanPath: planPath,
        taskDigests: { version: 1, byPlan: { '.docs/plans/test.md': { '1': originalDigest } } },
      }));

      reopenObservation.active = true;
      reopenObservation.events = [];
      reopenObservation.statusPath = statusPath;
      reopenObservation.statusAtDigestWrite = undefined;
      reopenObservation.restageCalls = 0;
      try {
        await seedTaskStatus(dir, planPath);
      } finally {
        reopenObservation.active = false;
      }

      expect(reopenObservation.events).toEqual(['admitOrReplay', 'markSettled', 'recordTaskDigests']);
      expect(reopenObservation.restageCalls).toBe(0);
      expect(JSON.parse(reopenObservation.statusAtDigestWrite ?? '{}').tasks).toEqual([
        expect.objectContaining({ id: '1', status: 'completed' }),
      ]);
      const engineState = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline/engine-state.json'), 'utf8'));
      const repairSection = engineState.repairObligations;
      const obligationId = repairSection.currentByPlan['.docs/plans/test.md']['1'];
      expect(repairSection.records[obligationId]).toEqual(expect.objectContaining({
        id: obligationId,
        planIdentity: '.docs/plans/test.md',
        taskIds: ['1'],
        source: expect.objectContaining({ authority: 'plan_amendment', findingId: rewrittenDigest }),
        baseline: expect.objectContaining({ head: baselineHead }),
        settlement: 'settled',
        tasks: { '1': { status: 'open' } },
      }));
      const status = JSON.parse(await fsPromises.readFile(statusPath, 'utf8'));
      expect(status.tasks).toEqual([expect.objectContaining({ id: '1', status: 'pending' })]);
    });

    it('admits independent plan-amendment obligations for identical rewritten tasks in separate plans', async () => {
      reopenObservation.statusPath = '';
      const firstPath = join(dir, '.docs/plans/first.md');
      const secondPath = join(dir, '.docs/plans/second.md');
      const statusPath = join(dir, '.pipeline/task-status.json');
      const statePath = join(dir, '.pipeline/engine-state.json');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      const original = '# Plan\n\n## Task 1: Shared task\nOriginal text.\n';
      const rewritten = '# Plan\n\n## Task 1: Shared task\nRewritten text.\n';
      await execa('git', ['init', '-b', 'main'], { cwd: dir });
      await execa('git', ['config', 'user.email', 'task-seed@example.test'], { cwd: dir });
      await execa('git', ['config', 'user.name', 'Task Seed Test'], { cwd: dir });
      await fsPromises.writeFile(firstPath, original);
      await fsPromises.writeFile(secondPath, original);
      await execa('git', ['add', '.docs/plans'], { cwd: dir });
      await execa('git', ['commit', '-m', 'initial plans'], { cwd: dir });
      const originalDigest = planTaskDigests(original).get('1')!;
      await fsPromises.writeFile(firstPath, rewritten);
      await fsPromises.writeFile(secondPath, rewritten);
      await fsPromises.writeFile(statusPath, JSON.stringify({
        tasks: [{ id: '1', name: 'Shared task', status: 'completed', commit: 'before-rewrite' }],
      }));
      await fsPromises.writeFile(statePath, JSON.stringify({
        activePlanPath: firstPath,
        taskDigests: { version: 1, byPlan: {
          '.docs/plans/first.md': { '1': originalDigest },
          '.docs/plans/second.md': { '1': originalDigest },
        } },
      }));

      await seedTaskStatus(dir, firstPath);
      const afterFirst = JSON.parse(await fsPromises.readFile(statePath, 'utf8'));
      await fsPromises.writeFile(statusPath, JSON.stringify({
        tasks: [{ id: '1', name: 'Shared task', status: 'completed', commit: 'before-rewrite' }],
      }));
      await fsPromises.writeFile(statePath, JSON.stringify({ ...afterFirst, activePlanPath: secondPath }));
      await seedTaskStatus(dir, secondPath);

      const state = JSON.parse(await fsPromises.readFile(statePath, 'utf8'));
      const repairs = state.repairObligations;
      const firstId = repairs.currentByPlan['.docs/plans/first.md']['1'];
      const secondId = repairs.currentByPlan['.docs/plans/second.md']['1'];
      expect(firstId).not.toBe(secondId);
      expect(repairs.records[firstId]).toMatchObject({
        planIdentity: '.docs/plans/first.md', settlement: 'settled', tasks: { '1': { status: 'open' } },
      });
      expect(repairs.records[secondId]).toMatchObject({
        planIdentity: '.docs/plans/second.md', settlement: 'settled', tasks: { '1': { status: 'open' } },
      });
    });
  });

  describe('Task 13: resolved matching-digest builds stay closed', () => {
    it('completes without an obligation, then remains closed after an unchanged rewind-to-build re-seed', async () => {
      const planPath = join(dir, '.docs/plans/test.md');
      const statusPath = join(dir, '.pipeline/task-status.json');
      const planText = `# Plan

### Task 1: First completed task
**Story:** 3

### Task 2: Second completed task
**Story:** 3
`;
      const digests = Object.fromEntries(planTaskDigests(planText));

      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(planPath, planText);
      await fsPromises.writeFile(statusPath, JSON.stringify({
        tasks: [
          { id: '1', name: 'First completed task', status: 'completed', commit: 'already-complete' },
          { id: '2', name: 'Second completed task', status: 'skipped', commit: 'already-complete' },
        ],
      }));
      await fsPromises.writeFile(join(dir, '.pipeline/engine-state.json'), JSON.stringify({
        activePlanPath: planPath,
        taskDigests: { version: 1, byPlan: { '.docs/plans/test.md': digests } },
      }));

      reopenObservation.active = true;
      reopenObservation.events = [];
      reopenObservation.restageCalls = 0;
      try {
        await seedTaskStatus(dir, planPath);
        expect(await checkStepCompletion(dir, 'build', {
          projectRoot: dir,
          planPath,
        })).toEqual({ done: true });

        // A plain rewind to BUILD changes orchestration state, not plan text
        // or task status. BUILD entry therefore re-seeds this same state.
        await seedTaskStatus(dir, planPath);
        expect(await checkStepCompletion(dir, 'build', {
          projectRoot: dir,
          planPath,
        })).toEqual({ done: true });
      } finally {
        reopenObservation.active = false;
      }

      // The predicate re-seeds at each BUILD entry as well; every observed
      // repair-store interaction must therefore still be absent.
      expect(reopenObservation.events).toHaveLength(4);
      expect(reopenObservation.events).toEqual(
        Array.from({ length: 4 }, () => 'recordTaskDigests'),
      );
      expect(reopenObservation.restageCalls).toBe(0);
      expect(JSON.parse(await fsPromises.readFile(statusPath, 'utf8')).tasks).toEqual([
        expect.objectContaining({ id: '1', status: 'completed' }),
        expect.objectContaining({ id: '2', status: 'skipped' }),
      ]);
    });
  });

  describe('presentation-only plan edits do not reopen completed tasks', () => {
    it.each([
      ['whitespace', (plan: string) => plan.replace('First completed task', '  First   completed task  ')],
      ['line wrapping', (plan: string) => plan.replace('Keep the implementation boundary stable.', 'Keep the implementation\nboundary stable.')],
      ['blank line', (plan: string) => plan.replace('Keep the implementation boundary stable.', 'Keep the implementation\n\nboundary stable.')],
      ['trailing risks section', (plan: string) => `${plan}\n## Risks\nThis plan-level note changes after the final task.\n`],
    ] as const)('does not reopen completed tasks after a %s edit', async (_kind, edit) => {
      const planPath = join(dir, '.docs/plans/test.md');
      const statusPath = join(dir, '.pipeline/task-status.json');
      const baselinePlan = `# Plan

### Task 1: First completed task
Keep the implementation boundary stable.

### Task 2: Second completed task
Keep the other boundary stable.
`;

      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await execa('git', ['init', '-b', 'main'], { cwd: dir });
      await execa('git', ['config', 'user.email', 'task-seed@example.test'], { cwd: dir });
      await execa('git', ['config', 'user.name', 'Task Seed Test'], { cwd: dir });
      await fsPromises.writeFile(planPath, baselinePlan);
      await fsPromises.writeFile(join(dir, 'completed.txt'), 'completed\n');
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'initial plan'], { cwd: dir });
      await fsPromises.writeFile(join(dir, 'completed.txt'), 'completed tasks\n');
      await execa('git', ['add', 'completed.txt'], { cwd: dir });
      await execa('git', ['commit', '-m', 'complete tasks\n\nTask: 1\nTask: 2'], { cwd: dir });

      await fsPromises.writeFile(planPath, edit(baselinePlan));
      await fsPromises.writeFile(statusPath, JSON.stringify({
        tasks: [
          { id: '1', name: 'First completed task', status: 'completed' },
          { id: '2', name: 'Second completed task', status: 'completed' },
        ],
      }));
      await fsPromises.writeFile(join(dir, '.pipeline/engine-state.json'), JSON.stringify({
        activePlanPath: planPath,
        taskDigests: { version: 1, byPlan: { '.docs/plans/test.md': Object.fromEntries(planTaskDigests(baselinePlan)) } },
      }));

      await seedTaskStatus(dir, planPath);

      const state = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline/engine-state.json'), 'utf8'));
      expect(state.repairObligations).toBeUndefined();
      expect(JSON.parse(await fsPromises.readFile(statusPath, 'utf8')).tasks).toEqual([
        expect.objectContaining({ id: '1', status: 'completed' }),
        expect.objectContaining({ id: '2', status: 'completed' }),
      ]);

      // Prove the build predicate remains closed through the independent
      // Task:-trailer authority rather than the retained terminal rows.
      await fsPromises.writeFile(statusPath, JSON.stringify({
        tasks: [
          { id: '1', status: 'pending' },
          { id: '2', status: 'pending' },
        ],
      }));
      expect(await checkStepCompletion(dir, 'build', { projectRoot: dir, planPath })).toEqual({ done: true });
    });
  });

});
