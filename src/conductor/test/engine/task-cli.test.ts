import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { detectTaskCommand, runTaskStart } from '../../src/engine/task-cli.js';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('detectTaskCommand', () => {
  describe('start command', () => {
    it('detects: conduct task start <id>', () => {
      expect(detectTaskCommand(['node', 'conduct', 'task', 'start', '7'])).toEqual({
        kind: 'start',
        id: '7',
      });
    });

    it('detects: conduct task start with alphanumeric id', () => {
      expect(detectTaskCommand(['node', 'conduct', 'task', 'start', 'rem-fr10-1'])).toEqual({
        kind: 'start',
        id: 'rem-fr10-1',
      });
    });

    it('detects: conduct task start with numeric id', () => {
      expect(detectTaskCommand(['node', 'conduct', 'task', 'start', '42'])).toEqual({
        kind: 'start',
        id: '42',
      });
    });
  });

  describe('done command', () => {
    it('detects: conduct task done <id>', () => {
      expect(detectTaskCommand(['node', 'conduct', 'task', 'done', '7'])).toEqual({
        kind: 'done',
        id: '7',
      });
    });

    it('detects: conduct task done with alphanumeric id', () => {
      expect(detectTaskCommand(['node', 'conduct', 'task', 'done', 'rem-fr10-1'])).toEqual({
        kind: 'done',
        id: 'rem-fr10-1',
      });
    });

    it('detects: conduct task done with numeric id', () => {
      expect(detectTaskCommand(['node', 'conduct', 'task', 'done', '42'])).toEqual({
        kind: 'done',
        id: '42',
      });
    });
  });

  describe('guide / malformed', () => {
    it('returns guide for bare "task" (no verb)', () => {
      expect(detectTaskCommand(['node', 'conduct', 'task'])).toEqual({
        kind: 'guide',
      });
    });

    it('returns guide for unknown verb', () => {
      expect(detectTaskCommand(['node', 'conduct', 'task', 'invalid', '7'])).toEqual({
        kind: 'guide',
      });
    });

    it('returns guide for missing id', () => {
      expect(detectTaskCommand(['node', 'conduct', 'task', 'start'])).toEqual({
        kind: 'guide',
      });
    });

    it('returns guide for missing id with done verb', () => {
      expect(detectTaskCommand(['node', 'conduct', 'task', 'done'])).toEqual({
        kind: 'guide',
      });
    });

    it('returns guide for malformed: empty id', () => {
      expect(detectTaskCommand(['node', 'conduct', 'task', 'start', ''])).toEqual({
        kind: 'guide',
      });
    });
  });

  describe('non-task commands', () => {
    it('returns null for non-task subcommand', () => {
      expect(detectTaskCommand(['node', 'conduct', 'derive-feedback', '--sha', 'abc'])).toBeNull();
    });

    it('returns null for no subcommand at all', () => {
      expect(detectTaskCommand(['node', 'conduct'])).toBeNull();
    });

    it('returns null for arbitrary argv not containing task', () => {
      expect(detectTaskCommand(['some', 'other', 'command'])).toBeNull();
    });
  });
});

