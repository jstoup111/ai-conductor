import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import {
  parsePlanTasks,
  taskTrailerMatches,
  canonicalTaskId,
  reconcileStatusFromStamps,
} from '../../src/engine/autoheal.js';
import { parsePlanTaskPaths } from '../../src/engine/plan-task-parse.js';
import { seedTaskStatus } from '../../src/engine/task-seed.js';
import { createTaskEvidence } from '../../src/engine/task-evidence.js';

// #636: #615 widened plan-header parsing to accept `### T<N> — Title` but
// normalized those ids to BARE numbers, orphaning the T-prefixed rows,
// `Task: T<N>` trailers, and evidence stamps that predate #615. This suite
// locks: one plan task = one row regardless of header shape, and trailers in
// either grammar (`T<N>` or `<N>`) resolve the SAME task.

describe('#636 T<N> ↔ <N> id-grammar alias', () => {
  describe('canonicalTaskId', () => {
    it('folds a leading T/t before a digit to the bare numeric key', () => {
      expect(canonicalTaskId('T1')).toBe('1');
      expect(canonicalTaskId('t3')).toBe('3');
      expect(canonicalTaskId('T0')).toBe('0');
      expect(canonicalTaskId('1')).toBe('1');
    });

    it('leaves non-T ids untouched (task-7, rem-adr-001, A8)', () => {
      expect(canonicalTaskId('task-7')).toBe('task-7');
      expect(canonicalTaskId('rem-adr-001')).toBe('rem-adr-001');
      expect(canonicalTaskId('A8')).toBe('A8');
      // A leading T NOT followed by a digit is a real id, not a prefix.
      expect(canonicalTaskId('Task')).toBe('Task');
    });
  });

  describe('parser emits the id as written in the plan header', () => {
    const plan = `# Plan

### T1 — First
### T2 — Second

### Task 3 — Third
`;

    it('parsePlanTasks keeps the T prefix for T<N> headers, bare for Task N', () => {
      const tasks = parsePlanTasks(plan);
      const ids = Array.from(tasks.keys());
      expect(ids).toContain('T1');
      expect(ids).toContain('T2');
      expect(ids).toContain('3');
      // No bare shadow ids for the T headers.
      expect(ids).not.toContain('1');
      expect(ids).not.toContain('2');
    });

    it('parsePlanTaskPaths keeps the T prefix for T<N> headers', () => {
      const ids = Array.from(parsePlanTaskPaths(plan).keys());
      expect(ids).toContain('T1');
      expect(ids).toContain('T2');
      expect(ids).toContain('3');
      expect(ids).not.toContain('1');
      expect(ids).not.toContain('2');
    });
  });

  describe('#620 heading corpus still parses to single, correct rows', () => {
    it('no phantom "Graph"/"Dependency"; Task N / T0 / bare Task 2 all parse once', () => {
      const plan = `# Plan

## Task dependency graph
Some prose.

## Task Graph
More prose.

### Task 1 — A
### T0 — B
### Task 2
`;
      const ids = Array.from(parsePlanTaskPaths(plan).keys());
      expect(ids).not.toContain('Graph');
      expect(ids).not.toContain('Dependency');
      expect(ids).not.toContain('dependency');
      expect(ids.sort()).toEqual(['1', '2', 'T0'].sort());
    });
  });

  describe('taskTrailerMatches aliases T<N> ↔ <N>', () => {
    const planIds = new Set(['T0', 'T3']);
    it('bare trailer resolves a T-prefixed task id', () => {
      expect(taskTrailerMatches(['0'], 'T0', planIds)).toBe(true);
      expect(taskTrailerMatches(['3'], 'T3', planIds)).toBe(true);
    });
    it('T-prefixed trailer resolves a bare task id', () => {
      expect(taskTrailerMatches(['T3'], '3', new Set(['3']))).toBe(true);
    });
    it('does not cross-match different numbers', () => {
      expect(taskTrailerMatches(['2'], 'T3', planIds)).toBe(false);
    });
  });

  describe('seedTaskStatus migrates the 18-row split back to 9 rows', () => {
    let dir: string;
    beforeEach(async () => {
      dir = await fsPromises.mkdtemp(join(tmpdir(), 'grammar-seed-'));
    });
    afterEach(async () => {
      await fsPromises.rm(dir, { recursive: true, force: true });
    });

    it('collapses duplicate T<N>/<N> rows and keeps the advanced T-row', async () => {
      const planPath = join(dir, '.docs/plans/port.md');
      await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
      // Plan uses `### T<N> — Title` headers, T1..T9 (real fixture shape).
      const headers = Array.from({ length: 9 }, (_, i) => `### T${i + 1} — Task ${i + 1}`).join('\n\n');
      await fsPromises.writeFile(planPath, `# Plan\n\n## Tasks\n\n${headers}\n`);

      // Existing task-status.json already split into 18 rows: the T-family
      // carries real progress; the bare family are #615's phantom rows.
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      const tRows = [
        { id: 'T1', name: 'Task 1', status: 'completed' },
        { id: 'T2', name: 'Task 2', status: 'pending' },
        { id: 'T3', name: 'Task 3', status: 'in_progress' },
        { id: 'T4', name: 'Task 4', status: 'in_progress' },
        ...Array.from({ length: 5 }, (_, i) => ({ id: `T${i + 5}`, name: `Task ${i + 5}`, status: 'pending' })),
      ];
      const bareRows = Array.from({ length: 9 }, (_, i) => ({ id: String(i + 1), name: `Task ${i + 1}`, status: 'pending' }));
      await fsPromises.writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ plan_ref: '.docs/plans/port.md', tasks: [...tRows, ...bareRows] }, null, 2),
      );

      await seedTaskStatus(dir, planPath);

      const status = JSON.parse(
        await fsPromises.readFile(join(dir, '.pipeline/task-status.json'), 'utf-8'),
      );
      // Exactly 9 rows — no phantom bare duplicates.
      expect(status.tasks).toHaveLength(9);
      // Rows keyed to the plan grammar (T-prefixed).
      const ids = status.tasks.map((t: any) => t.id).sort();
      expect(ids).toEqual(['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9'].sort());
      // In-progress progress on T3/T4 is preserved through the merge.
      const t3 = status.tasks.find((t: any) => t.id === 'T3');
      expect(t3.status).toBe('in_progress');
      const t4 = status.tasks.find((t: any) => t.id === 'T4');
      expect(t4.status).toBe('in_progress');
    });
  });

  describe('reconcileStatusFromStamps aliases stamp id ↔ row id', () => {
    let dir: string;
    beforeEach(async () => {
      dir = await fsPromises.mkdtemp(join(tmpdir(), 'grammar-recon-'));
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
    });
    afterEach(async () => {
      await fsPromises.rm(dir, { recursive: true, force: true });
    });

    it('a bare-keyed stamp advances a T-prefixed in_progress row', async () => {
      await fsPromises.writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: 'T3', name: 'Task 3', status: 'in_progress' }] }, null, 2),
      );
      const evidence = await createTaskEvidence(dir);
      evidence.evidenceStamps.set('3', { sha: 'deadbeefdeadbeef', form: 'trailer' });
      await evidence.write();

      const res = await reconcileStatusFromStamps(dir);
      expect(res.synced).toContain('T3');
      const status = JSON.parse(
        await fsPromises.readFile(join(dir, '.pipeline/task-status.json'), 'utf-8'),
      );
      expect(status.tasks.find((t: any) => t.id === 'T3').status).toBe('completed');
      expect(res.orphanStamps).not.toContain('3');
    });
  });
});
