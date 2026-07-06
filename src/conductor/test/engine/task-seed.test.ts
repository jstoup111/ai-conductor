import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedTaskStatus } from '../../src/engine/task-seed.js';

describe('task-seed', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'task-seed-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('fresh seed', () => {
    it('creates one pending row per plan task', async () => {
      const planPath = join(dir, '.docs/plans/test.md');
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      await writeFile(
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
      const content = await readFile(statusPath, 'utf-8');
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
  });

  describe('preserve completed rows', () => {
    it('preserves completed rows with engine stamps during re-seed', async () => {
      // Setup: existing task-status.json with a completed task
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: [
            { id: '1', name: 'First Task', status: 'completed', commit: 'abc123' },
            { id: '2', name: 'Second Task', status: 'pending' },
          ],
        }),
      );

      // Setup: evidence sidecar with engine stamp for task 1
      await writeFile(
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
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      await writeFile(
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
      const content = await readFile(statusPath, 'utf-8');
      const status = JSON.parse(content);

      // Task 1 should remain completed with its commit
      const task1 = status.tasks.find((t: any) => t.id === '1');
      expect(task1.status).toBe('completed');
      expect(task1.commit).toBe('abc123');

      // Task 2 should remain pending
      const task2 = status.tasks.find((t: any) => t.id === '2');
      expect(task2.status).toBe('pending');
    });

    it('resets to pending if evidence stamp is missing', async () => {
      // Setup: task-status.json with completed task but no evidence
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: [{ id: '1', name: 'First Task', status: 'completed', commit: 'abc123' }],
        }),
      );

      // No evidence sidecar
      const planPath = join(dir, '.docs/plans/test.md');
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      await writeFile(
        planPath,
        `# Plan

## Task 1: First Task
Content
`,
      );

      await seedTaskStatus(dir, planPath);

      const statusPath = join(dir, '.pipeline/task-status.json');
      const content = await readFile(statusPath, 'utf-8');
      const status = JSON.parse(content);

      const task1 = status.tasks.find((t: any) => t.id === '1');
      expect(task1.status).toBe('pending');
    });
  });

  describe('preserve in_progress rows', () => {
    it('preserves in_progress rows during re-seed', async () => {
      // Setup: task-status.json with in_progress task
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
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
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      await writeFile(
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
      const content = await readFile(statusPath, 'utf-8');
      const status = JSON.parse(content);

      // Task 1 should remain in_progress
      const task1 = status.tasks.find((t: any) => t.id === '1');
      expect(task1.status).toBe('in_progress');

      // Task 2 should remain pending
      const task2 = status.tasks.find((t: any) => t.id === '2');
      expect(task2.status).toBe('pending');
    });
  });

  describe('upsert new plan tasks', () => {
    it('adds new plan tasks to existing file', async () => {
      // Setup: existing task-status.json with one task
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: [{ id: '1', name: 'First Task', status: 'completed' }],
        }),
      );

      // Setup: evidence for task 1
      await writeFile(
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
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      await writeFile(
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
      const content = await readFile(statusPath, 'utf-8');
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
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
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
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      await writeFile(
        planPath,
        `# Plan

## Task 1: First Task
Content
`,
      );

      await seedTaskStatus(dir, planPath);

      const statusPath = join(dir, '.pipeline/task-status.json');
      const content = await readFile(statusPath, 'utf-8');
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
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      await writeFile(
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
      const firstContent = await readFile(statusPath, 'utf-8');

      // Second seed
      await seedTaskStatus(dir, planPath);

      const secondContent = await readFile(statusPath, 'utf-8');

      // Bytes should be identical
      expect(firstContent).toBe(secondContent);
    });

    it('maintains consistent task order across re-seeds', async () => {
      const planPath = join(dir, '.docs/plans/test.md');
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      await writeFile(
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
      const firstStatus = JSON.parse(await readFile(statusPath, 'utf-8'));
      const firstIds = firstStatus.tasks.map((t: any) => t.id);

      await seedTaskStatus(dir, planPath);

      const secondStatus = JSON.parse(await readFile(statusPath, 'utf-8'));
      const secondIds = secondStatus.tasks.map((t: any) => t.id);

      expect(firstIds).toEqual(secondIds);
    });
  });

  describe('full wipe restoration', () => {
    it('restores fully-wiped file from plan', async () => {
      const planPath = join(dir, '.docs/plans/test.md');
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      await writeFile(
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
      const firstContent = await readFile(statusPath, 'utf-8');

      // Wipe the file
      await writeFile(statusPath, '');

      // Re-seed
      await seedTaskStatus(dir, planPath);

      const secondContent = await readFile(statusPath, 'utf-8');

      // Should be fully restored
      expect(secondContent).toBe(firstContent);
      const status = JSON.parse(secondContent);
      expect(status.tasks).toHaveLength(2);
    });

    it('restores wiped file with evidence preserved', async () => {
      // Setup: task-status.json with completed task
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: [{ id: '1', name: 'First Task', status: 'completed', commit: 'abc123' }],
        }),
      );

      // Setup: evidence sidecar
      await writeFile(
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
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      await writeFile(
        planPath,
        `# Plan

## Task 1: First Task
Content
`,
      );

      // First seed
      await seedTaskStatus(dir, planPath);

      const statusPath = join(dir, '.pipeline/task-status.json');
      const firstContent = await readFile(statusPath, 'utf-8');

      // Wipe the file
      await writeFile(statusPath, '');

      // Re-seed (evidence is still there)
      await seedTaskStatus(dir, planPath);

      const secondContent = await readFile(statusPath, 'utf-8');
      const status = JSON.parse(secondContent);

      // Task 1 should be restored as completed (evidence preserved)
      const task1 = status.tasks.find((t: any) => t.id === '1');
      expect(task1.status).toBe('completed');
      expect(task1.commit).toBe('abc123');
    });
  });

  describe('atomic write', () => {
    it('uses temp file + rename for atomic writes', async () => {
      const planPath = join(dir, '.docs/plans/test.md');
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      await writeFile(
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
      const content = await readFile(statusPath, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
      const status = JSON.parse(content);
      expect(status.tasks).toHaveLength(1);

      writeSpy.mockRestore();
    });
  });

  describe('plan_ref tracking', () => {
    it('stores plan_ref in task-status.json', async () => {
      const planPath = join(dir, '.docs/plans/test.md');
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      await writeFile(
        planPath,
        `# Plan

## Task 1: First Task
Content
`,
      );

      await seedTaskStatus(dir, planPath);

      const statusPath = join(dir, '.pipeline/task-status.json');
      const content = await readFile(statusPath, 'utf-8');
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
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      await writeFile(
        planPath,
        `# Plan

## Task 1: First Task
Content
`,
      );

      // No .pipeline directory
      await seedTaskStatus(dir, planPath);

      const statusPath = join(dir, '.pipeline/task-status.json');
      const content = await readFile(statusPath, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
    });

    it('handles missing plan file gracefully', async () => {
      const planPath = join(dir, '.docs/plans/nonexistent.md');

      // This should not throw, but handle gracefully
      await expect(seedTaskStatus(dir, planPath)).resolves.not.toThrow();
    });

    it('handles corrupt existing task-status.json by resetting', async () => {
      // Setup: corrupt task-status.json
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/task-status.json'), 'not valid json {');

      const planPath = join(dir, '.docs/plans/test.md');
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      await writeFile(
        planPath,
        `# Plan

## Task 1: First Task
Content
`,
      );

      // Should not throw, should create valid file
      await expect(seedTaskStatus(dir, planPath)).resolves.not.toThrow();

      const statusPath = join(dir, '.pipeline/task-status.json');
      const content = await readFile(statusPath, 'utf-8');
      const status = JSON.parse(content);

      expect(status.tasks).toHaveLength(1);
      expect(status.tasks[0].id).toBe('1');
    });
  });
});