describe('runTaskStart', () => {
  let dir: string;
  let stdErr: string[];

  beforeEach(async () => {
    dir = await fsPromises.mkdtemp(join(tmpdir(), 'task-cli-test-'));
    stdErr = [];
    const origError = console.error;
    console.error = (...args: any[]) => {
      stdErr.push(args.join(' '));
      origError(...args);
    };
  });

  afterEach(async () => {
    await fsPromises.rm(dir, { recursive: true, force: true });
  });

  describe('happy path — start row 7', () => {
    it('flips row 7 to in_progress and leaves others unchanged', async () => {
      // Setup: seed task-status.json with 12 pending rows (1..12)
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      const tasks = Array.from({ length: 12 }, (_, i) => ({
        id: String(i + 1),
        name: `Task ${i + 1}`,
        status: 'pending',
      }));
      await fsPromises.writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks }, null, 2),
      );

      // Call runTaskStart
      const exitCode = await runTaskStart(dir, '7');
      expect(exitCode).toBe(0);

      // Verify row 7 is now in_progress
      const statusPath = join(dir, '.pipeline/task-status.json');
      const content = await fsPromises.readFile(statusPath, 'utf-8');
      const status = JSON.parse(content);

      const task7 = status.tasks.find((t: any) => t.id === '7');
      expect(task7.status).toBe('in_progress');

      // Verify other rows remain pending
      const task1 = status.tasks.find((t: any) => t.id === '1');
      expect(task1.status).toBe('pending');

      const task6 = status.tasks.find((t: any) => t.id === '6');
      expect(task6.status).toBe('pending');

      const task8 = status.tasks.find((t: any) => t.id === '8');
      expect(task8.status).toBe('pending');

      const task12 = status.tasks.find((t: any) => t.id === '12');
      expect(task12.status).toBe('pending');
    });

    it('creates .pipeline/current-task with exact id value', async () => {
      // Setup: seed task-status.json
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      const tasks = Array.from({ length: 12 }, (_, i) => ({
        id: String(i + 1),
        name: `Task ${i + 1}`,
        status: 'pending',
      }));
      await fsPromises.writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks }, null, 2),
      );

      // Call runTaskStart
      const exitCode = await runTaskStart(dir, '7');
      expect(exitCode).toBe(0);

      // Verify stamp file exists with exact value
      const stampPath = join(dir, '.pipeline/current-task');
      const stampContent = await fsPromises.readFile(stampPath, 'utf-8');
      expect(stampContent).toBe('7');
    });

    it('overwrites stamp on second call', async () => {
      // Setup: seed task-status.json
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      const tasks = Array.from({ length: 12 }, (_, i) => ({
        id: String(i + 1),
        name: `Task ${i + 1}`,
        status: 'pending',
      }));
      await fsPromises.writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks }, null, 2),
      );

      // First call: start task 7
      const exitCode1 = await runTaskStart(dir, '7');
      expect(exitCode1).toBe(0);

      const stampPath = join(dir, '.pipeline/current-task');
      let stampContent = await fsPromises.readFile(stampPath, 'utf-8');
      expect(stampContent).toBe('7');

      // Second call: start task 8
      const exitCode2 = await runTaskStart(dir, '8');
      expect(exitCode2).toBe(0);

      // Verify stamp is now '8'
      stampContent = await fsPromises.readFile(stampPath, 'utf-8');
      expect(stampContent).toBe('8');

      // Verify both rows are in_progress
      const statusPath = join(dir, '.pipeline/task-status.json');
      const content = await fsPromises.readFile(statusPath, 'utf-8');
      const status = JSON.parse(content);

      const task7 = status.tasks.find((t: any) => t.id === '7');
      expect(task7.status).toBe('in_progress');

      const task8 = status.tasks.find((t: any) => t.id === '8');
      expect(task8.status).toBe('in_progress');
    });
  });

  describe('negative paths — error cases', () => {
    describe('unknown id → non-zero, stderr lists valid ids, files unchanged', () => {
      it('returns non-zero when id 99 does not exist', async () => {
        // Setup: seed task-status.json with tasks 1..5
        await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
        const tasks = Array.from({ length: 5 }, (_, i) => ({
          id: String(i + 1),
          name: `Task ${i + 1}`,
          status: 'pending',
        }));
        await fsPromises.writeFile(
          join(dir, '.pipeline/task-status.json'),
          JSON.stringify({ tasks }, null, 2),
        );

        // Call runTaskStart with unknown id
        const exitCode = await runTaskStart(dir, '99');
        expect(exitCode).not.toBe(0);
      });

      it('does not modify task-status.json when id is unknown', async () => {
        // Setup: seed task-status.json
        await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
        const tasks = Array.from({ length: 3 }, (_, i) => ({
          id: String(i + 1),
          name: `Task ${i + 1}`,
          status: 'pending',
        }));
        const original = JSON.stringify({ tasks }, null, 2);
        await fsPromises.writeFile(join(dir, '.pipeline/task-status.json'), original);

        // Try to start unknown id
        await runTaskStart(dir, '99');

        // Verify file is byte-identical
        const statusPath = join(dir, '.pipeline/task-status.json');
        const current = await fsPromises.readFile(statusPath, 'utf-8');
        expect(current).toBe(original);
      });

      it('does not write stamp file when id is unknown', async () => {
        // Setup: seed task-status.json
        await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
        const tasks = Array.from({ length: 3 }, (_, i) => ({
          id: String(i + 1),
          name: `Task ${i + 1}`,
          status: 'pending',
        }));
        await fsPromises.writeFile(
          join(dir, '.pipeline/task-status.json'),
          JSON.stringify({ tasks }, null, 2),
        );

        // Try to start unknown id
        await runTaskStart(dir, '99');

        // Verify stamp file does not exist
        const stampPath = join(dir, '.pipeline/current-task');
        let stampExists = false;
        try {
          await fsPromises.readFile(stampPath, 'utf-8');
          stampExists = true;
        } catch {
          stampExists = false;
        }
        expect(stampExists).toBe(false);
      });

      it('includes list of valid ids in error message', async () => {
        // Setup: seed task-status.json with specific ids
        await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
        const tasks = [
          { id: '7', name: 'Task 7', status: 'pending' },
          { id: 'rem-fr10-1', name: 'Task rem-fr10-1', status: 'pending' },
          { id: '42', name: 'Task 42', status: 'pending' },
        ];
        await fsPromises.writeFile(
          join(dir, '.pipeline/task-status.json'),
          JSON.stringify({ tasks }, null, 2),
        );

        // Clear stderr capture
        stdErr = [];

        // Try to start unknown id
        await runTaskStart(dir, '99');

        // Verify error message lists valid ids
        const errorOutput = stdErr.join('\n');
        expect(errorOutput).toMatch(/valid ids/i);
        expect(errorOutput).toContain('7');
        expect(errorOutput).toContain('rem-fr10-1');
        expect(errorOutput).toContain('42');
      });
    });

    describe('absent task-status.json → non-zero, names missing file', () => {
      it('returns non-zero when task-status.json does not exist', async () => {
        // Setup: pipeline dir exists but no task-status.json
        await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });

        // Call runTaskStart
        const exitCode = await runTaskStart(dir, '7');
        expect(exitCode).not.toBe(0);
      });

      it('does not write current-task when task-status.json is missing', async () => {
        // Setup: pipeline dir exists but no task-status.json
        await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });

        // Call runTaskStart
        await runTaskStart(dir, '7');

        // Verify no stamp file was written
        const stampPath = join(dir, '.pipeline/current-task');
        let stampExists = false;
        try {
          await fsPromises.readFile(stampPath, 'utf-8');
          stampExists = true;
        } catch {
          stampExists = false;
        }
        expect(stampExists).toBe(false);
      });
    });

    describe('corrupt JSON → non-zero, file not overwritten, no stamp', () => {
      it('returns non-zero when task-status.json is corrupt JSON', async () => {
        // Setup: pipeline dir with corrupt JSON
        await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
        await fsPromises.writeFile(join(dir, '.pipeline/task-status.json'), '{ invalid json }');

        // Call runTaskStart
        const exitCode = await runTaskStart(dir, '7');
        expect(exitCode).not.toBe(0);
      });

      it('does not overwrite corrupt task-status.json', async () => {
        // Setup: pipeline dir with corrupt JSON
        await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
        const corruptContent = '{ invalid json }';
        await fsPromises.writeFile(join(dir, '.pipeline/task-status.json'), corruptContent);

        // Try to start a task
        await runTaskStart(dir, '7');

        // Verify file is still corrupt (unchanged)
        const statusPath = join(dir, '.pipeline/task-status.json');
        const current = await fsPromises.readFile(statusPath, 'utf-8');
        expect(current).toBe(corruptContent);
      });

      it('does not write stamp file when JSON is corrupt', async () => {
        // Setup: pipeline dir with corrupt JSON
        await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
        await fsPromises.writeFile(join(dir, '.pipeline/task-status.json'), '{ invalid json }');

        // Try to start a task
        await runTaskStart(dir, '7');

        // Verify no stamp file was written
        const stampPath = join(dir, '.pipeline/current-task');
        let stampExists = false;
        try {
          await fsPromises.readFile(stampPath, 'utf-8');
          stampExists = true;
        } catch {
          stampExists = false;
        }
        expect(stampExists).toBe(false);
      });
    });
  });
});
