// Covers: task:1, task:2, task:3, task:26, task:15
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  detectTaskCommand,
  dispatchTaskCommand,
  runTaskStart,
  runTaskDone,
} from '../../src/engine/task-cli.js';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { createRepairObligationStore } from '../../src/engine/repair-obligations.js';
import { resolveTaskIds } from '../../src/engine/task-progress.js';
import { writeCoverageBindingEnvelope } from '../../src/engine/coverage-binding-envelope.js';

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

    it('detects one raw --child value while retaining other extra arguments', () => {
      expect(detectTaskCommand(['node', 'conduct', 'task', 'start', '7', '--child', '2'])).toEqual({
        kind: 'start',
        id: '7',
        child: '2',
      });
      expect(detectTaskCommand(['node', 'conduct', 'task', 'start', '7', '--foo', 'bar'])).toEqual({
        kind: 'start',
        id: '7',
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

    it('detects one raw --child value alongside Done when evidence', () => {
      expect(detectTaskCommand([
        'node', 'conduct', 'task', 'done', '7', '--child', '2', '--done-when', '1=ok',
      ])).toEqual({
        kind: 'done',
        id: '7',
        child: '2',
        doneWhen: [{ index: 1, evidence: 'ok' }],
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

  describe('--child malformed forms', () => {
    it.each([
      ['start duplicate', ['node', 'conduct', 'task', 'start', '7', '--child', '2', '--child', '2']],
      ['start missing value', ['node', 'conduct', 'task', 'start', '7', '--child']],
      ['done duplicate', ['node', 'conduct', 'task', 'done', '7', '--child', '2', '--child', '2']],
      ['done missing value', ['node', 'conduct', 'task', 'done', '7', '--child']],
    ])('returns guide for %s', (_name, argv) => {
      expect(detectTaskCommand(argv)).toEqual({ kind: 'guide' });
    });

    it('prints the current guide, returns 2, and leaves task files unchanged', async () => {
      const dir = await fsPromises.mkdtemp(join(tmpdir(), 'task-cli-child-guide-'));
      const pipeline = join(dir, '.pipeline');
      const statusPath = join(pipeline, 'task-status.json');
      const stampPath = join(pipeline, 'current-task');
      const status = JSON.stringify({ tasks: [{ id: '7', status: 'in_progress' }] }, null, 2);
      await fsPromises.mkdir(pipeline, { recursive: true });
      await fsPromises.writeFile(statusPath, status);
      await fsPromises.writeFile(stampPath, '7');

      const originalError = console.error;
      const stderr: string[] = [];
      console.error = (...args: unknown[]) => { stderr.push(args.join(' ')); };
      try {
        for (const argv of [
          ['node', 'conduct', 'task', 'start', '7', '--child', '2', '--child', '2'],
          ['node', 'conduct', 'task', 'start', '7', '--child'],
          ['node', 'conduct', 'task', 'done', '7', '--child', '2', '--child', '2'],
          ['node', 'conduct', 'task', 'done', '7', '--child'],
        ]) {
          const command = detectTaskCommand(argv);
          expect(command).toEqual({ kind: 'guide' });
          expect(await dispatchTaskCommand(command!, dir)).toBe(2);
        }
      } finally {
        console.error = originalError;
      }

      expect(stderr.join('\n')).toContain('conduct task start <id>');
      await expect(fsPromises.readFile(statusPath, 'utf-8')).resolves.toBe(status);
      await expect(fsPromises.readFile(stampPath, 'utf-8')).resolves.toBe('7');
      await fsPromises.rm(dir, { recursive: true, force: true });
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

describe('task command no-child argv compatibility', () => {
  async function seedStartedTask(dir: string): Promise<void> {
    await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
    await fsPromises.writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({
      tasks: [{ id: '7', status: 'pending' }],
    }, null, 2));
  }

  async function runAndCapture(dir: string, argv: string[]) {
    const command = detectTaskCommand(argv);
    if (!command) throw new Error('expected task command');
    const originalError = console.error;
    const originalLog = console.log;
    const stderr: string[] = [];
    const stdout: string[] = [];
    console.error = (...args: unknown[]) => { stderr.push(args.join(' ')); };
    console.log = (...args: unknown[]) => { stdout.push(args.join(' ')); };
    try {
      const exitCode = await dispatchTaskCommand(command, dir);
      return { exitCode, stdout, stderr };
    } finally {
      console.error = originalError;
      console.log = originalLog;
    }
  }

  it('keeps start output and task files byte-identical when non-child argv is ignored', async () => {
    const base = await fsPromises.mkdtemp(join(tmpdir(), 'task-cli-base-'));
    const extra = await fsPromises.mkdtemp(join(tmpdir(), 'task-cli-extra-'));
    try {
      await Promise.all([seedStartedTask(base), seedStartedTask(extra)]);
      const baseline = await runAndCapture(base, ['node', 'conduct', 'task', 'start', '7']);
      const withExtra = await runAndCapture(extra, ['node', 'conduct', 'task', 'start', '7', '--foo', 'bar']);

      expect(withExtra).toEqual(baseline);
      await expect(fsPromises.readFile(join(extra, '.pipeline', 'task-status.json'), 'utf-8'))
        .resolves.toBe(await fsPromises.readFile(join(base, '.pipeline', 'task-status.json'), 'utf-8'));
      await expect(fsPromises.readFile(join(extra, '.pipeline', 'current-task'), 'utf-8'))
        .resolves.toBe(await fsPromises.readFile(join(base, '.pipeline', 'current-task'), 'utf-8'));
    } finally {
      await Promise.all([
        fsPromises.rm(base, { recursive: true, force: true }),
        fsPromises.rm(extra, { recursive: true, force: true }),
      ]);
    }
  });

  it.each([
    ['plain done', ['node', 'conduct', 'task', 'done', '7']],
    ['done with evidence', ['node', 'conduct', 'task', 'done', '7', '--done-when', '1=ok']],
  ])('preserves the recorded no-child fixture for %s', async (_name, argv) => {
    const dir = await fsPromises.mkdtemp(join(tmpdir(), 'task-cli-done-parity-'));
    const statusPath = join(dir, '.pipeline', 'task-status.json');
    const stampPath = join(dir, '.pipeline', 'current-task');
    try {
      await seedStartedTask(dir);
      const originalStatus = await fsPromises.readFile(statusPath, 'utf-8');
      await fsPromises.writeFile(stampPath, '7');

      expect(await runAndCapture(dir, argv)).toEqual({ exitCode: 0, stdout: [], stderr: [] });
      await expect(fsPromises.readFile(statusPath, 'utf-8')).resolves.toBe(originalStatus);
      await expect(fsPromises.access(stampPath)).rejects.toThrow();
    } finally {
      await fsPromises.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('task command child slice membership', () => {
  const coverageBindingFilesystem = {
    readFile: (path: string) => fsPromises.readFile(path, 'utf8'),
    mkdir: (path: string) => fsPromises.mkdir(path, { recursive: true }).then(() => undefined),
    writeFile: (path: string, contents: string) => fsPromises.writeFile(path, contents, 'utf8').then(() => undefined),
    rename: fsPromises.rename,
  };

  async function seedTaskState(root: string, currentTask?: string): Promise<void> {
    const pipeline = join(root, '.pipeline');
    await fsPromises.mkdir(pipeline, { recursive: true });
    await fsPromises.writeFile(join(pipeline, 'task-status.json'), JSON.stringify({
      tasks: [
        { id: '3', status: 'pending' },
        { id: '7', status: 'pending' },
        { id: 'rem-fr10-1', status: 'pending' },
      ],
    }, null, 2));
    if (currentTask !== undefined) await fsPromises.writeFile(join(pipeline, 'current-task'), currentTask);
  }

  async function writeEnvelope(root: string, membership = true): Promise<void> {
    await writeCoverageBindingEnvelope(root, {
      version: 1,
      slug: 'feature',
      runId: 'run-1',
      status: 'done',
      entries: [],
      ...(membership ? { sliceMembership: { taskSlices: { '3': 1, '7': 2 }, titles: ['Foundation', 'Delivery'] } } : {}),
    }, coverageBindingFilesystem);
  }

  async function snapshotPipeline(root: string): Promise<Record<string, string>> {
    const pipeline = join(root, '.pipeline');
    const files: Record<string, string> = {};
    async function visit(path: string, relative = ''): Promise<void> {
      for (const entry of await fsPromises.readdir(path, { withFileTypes: true })) {
        const entryRelative = relative === '' ? entry.name : join(relative, entry.name);
        const entryPath = join(path, entry.name);
        if (entry.isDirectory()) await visit(entryPath, entryRelative);
        else files[entryRelative] = await fsPromises.readFile(entryPath, 'utf8');
      }
    }
    await visit(pipeline);
    return files;
  }

  async function dispatchWithStderr(command: NonNullable<ReturnType<typeof detectTaskCommand>>, root: string) {
    const originalError = console.error;
    const stderr: string[] = [];
    console.error = (...args: unknown[]) => { stderr.push(args.join(' ')); };
    try {
      return { exitCode: await dispatchTaskCommand(command, root), stderr: stderr.join('\n') };
    } finally {
      console.error = originalError;
    }
  }

  it.each([
    ['invalid child id', '0', '[task-cli] invalid child id "0" (expected 1-9)'],
    ['non-numeric child id', 'two', '[task-cli] invalid child id "two" (expected 1-9)'],
  ])('refuses %s before writing task state', async (_name, child, message) => {
    const root = await fsPromises.mkdtemp(join(tmpdir(), 'task-cli-child-invalid-'));
    try {
      await seedTaskState(root, '3');
      const before = await snapshotPipeline(root);
      const command = detectTaskCommand(['node', 'conduct', 'task', 'start', '7', '--child', child]);

      await expect(dispatchWithStderr(command!, root)).resolves.toEqual({ exitCode: 1, stderr: message });
      await expect(snapshotPipeline(root)).resolves.toEqual(before);
    } finally {
      await fsPromises.rm(root, { recursive: true, force: true });
    }
  });

  it('refuses a valid child that has no state before reading membership', async () => {
    const root = await fsPromises.mkdtemp(join(tmpdir(), 'task-cli-child-missing-state-'));
    try {
      await seedTaskState(root, '3');
      const before = await snapshotPipeline(root);
      const command = detectTaskCommand(['node', 'conduct', 'task', 'start', '7', '--child', '2']);

      await expect(dispatchWithStderr(command!, root)).resolves.toEqual({
        exitCode: 1,
        stderr: '[task-cli] child 2 has no child state (.pipeline/children/2/ does not exist)',
      });
      await expect(snapshotPipeline(root)).resolves.toEqual(before);
    } finally {
      await fsPromises.rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['without an envelope', false],
    ['without slice membership in the envelope', true],
  ])('refuses %s without changing task state', async (_name, writeEnvelopeWithoutMembership) => {
    const root = await fsPromises.mkdtemp(join(tmpdir(), 'task-cli-child-no-membership-'));
    try {
      await seedTaskState(root, '3');
      await fsPromises.mkdir(join(root, '.pipeline', 'children', '2'), { recursive: true });
      if (writeEnvelopeWithoutMembership) await writeEnvelope(root, false);
      const before = await snapshotPipeline(root);
      const command = detectTaskCommand(['node', 'conduct', 'task', 'start', '7', '--child', '2']);

      await expect(dispatchWithStderr(command!, root)).resolves.toEqual({
        exitCode: 1,
        stderr: '[task-cli] no slice membership is recorded for the feature (coverage-binding envelope missing)',
      });
      await expect(snapshotPipeline(root)).resolves.toEqual(before);
    } finally {
      await fsPromises.rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['task from another child', '3', '[task-cli] task 3 belongs to child 1, not child 2'],
    ['task without a recorded slice', '8', '[task-cli] task 8 has no recorded slice membership'],
  ])('refuses %s without writing task state', async (_name, id, message) => {
    const root = await fsPromises.mkdtemp(join(tmpdir(), 'task-cli-child-wrong-membership-'));
    try {
      await seedTaskState(root, '3');
      await fsPromises.mkdir(join(root, '.pipeline', 'children', '2'), { recursive: true });
      await writeEnvelope(root);
      const before = await snapshotPipeline(root);
      const command = detectTaskCommand(['node', 'conduct', 'task', 'start', id, '--child', '2']);

      await expect(dispatchWithStderr(command!, root)).resolves.toEqual({ exitCode: 1, stderr: message });
      await expect(snapshotPipeline(root)).resolves.toEqual(before);
    } finally {
      await fsPromises.rm(root, { recursive: true, force: true });
    }
  });

  it.each(['7', 'rem-fr10-1'])('starts %s through the existing flat task path after membership validation', async (id) => {
    const baseline = await fsPromises.mkdtemp(join(tmpdir(), 'task-cli-child-start-baseline-'));
    const child = await fsPromises.mkdtemp(join(tmpdir(), 'task-cli-child-start-child-'));
    try {
      for (const root of [baseline, child]) {
        await seedTaskState(root);
        await fsPromises.mkdir(join(root, '.pipeline', 'children', '2'), { recursive: true });
        await writeEnvelope(root);
      }

      const baselineCommand = detectTaskCommand(['node', 'conduct', 'task', 'start', id]);
      const childCommand = detectTaskCommand(['node', 'conduct', 'task', 'start', id, '--child', '2']);
      await expect(dispatchTaskCommand(baselineCommand!, baseline)).resolves.toBe(0);
      await expect(dispatchTaskCommand(childCommand!, child)).resolves.toBe(0);

      await expect(snapshotPipeline(child)).resolves.toEqual(await snapshotPipeline(baseline));
      await expect(fsPromises.readFile(join(child, '.pipeline', 'current-task'), 'utf8')).resolves.toBe(id);
      await expect(fsPromises.access(join(child, '.pipeline', 'children', '2', 'current-task'))).rejects.toThrow();
    } finally {
      await Promise.all([
        fsPromises.rm(baseline, { recursive: true, force: true }),
        fsPromises.rm(child, { recursive: true, force: true }),
      ]);
    }
  });

  it('completes an ordinary task through the existing path after membership validation', async () => {
    const baseline = await fsPromises.mkdtemp(join(tmpdir(), 'task-cli-child-done-baseline-'));
    const child = await fsPromises.mkdtemp(join(tmpdir(), 'task-cli-child-done-child-'));
    try {
      for (const root of [baseline, child]) {
        await seedTaskState(root, '7');
        await fsPromises.mkdir(join(root, '.pipeline', 'children', '2'), { recursive: true });
        await writeEnvelope(root);
      }

      const baselineCommand = detectTaskCommand(['node', 'conduct', 'task', 'done', '7', '--done-when', '1=ok']);
      const childCommand = detectTaskCommand([
        'node', 'conduct', 'task', 'done', '7', '--child', '2', '--done-when', '1=ok',
      ]);
      await expect(dispatchTaskCommand(baselineCommand!, baseline)).resolves.toBe(0);
      await expect(dispatchTaskCommand(childCommand!, child)).resolves.toBe(0);

      await expect(snapshotPipeline(child)).resolves.toEqual(await snapshotPipeline(baseline));
      await expect(fsPromises.access(join(child, '.pipeline', 'current-task'))).rejects.toThrow();
      await expect(fsPromises.access(join(child, '.pipeline', 'children', '2', 'current-task'))).rejects.toThrow();
    } finally {
      await Promise.all([
        fsPromises.rm(baseline, { recursive: true, force: true }),
        fsPromises.rm(child, { recursive: true, force: true }),
      ]);
    }
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

  describe('concurrent writes — atomicity under concurrent writers', () => {
    it('handles N concurrent runTaskStart calls with distinct ids', async () => {
      // Setup: seed task-status.json with 10 pending tasks
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      const tasks = Array.from({ length: 10 }, (_, i) => ({
        id: String(i + 1),
        name: `Task ${i + 1}`,
        status: 'pending',
      }));
      await fsPromises.writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks }, null, 2),
      );

      // Fire 5 concurrent runTaskStart calls with distinct ids (1, 2, 3, 4, 5)
      const results = await Promise.all([
        runTaskStart(dir, '1'),
        runTaskStart(dir, '2'),
        runTaskStart(dir, '3'),
        runTaskStart(dir, '4'),
        runTaskStart(dir, '5'),
      ]);

      // All should succeed
      expect(results).toEqual([0, 0, 0, 0, 0]);

      // Verify task-status.json parses as valid JSON
      const statusPath = join(dir, '.pipeline/task-status.json');
      const content = await fsPromises.readFile(statusPath, 'utf-8');
      let status: any;
      expect(() => {
        status = JSON.parse(content);
      }).not.toThrow();

      // Verify structure is intact and no partial/torn writes
      expect(status.tasks).toBeDefined();
      expect(Array.isArray(status.tasks)).toBe(true);
      expect(status.tasks.length).toBe(10);

      // The final state should represent one or more of the concurrent writes
      // (exact outcome depends on timing/interleaving).
      // Key invariant: no torn JSON, and all tasks have valid status fields
      const inProgressCount = status.tasks.filter((t: any) => t.status === 'in_progress').length;
      expect(inProgressCount).toBeGreaterThan(0);

      // All tasks must have a valid status (not corrupted)
      for (const task of status.tasks) {
        expect(['pending', 'in_progress']).toContain(task.status);
      }
    });

    it('never produces torn or corrupted JSON during concurrent writes', async () => {
      // Setup: seed task-status.json with 5 tasks
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

      // Fire 3 concurrent writes
      await Promise.all([
        runTaskStart(dir, '1'),
        runTaskStart(dir, '2'),
        runTaskStart(dir, '3'),
      ]);

      // Even with concurrent writes, the JSON should be valid and parseable
      const statusPath = join(dir, '.pipeline/task-status.json');
      const content = await fsPromises.readFile(statusPath, 'utf-8');

      // This must not throw — JSON must be valid
      const status = JSON.parse(content);

      // Verify structure is sound (not torn/corrupted)
      expect(status).toBeDefined();
      expect(status.tasks).toBeDefined();
      expect(Array.isArray(status.tasks)).toBe(true);

      // All tasks in the array should have id, name, and status fields
      for (const task of status.tasks) {
        expect(task).toHaveProperty('id');
        expect(task).toHaveProperty('name');
        expect(task).toHaveProperty('status');
      }
    });
  });
});

describe('runTaskDone', () => {
  let dir: string;
  let stdErr: string[];

  beforeEach(async () => {
    dir = await fsPromises.mkdtemp(join(tmpdir(), 'task-cli-done-test-'));
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

  it('closes a plan_amendment repair with current Done when evidence', async () => {
    await fsPromises.mkdir(join(dir, '.docs', 'plans'), { recursive: true });
    await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
    await fsPromises.writeFile(join(dir, '.docs', 'plans', 'feature.md'), [
      '### Task 7: Repair current evidence',
      '**Done when:**',
      '- Current evidence is recorded.',
      '',
    ].join('\n'));
    await fsPromises.writeFile(join(dir, '.pipeline', 'engine-state.json'), JSON.stringify({
      activePlanPath: '.docs/plans/feature.md',
    }));
    await fsPromises.writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({
      tasks: [{ id: '7', status: 'in_progress' }],
    }));
    const repairs = createRepairObligationStore(dir, join(dir, '.pipeline', 'engine-state.json'));
    const admitted = await repairs.admitOrReplay('plan-amendment-done-when', {
      id: 'plan-amendment-done-when', planPath: '.docs/plans/feature.md', taskIds: ['7'],
      source: { findingId: 'changed-task-digest', authority: 'plan_amendment', instruction: 'repair' },
      baseline: { head: 'unavailable', tree: 'tree', resolvedTaskIds: [] },
    });
    if (!admitted.ok) throw new Error(admitted.message);

    await expect(runTaskDone(dir, '7', [{ index: 1, evidence: 'current proof' }])).resolves.toBe(0);
    expect(await resolveTaskIds(dir, ['7'])).toEqual(new Set(['7']));

    const state = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline', 'engine-state.json'), 'utf-8'));
    expect(state.repairObligations.records['plan-amendment-done-when'].tasks['7']).toMatchObject({
      status: 'resolved',
      evidence: { kind: 'current-done-when' },
    });
  });

  it('keeps a legacy plan_amendment close unresolved until a post-boundary Task trailer', async () => {
    await execa('git', ['init', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });
    await fsPromises.mkdir(join(dir, '.docs', 'plans'), { recursive: true });
    await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
    await fsPromises.writeFile(join(dir, '.docs', 'plans', 'feature.md'), '### Task 7: Legacy repair\n');
    await fsPromises.writeFile(join(dir, '.pipeline', 'engine-state.json'), JSON.stringify({
      activePlanPath: '.docs/plans/feature.md',
    }));
    const originalStatus = JSON.stringify({ tasks: [{ id: '7', status: 'completed' }] }, null, 2);
    await fsPromises.writeFile(join(dir, '.pipeline', 'task-status.json'), originalStatus);
    await fsPromises.writeFile(join(dir, 'original.txt'), 'original\n');
    await execa('git', ['add', '.'], { cwd: dir });
    await execa('git', ['commit', '-m', 'original implementation\n\nTask: 7'], { cwd: dir });
    const boundary = (await execa('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim();

    const repairs = createRepairObligationStore(dir, join(dir, '.pipeline', 'engine-state.json'));
    const admitted = await repairs.admitOrReplay('plan-amendment-legacy', {
      id: 'plan-amendment-legacy', planPath: '.docs/plans/feature.md', taskIds: ['7'],
      source: { findingId: 'changed-task-digest', authority: 'plan_amendment', instruction: 'repair' },
      baseline: { head: boundary, tree: 'tree', resolvedTaskIds: ['7'] },
    });
    if (!admitted.ok) throw new Error(admitted.message);

    // No Done when block makes this a legacy close: it cannot close the repair or revive old evidence.
    await expect(runTaskDone(dir, '7')).resolves.toBe(0);
    await expect(fsPromises.readFile(join(dir, '.pipeline', 'task-status.json'), 'utf-8')).resolves.toBe(originalStatus);
    expect(await resolveTaskIds(dir, ['7'])).toEqual(new Set());

    await fsPromises.writeFile(join(dir, 'repair.txt'), 'repair\n');
    await execa('git', ['add', 'repair.txt'], { cwd: dir });
    await execa('git', ['commit', '-m', 'repair legacy task\n\nTask: 7'], { cwd: dir });

    expect(await resolveTaskIds(dir, ['7'])).toEqual(new Set(['7']));
  });

  it('closes the current repair only after current Done when evidence is accepted', async () => {
    await fsPromises.mkdir(join(dir, '.docs', 'plans'), { recursive: true });
    await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
    await fsPromises.writeFile(join(dir, '.docs', 'plans', 'feature.md'), [
      '### Task 7: Repair current evidence',
      '**Done when:**',
      '- Current evidence is recorded.',
      '',
    ].join('\n'));
    await fsPromises.writeFile(join(dir, '.pipeline', 'engine-state.json'), JSON.stringify({
      activePlanPath: '.docs/plans/feature.md',
    }));
    await fsPromises.writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({
      tasks: [{ id: '7', status: 'in_progress' }],
    }));
    await fsPromises.writeFile(join(dir, '.pipeline', 'current-task'), '7');
    const repairs = createRepairObligationStore(dir, join(dir, '.pipeline', 'engine-state.json'));
    const admitted = await repairs.admitOrReplay('key-1', {
      id: 'round-7', planPath: '.docs/plans/feature.md', taskIds: ['T7'],
      source: { findingId: 'finding', authority: 'build_review', instruction: 'repair' },
      baseline: { head: 'unavailable', tree: 'tree', resolvedTaskIds: [] },
    });
    if (!admitted.ok) throw new Error(admitted.message);

    await expect(runTaskDone(dir, '7', [{ index: 1, evidence: 'fresh proof' }])).resolves.toBe(0);
    expect(await resolveTaskIds(dir, ['7'])).toEqual(new Set(['7']));
  });

  it('closes only the live current repair and leaves its superseded predecessor unchanged', async () => {
    await fsPromises.mkdir(join(dir, '.docs', 'plans'), { recursive: true });
    await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
    await fsPromises.writeFile(join(dir, '.docs', 'plans', 'feature.md'), [
      '### Task 2: Repair current evidence',
      '**Done when:**',
      '- Current evidence is recorded.',
      '',
    ].join('\n'));
    await fsPromises.writeFile(join(dir, '.pipeline', 'engine-state.json'), JSON.stringify({
      activePlanPath: '.docs/plans/feature.md',
    }));
    await fsPromises.writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({
      tasks: [{ id: '2', status: 'in_progress' }],
    }));
    await fsPromises.writeFile(join(dir, '.pipeline', 'current-task'), '2');
    const repairs = createRepairObligationStore(dir, join(dir, '.pipeline', 'engine-state.json'));
    const older = await repairs.admitOrReplay('older-key', {
      id: 'older', planPath: '.docs/plans/feature.md', taskIds: ['2'],
      source: { findingId: 'older', authority: 'build_review', instruction: 'repair' },
      baseline: { head: 'older-boundary', tree: 'older-tree', resolvedTaskIds: [] },
    });
    const current = await repairs.admitOrReplay('current-key', {
      id: 'current', planPath: '.docs/plans/feature.md', taskIds: ['2'],
      source: { findingId: 'current', authority: 'build_review', instruction: 'repair' },
      baseline: { head: 'current-boundary', tree: 'current-tree', resolvedTaskIds: [] },
    });
    if (!older.ok || !current.ok) throw new Error('repair admission failed');
    const before = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline', 'engine-state.json'), 'utf-8'));
    const supersededRecord = JSON.stringify(before.repairObligations.records[older.obligation.id]);

    await expect(runTaskDone(dir, '2', [{ index: 1, evidence: 'fresh proof' }])).resolves.toBe(0);

    const after = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline', 'engine-state.json'), 'utf-8'));
    expect(after.repairObligations.records[current.obligation.id].tasks['2']).toMatchObject({
      status: 'resolved', evidence: { kind: 'current-done-when' },
    });
    expect(JSON.stringify(after.repairObligations.records[older.obligation.id])).toBe(supersededRecord);
    const status = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline', 'task-status.json'), 'utf-8'));
    expect(status.tasks[0].status).toBe('completed');
  });

  it('closes each open live repair across authorities', async () => {
    await fsPromises.mkdir(join(dir, '.docs', 'plans'), { recursive: true });
    await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
    await fsPromises.writeFile(join(dir, '.docs', 'plans', 'feature.md'), [
      '### Task 2: Repair current evidence',
      '**Done when:**',
      '- Current evidence is recorded.',
      '',
    ].join('\n'));
    await fsPromises.writeFile(join(dir, '.pipeline', 'engine-state.json'), JSON.stringify({ activePlanPath: '.docs/plans/feature.md' }));
    await fsPromises.writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: [{ id: '2', status: 'in_progress' }] }));
    const repairs = createRepairObligationStore(dir, join(dir, '.pipeline', 'engine-state.json'));
    const audit = await repairs.admitOrReplay('audit-key', {
      id: 'audit', planPath: '.docs/plans/feature.md', taskIds: ['2'],
      source: { findingId: 'audit', authority: 'prd_audit', instruction: 'repair' },
      baseline: { head: 'audit-boundary', tree: 'audit-tree', resolvedTaskIds: [] },
    });
    const current = await repairs.admitOrReplay('current-key', {
      id: 'current', planPath: '.docs/plans/feature.md', taskIds: ['2'],
      source: { findingId: 'current', authority: 'build_review', instruction: 'repair' },
      baseline: { head: 'current-boundary', tree: 'current-tree', resolvedTaskIds: [] },
    });
    if (!audit.ok || !current.ok) throw new Error('repair admission failed');

    await expect(runTaskDone(dir, '2', [{ index: 1, evidence: 'fresh proof' }])).resolves.toBe(0);

    const state = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline', 'engine-state.json'), 'utf-8'));
    expect(state.repairObligations.records[audit.obligation.id].tasks['2'].status).toBe('resolved');
    expect(state.repairObligations.records[current.obligation.id].tasks['2'].status).toBe('resolved');
  });

  it.each(['with the current-task stamp', 'without the current-task stamp'])('refuses a current-less repair %s without changing repair or task status', async (stampCase) => {
    await fsPromises.mkdir(join(dir, '.docs', 'plans'), { recursive: true });
    await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
    await fsPromises.writeFile(join(dir, '.docs', 'plans', 'feature.md'), [
      '### Task 2: Repair current evidence',
      '**Done when:**',
      '- Current evidence is recorded.',
      '',
    ].join('\n'));
    await fsPromises.writeFile(join(dir, '.pipeline', 'engine-state.json'), JSON.stringify({ activePlanPath: '.docs/plans/feature.md' }));
    await fsPromises.writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: [{ id: '2', status: 'in_progress' }] }));
    if (stampCase === 'with the current-task stamp') await fsPromises.writeFile(join(dir, '.pipeline', 'current-task'), '2');
    const currentTaskBefore = stampCase === 'with the current-task stamp'
      ? await fsPromises.readFile(join(dir, '.pipeline', 'current-task'), 'utf-8')
      : undefined;
    const repairs = createRepairObligationStore(dir, join(dir, '.pipeline', 'engine-state.json'));
    const admitted = await repairs.admitOrReplay('open-key', {
      id: 'open', planPath: '.docs/plans/feature.md', taskIds: ['2'],
      source: { findingId: 'open', authority: 'build_review', instruction: 'repair' },
      baseline: { head: 'boundary', tree: 'tree', resolvedTaskIds: [] },
    });
    if (!admitted.ok) throw new Error(admitted.message);
    const state = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline', 'engine-state.json'), 'utf-8'));
    delete state.repairObligations.currentByPlan['.docs/plans/feature.md']['2'];
    const engineStateBefore = JSON.stringify(state);
    const taskStatusBefore = await fsPromises.readFile(join(dir, '.pipeline', 'task-status.json'), 'utf-8');
    await fsPromises.writeFile(join(dir, '.pipeline', 'engine-state.json'), engineStateBefore);

    await expect(runTaskDone(dir, '2', [{ index: 1, evidence: 'fresh proof' }])).resolves.toBe(1);

    expect(stdErr.join('\n')).toContain('repair state is unavailable: task 2 has an open repair obligation but no current obligation is recorded for it');
    await expect(fsPromises.readFile(join(dir, '.pipeline', 'engine-state.json'), 'utf-8')).resolves.toBe(engineStateBefore);
    await expect(fsPromises.readFile(join(dir, '.pipeline', 'task-status.json'), 'utf-8')).resolves.toBe(taskStatusBefore);
    if (currentTaskBefore !== undefined) {
      await expect(fsPromises.readFile(join(dir, '.pipeline', 'current-task'), 'utf-8')).resolves.toBe(currentTaskBefore);
    } else {
      await expect(fsPromises.readFile(join(dir, '.pipeline', 'current-task'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  describe('tagged Done when evidence from HEAD', () => {
    async function prepareTaggedTask(options: {
      testText: string;
      check?: string;
      storyText?: string;
    }): Promise<void> {
      await execa('git', ['init', '-b', 'main'], { cwd: dir });
      await execa('git', ['config', 'user.email', 'test@example.test'], { cwd: dir });
      await execa('git', ['config', 'user.name', 'Task CLI Test'], { cwd: dir });
      await fsPromises.mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await fsPromises.mkdir(join(dir, '.docs', 'stories'), { recursive: true });
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.mkdir(join(dir, 'test'), { recursive: true });
      await fsPromises.writeFile(join(dir, '.docs', 'plans', 'feature.md'), [
        '# Plan',
        '',
        '**Stories:** .docs/stories/feature.md',
        '',
        '### Task 3: Verify the close',
        '**Story:** 2',
        '**Done when:**',
        `- ${options.check ?? '[test] the committed test proves the close.'}`,
        '',
      ].join('\n'));
      await fsPromises.writeFile(join(dir, '.docs', 'stories', 'feature.md'), options.storyText ?? [
        '## Story 2: Test evidence',
        '### Happy Path',
        '- Given a task, when it closes, then it records evidence.',
        '### Negative Paths',
        '- Given invalid evidence, when it closes, then it refuses.',
        '',
      ].join('\n'));
      await fsPromises.writeFile(join(dir, '.pipeline', 'engine-state.json'), JSON.stringify({
        activePlanPath: '.docs/plans/feature.md',
      }));
      await fsPromises.writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({
        tasks: [{ id: '3', status: 'pending' }],
      }));
      await fsPromises.writeFile(join(dir, 'test', 'close.test.ts'), options.testText);
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'seed committed test'], { cwd: dir });
      await expect(runTaskStart(dir, '3')).resolves.toBe(0);
    }

    async function close(evidence: string, cwd = dir): Promise<number> {
      return dispatchTaskCommand(detectTaskCommand([
        'node', 'conduct', 'task', 'done', '3', '--done-when', `1=${evidence}`,
      ])!, cwd);
    }

    it('closes a tagged check from a committed task-marked test and records verified', async () => {
      await prepareTaggedTask({
        testText: '// Covers: task:3\nit(\'closes the tagged task\', () => {});\n',
      });

      expect(await close("test:test/close.test.ts::closes the tagged task")).toBe(0);
      const status = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline', 'task-status.json'), 'utf8'));
      expect(status.tasks[0]).toMatchObject({
        status: 'completed',
        doneWhen: [{ source: 'verified' }],
      });
    });

    // Covers: task:5
    it('closes task 5 check 2 as unverified with its per-check reason and no HALT', async () => {
      await prepareTaggedTask({
        check: '[test] first committed outcome\n- [test] second committed outcome',
        testText: '// Covers: task:3\nit(\'proves the first committed outcome\', () => {});\n',
      });

      const command = detectTaskCommand([
        'node', 'conduct', 'task', 'done', '3',
        '--done-when', '1=test:test/close.test.ts::proves the first committed outcome',
        '--unverified', '2=the integration environment is unavailable',
      ]);

      expect(command).not.toBeNull();
      expect(await dispatchTaskCommand(command!, dir)).toBe(0);
      const status = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline', 'task-status.json'), 'utf8'));
      expect(status.tasks[0]).toMatchObject({
        status: 'completed',
        doneWhen: [
          { source: 'verified' },
          {
            source: 'unverified',
            reason: 'the integration environment is unavailable',
          },
        ],
      });
      await expect(fsPromises.access(join(dir, '.pipeline', 'HALT'))).rejects.toThrow();
    });

    // Covers: task:5
    it('refuses an empty unverified reason for task 5 check 2', async () => {
      await prepareTaggedTask({
        check: '[test] first committed outcome\n- [test] second committed outcome',
        testText: '// Covers: task:3\nit(\'proves the first committed outcome\', () => {});\n',
      });

      const command = detectTaskCommand([
        'node', 'conduct', 'task', 'done', '3',
        '--done-when', '1=test:test/close.test.ts::proves the first committed outcome',
        '--unverified', '2=',
      ]);

      expect(command).not.toBeNull();
      expect(await dispatchTaskCommand(command!, dir)).toBe(1);
      expect(stdErr.join('\n')).toContain('check 2');
      expect(stdErr.join('\n')).toContain('non-empty reason');
      const status = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline', 'task-status.json'), 'utf8'));
      expect(status.tasks[0].status).toBe('in_progress');
    });

    it('refuses --unverified for an untagged check', async () => {
      await prepareTaggedTask({
        check: 'an untagged observable outcome',
        testText: '// Covers: task:3\nit(\'does not matter\', () => {});\n',
      });

      const command = detectTaskCommand([
        'node', 'conduct', 'task', 'done', '3',
        '--unverified', '1=not a test check',
      ]);

      expect(command).not.toBeNull();
      expect(await dispatchTaskCommand(command!, dir)).toBe(1);
      expect(stdErr.join('\n')).toContain('not a tagged Done when check');
    });

    it('closes from a criterion marker and a test committed before the feature branch', async () => {
      await prepareTaggedTask({
        testText: '// Covers: S2.1\nit(\'proves the criterion\', () => {});\n',
      });
      await execa('git', ['branch', 'feature'], { cwd: dir });
      await execa('git', ['checkout', 'feature'], { cwd: dir });

      expect(await close('test:test/close.test.ts::proves the criterion')).toBe(0);
      const status = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline', 'task-status.json'), 'utf8'));
      expect(status.tasks[0].doneWhen).toEqual(expect.arrayContaining([
        expect.objectContaining({ source: 'verified' }),
      ]));
    });

    it('resolves the repository root when the CLI runs from a worktree subdirectory', async () => {
      await prepareTaggedTask({
        testText: '// Covers: task:3\nit(\'proves from a subdirectory\', () => {});\n',
      });
      await fsPromises.mkdir(join(dir, 'nested', 'work'), { recursive: true });

      expect(await close('test:test/close.test.ts::proves from a subdirectory', join(dir, 'nested', 'work'))).toBe(0);
      const status = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline', 'task-status.json'), 'utf8'));
      expect(status.tasks[0].doneWhen[0]).toMatchObject({ source: 'verified' });
    });

    // Covers: task:5
    it.each([
      ['free text', 'a generic success sentence', 'not-a-test-reference'],
      ['absent path', 'test:test/missing.test.ts::missing test', 'test/missing.test.ts'],
      ['missing title', 'test:test/close.test.ts::a title not in the blob', 'a title not in the blob'],
      ['missing marker', 'test:test/close.test.ts::closes without a marker', 'Covers:'],
    ])('refuses %s and names the check and failed part', async (_name, evidence, expected) => {
      await prepareTaggedTask({
        testText: '// no marker\nit(\'closes without a marker\', () => {});\n',
      });

      expect(await close(evidence)).toBe(1);
      expect(stdErr.join('\n')).toContain('check 1');
      expect(stdErr.join('\n')).toContain('[test] the committed test proves the close.');
      expect(stdErr.join('\n')).toContain(expected);
      expect(stdErr.join('\n')).toContain('write or cite the test, or use --unverified 1=<reason>.');
      expect(stdErr.join('\n')).not.toContain('--plan-gap');
      const status = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline', 'task-status.json'), 'utf8'));
      expect(status.tasks[0].status).toBe('in_progress');
    });

    it('refuses a test file that is present only in the working tree', async () => {
      await prepareTaggedTask({ testText: '// Covers: task:3\n' });
      await fsPromises.writeFile(join(dir, 'test', 'uncommitted.test.ts'),
        '// Covers: task:3\nit(\'uncommitted proof\', () => {});\n');

      expect(await close('test:test/uncommitted.test.ts::uncommitted proof')).toBe(1);
      expect(stdErr.join('\n')).toContain('check 1');
      expect(stdErr.join('\n')).toContain('test/uncommitted.test.ts');
      expect(stdErr.join('\n')).toContain('absent at HEAD');
      const status = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline', 'task-status.json'), 'utf8'));
      expect(status.tasks[0].status).toBe('in_progress');
    });

    // Covers: task:5
    it('lists --unverified <n>=<reason> in task command usage', async () => {
      expect(await dispatchTaskCommand({ kind: 'guide' }, dir)).toBe(2);
      expect(stdErr.join('\n')).toContain('--unverified <n>=<reason>');
    });
  });

  describe('happy path — done 7 after start 7', () => {
    it('removes current-task stamp and exits 0', async () => {
      // Setup: seed task-status.json and stamp
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

      // Start task 7 first
      await runTaskStart(dir, '7');

      // Verify stamp exists
      const stampPath = join(dir, '.pipeline/current-task');
      let stampContent = await fsPromises.readFile(stampPath, 'utf-8');
      expect(stampContent).toBe('7');

      // Call runTaskDone for task 7
      const exitCode = await runTaskDone(dir, '7');
      expect(exitCode).toBe(0);

      // Verify stamp file is removed
      let stampExists = false;
      try {
        await fsPromises.readFile(stampPath, 'utf-8');
        stampExists = true;
      } catch {
        stampExists = false;
      }
      expect(stampExists).toBe(false);
    });

    it('does not modify task-status.json row status (stays in_progress)', async () => {
      // Setup: seed task-status.json and stamp
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

      // Start task 7
      await runTaskStart(dir, '7');

      const statusPath = join(dir, '.pipeline/task-status.json');
      const before = await fsPromises.readFile(statusPath, 'utf-8');

      // Call runTaskDone
      const code = await runTaskDone(dir, '7');

      // Verify row 7 is still in_progress (never becomes completed)
      const content = await fsPromises.readFile(statusPath, 'utf-8');
      const stampRemoved = await fsPromises
        .access(join(dir, '.pipeline/current-task'))
        .then(() => false, () => true);
      expect({ code, content, stampRemoved }).toEqual({ code: 0, content: before, stampRemoved: true });
      const status = JSON.parse(content);

      const task7 = status.tasks.find((t: any) => t.id === '7');
      expect(task7.status).toBe('in_progress');
    });
  });

  describe('stampless completion', () => {
    it('completes an in-progress row and records one evidence item for every Done when check', async () => {
      await fsPromises.mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(join(dir, '.docs', 'plans', 'my-feature.md'), [
        '### Task 7: Repair the sweep',
        '**Done when:**',
        '- the sweep observes reservation before dispatch',
        '- the sweep keeps the reservation until completion',
        '',
      ].join('\n'));
      await fsPromises.writeFile(
        join(dir, '.pipeline', 'conduct-state.json'),
        JSON.stringify({ feature_desc: 'my-feature' }),
      );
      await fsPromises.writeFile(join(dir, '.pipeline', 'engine-state.json'), JSON.stringify({}));
      await fsPromises.writeFile(
        join(dir, '.pipeline', 'task-status.json'),
        JSON.stringify({ tasks: [{ id: '7', status: 'in_progress' }] }),
      );

      const exitCode = await runTaskDone(dir, '7', [
        { index: 1, evidence: 'sweep test observed reservation' },
        { index: 2, evidence: 'completion test retained reservation' },
      ]);

      expect(exitCode).toBe(0);
      const status = JSON.parse(
        await fsPromises.readFile(join(dir, '.pipeline', 'task-status.json'), 'utf-8'),
      ) as { tasks: Array<{ status: string; doneWhen?: Array<{ check: string; evidence: string; source: string }> }> };
      expect(status.tasks[0].status).toBe('completed');
      expect(status.tasks[0].doneWhen).toHaveLength(2);
      expect(status.tasks[0].doneWhen).toEqual([
        { check: 'the sweep observes reservation before dispatch', evidence: 'sweep test observed reservation', source: 'reported' },
        { check: 'the sweep keeps the reservation until completion', evidence: 'completion test retained reservation', source: 'reported' },
      ]);
    });

    it('refuses missing evidence, names its check, and leaves status byte-identical', async () => {
      await fsPromises.mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(join(dir, '.docs', 'plans', 'my-feature.md'), [
        '### Task 7: Repair the sweep',
        '**Done when:**',
        '- the sweep observes reservation before dispatch',
        '- the sweep keeps the reservation until completion',
        '',
      ].join('\n'));
      await fsPromises.writeFile(
        join(dir, '.pipeline', 'conduct-state.json'),
        JSON.stringify({ feature_desc: 'my-feature' }),
      );
      await fsPromises.writeFile(join(dir, '.pipeline', 'engine-state.json'), JSON.stringify({}));
      const statusPath = join(dir, '.pipeline', 'task-status.json');
      const originalStatus = JSON.stringify({ tasks: [{ id: '7', status: 'in_progress' }] }, null, 2);
      await fsPromises.writeFile(
        statusPath,
        originalStatus,
      );
      const statusBefore = await fsPromises.readFile(statusPath, 'utf-8');

      const exitCode = await runTaskDone(dir, '7', [{ index: 1, evidence: 'sweep test observed reservation' }]);

      expect(exitCode).toBe(1);
      expect(stdErr.join('\n')).toContain('missing Done when evidence for check 2');
      await expect(fsPromises.readFile(statusPath, 'utf-8')).resolves.toBe(statusBefore);
    });

    it('halts a plan gap without completing the row', async () => {
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(join(dir, 'plan.md'), [
        '### Task 7: Repair the sweep',
        '**Done when:**',
        '- the sweep observes reservation before dispatch',
        '',
      ].join('\n'));
      await fsPromises.writeFile(join(dir, '.pipeline', 'engine-state.json'), JSON.stringify({
        activePlanPath: 'plan.md',
      }));
      await fsPromises.writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({
        tasks: [{ id: '7', status: 'in_progress' }],
      }));

      expect(await runTaskDone(
        dir,
        '7',
        [],
        { index: 1, reason: 'The approved plan cannot satisfy this check.' },
      )).toBe(1);

      await expect(fsPromises.readFile(join(dir, '.pipeline', 'HALT.class'), 'utf-8')).resolves.toBe('plan-gap');
      const status = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline', 'task-status.json'), 'utf-8'));
      expect(status.tasks[0].status).not.toBe('completed');
    });

    it('halts a daemon-dispatched plan gap without completing the row', async () => {
      await fsPromises.mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(join(dir, '.docs', 'plans', 'my-feature.md'), [
        '### Task 7: Repair the sweep',
        '**Done when:**',
        '- the sweep observes reservation before dispatch',
        '',
      ].join('\n'));
      await fsPromises.writeFile(
        join(dir, '.pipeline', 'conduct-state.json'),
        JSON.stringify({ feature_desc: 'my-feature' }),
      );
      await fsPromises.writeFile(join(dir, '.pipeline', 'engine-state.json'), JSON.stringify({}));
      await fsPromises.writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({
        tasks: [{ id: '7', status: 'in_progress' }],
      }));

      expect(await runTaskDone(
        dir,
        '7',
        [],
        { index: 1, reason: 'The approved plan cannot satisfy this check.' },
      )).toBe(1);

      await expect(fsPromises.readFile(join(dir, '.pipeline', 'HALT.class'), 'utf-8')).resolves.toBe('plan-gap');
      const status = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline', 'task-status.json'), 'utf-8'));
      expect(status.tasks[0].status).not.toBe('completed');
    });

    it('refuses a plan gap for a tagged check without writing a HALT or completing the row', async () => {
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(join(dir, 'plan.md'), [
        '### Task 7: Repair the sweep',
        '**Done when:**',
        '- [test] the focused test proves the repair',
        '',
      ].join('\n'));
      await fsPromises.writeFile(join(dir, '.pipeline', 'engine-state.json'), JSON.stringify({
        activePlanPath: 'plan.md',
      }));
      await fsPromises.writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({
        tasks: [{ id: '7', status: 'in_progress' }],
      }));

      expect(await runTaskDone(
        dir,
        '7',
        [],
        { index: 1, reason: 'The approved plan cannot satisfy this check.' },
      )).toBe(1);

      expect(stdErr.join('\n')).toContain('check 1');
      expect(stdErr.join('\n')).toContain('write or cite the test, or use --unverified 1=<reason>.');
      await expect(fsPromises.access(join(dir, '.pipeline', 'HALT'))).rejects.toThrow();
      const status = JSON.parse(await fsPromises.readFile(join(dir, '.pipeline', 'task-status.json'), 'utf-8'));
      expect(status.tasks[0].status).toBe('in_progress');
    });

    it('leaves a row byte-identical when its plan task has no Done when checks', async () => {
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(join(dir, 'plan.md'), '### Task 7: Legacy task\n');
      await fsPromises.writeFile(join(dir, '.pipeline', 'engine-state.json'), JSON.stringify({
        activePlanPath: 'plan.md',
      }));
      const originalStatus = JSON.stringify({ tasks: [{ id: '7', status: 'in_progress' }] }, null, 2);
      await fsPromises.writeFile(join(dir, '.pipeline', 'task-status.json'), originalStatus);

      expect(await runTaskDone(dir, '7')).toBe(0);
      await expect(fsPromises.readFile(join(dir, '.pipeline', 'task-status.json'), 'utf-8')).resolves.toBe(originalStatus);
    });

    it.each(['completed', 'skipped'])('re-closes a %s row without evidence or rewriting status', async (status) => {
      await fsPromises.mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(join(dir, '.docs', 'plans', 'feature.md'), [
        '### Task 7: Repair the sweep',
        '**Done when:**',
        '- the sweep observes reservation before dispatch',
        '',
      ].join('\n'));
      await fsPromises.writeFile(join(dir, '.pipeline', 'engine-state.json'), JSON.stringify({
        activePlanPath: '.docs/plans/feature.md',
      }));
      const originalStatus = JSON.stringify({ tasks: [{ id: '7', status }] }, null, 2);
      await fsPromises.writeFile(join(dir, '.pipeline', 'task-status.json'), originalStatus);

      expect(await runTaskDone(dir, '7')).toBe(0);
      await expect(fsPromises.readFile(join(dir, '.pipeline', 'task-status.json'), 'utf-8')).resolves.toBe(originalStatus);
    });
  });

  describe('mismatch guard — done 7 while stamp is 8', () => {
    it('exits non-zero when stamp has different id', async () => {
      // Setup: seed task-status.json and stamp with id 8
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

      // Start task 8
      await runTaskStart(dir, '8');

      // Try to done task 7 (mismatch)
      const exitCode = await runTaskDone(dir, '7');
      expect(exitCode).not.toBe(0);
    });

    it('leaves stamp file untouched on mismatch', async () => {
      // Setup: seed task-status.json and stamp with id 8
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

      // Start task 8
      await runTaskStart(dir, '8');

      const stampPath = join(dir, '.pipeline/current-task');
      const originalStamp = await fsPromises.readFile(stampPath, 'utf-8');

      // Try to done task 7 (mismatch)
      await runTaskDone(dir, '7');

      // Verify stamp is still 8
      const currentStamp = await fsPromises.readFile(stampPath, 'utf-8');
      expect(currentStamp).toBe(originalStamp);
      expect(currentStamp).toBe('8');
    });

    it('error message names both ids (requested and current)', async () => {
      // Setup: seed task-status.json and stamp with id 8
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

      // Start task 8
      await runTaskStart(dir, '8');

      // Clear stderr capture
      stdErr = [];

      // Try to done task 7 (mismatch)
      await runTaskDone(dir, '7');

      // Verify error names both ids
      const errorOutput = stdErr.join('\n');
      expect(errorOutput).toContain('7');
      expect(errorOutput).toContain('8');
    });
  });

  describe('idempotent — done 7 with no stamp file', () => {
    it('exits 0 when stamp file does not exist', async () => {
      // Setup: only pipeline dir exists, no stamp
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });

      // Call runTaskDone for task 7 (no stamp)
      const exitCode = await runTaskDone(dir, '7');
      expect(exitCode).toBe(0);
    });

    it('still validates an explicitly reopened task whose stamp is missing', async () => {
      // S2.3 negative: an open repair obligation must not be silently skipped
      // by the missing-stamp idempotence path.
      await fsPromises.mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(join(dir, '.docs', 'plans', 'feature.md'), [
        '### Task 7: Repair current evidence',
        '**Done when:**',
        '- Current evidence is recorded.',
        '',
      ].join('\n'));
      await fsPromises.writeFile(join(dir, '.pipeline', 'engine-state.json'), JSON.stringify({
        activePlanPath: '.docs/plans/feature.md',
      }));
      await fsPromises.writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({
        tasks: [{ id: '7', status: 'pending' }],
      }));
      const repairs = createRepairObligationStore(dir, join(dir, '.pipeline', 'engine-state.json'));
      const admitted = await repairs.admitOrReplay('key-2', {
        id: 'round-7', planPath: '.docs/plans/feature.md', taskIds: ['7'],
        source: { findingId: 'finding', authority: 'build_review', instruction: 'repair' },
        baseline: { head: 'unavailable', tree: 'tree', resolvedTaskIds: [] },
      });
      if (!admitted.ok) throw new Error(admitted.message);

      await expect(runTaskDone(dir, '7')).resolves.toBe(1);
      expect(await resolveTaskIds(dir, ['7'])).toEqual(new Set());
      await expect(runTaskDone(dir, '7', [{ index: 1, evidence: 'fresh proof' }])).resolves.toBe(0);
      expect(await resolveTaskIds(dir, ['7'])).toEqual(new Set(['7']));
    });
  });

  describe('CLI entry — stampless done', () => {
    it('parses and dispatches Done when evidence to complete a stampless task', async () => {
      await fsPromises.mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(join(dir, '.docs', 'plans', 'feature.md'), [
        '### Task 7: Record completion through the CLI',
        '**Done when:**',
        '- CLI evidence is recorded.',
        '',
      ].join('\n'));
      await fsPromises.writeFile(join(dir, '.pipeline', 'engine-state.json'), JSON.stringify({
        activePlanPath: '.docs/plans/feature.md',
      }));
      await fsPromises.writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({
        tasks: [{ id: '7', status: 'in_progress' }],
      }));

      const command = detectTaskCommand([
        'node', 'conduct', 'task', 'done', '7', '--done-when', '1=CLI proof',
      ]);

      expect(command).toEqual({
        kind: 'done',
        id: '7',
        doneWhen: [{ index: 1, evidence: 'CLI proof' }],
      });
      expect(await dispatchTaskCommand(command!, dir)).toBe(0);

      const status = JSON.parse(
        await fsPromises.readFile(join(dir, '.pipeline', 'task-status.json'), 'utf-8'),
      ) as { tasks: Array<Record<string, unknown>> };
      expect(status.tasks[0]).toMatchObject({
        status: 'completed',
        doneWhen: [{ check: 'CLI evidence is recorded.', evidence: 'CLI proof' }],
      });
    });

    it('parses and dispatches a stampless re-close without rewriting a completed row', async () => {
      await fsPromises.mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(join(dir, '.docs', 'plans', 'feature.md'), [
        '### Task 7: Record completion through the CLI',
        '**Done when:**',
        '- CLI evidence is recorded.',
        '',
      ].join('\n'));
      await fsPromises.writeFile(join(dir, '.pipeline', 'engine-state.json'), JSON.stringify({
        activePlanPath: '.docs/plans/feature.md',
      }));
      const originalStatus = JSON.stringify({
        tasks: [{ id: '7', status: 'completed', doneWhen: [{ check: 'CLI evidence is recorded.', evidence: 'CLI proof' }] }],
      }, null, 2);
      await fsPromises.writeFile(join(dir, '.pipeline', 'task-status.json'), originalStatus);

      const command = detectTaskCommand(['node', 'conduct', 'task', 'done', '7']);

      expect(command).toEqual({ kind: 'done', id: '7' });
      expect(await dispatchTaskCommand(command!, dir)).toBe(0);
      await expect(fsPromises.readFile(join(dir, '.pipeline', 'task-status.json'), 'utf-8'))
        .resolves.toBe(originalStatus);
    });
  });

  describe('malformed present engine state refuses the close (AB-1)', () => {
    it('exits 1, names the cause, and leaves the current-task stamp in place', async () => {
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({
        tasks: [{ id: '7', status: 'in_progress' }],
      }));
      await fsPromises.writeFile(join(dir, '.pipeline', 'current-task'), '7');
      await fsPromises.writeFile(join(dir, '.pipeline', 'engine-state.json'), '{ not json');

      await expect(runTaskDone(dir, '7')).resolves.toBe(1);
      expect(stdErr.join('\n')).toMatch(/cannot close task 7/);
      expect(stdErr.join('\n')).toMatch(/invalid JSON/);
      await expect(fsPromises.readFile(join(dir, '.pipeline', 'current-task'), 'utf-8')).resolves.toBe('7');
    });

    it('refuses a missing-stamp close on incompatible repair state instead of treating it as legacy', async () => {
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(join(dir, '.pipeline', 'engine-state.json'), JSON.stringify({
        activePlanPath: '.docs/plans/feature.md',
        repairObligations: 'corrupt',
      }));

      await expect(runTaskDone(dir, '7')).resolves.toBe(1);
      expect(stdErr.join('\n')).toMatch(/cannot close task 7/);
      expect(stdErr.join('\n')).toMatch(/incompatible/);
    });
  });

  describe('plan gap — an unsatisfiable Done when check halts without appending work', () => {
    it('writes a classified halt naming the task and check, preserves the plan, and appends no pipeline event', async () => {
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      const planPath = join(dir, 'plan.md');
      const plan = [
        '### Task 7: Deliver the bounded behavior',
        '**Done when:**',
        '- The approved behavior can be verified without widening the plan.',
        '',
      ].join('\n');
      const status = JSON.stringify({
        tasks: [{ id: '7', name: 'Task 7', status: 'in_progress' }],
      }, null, 2);
      await fsPromises.writeFile(planPath, plan, 'utf-8');
      await fsPromises.writeFile(
        join(dir, '.pipeline', 'engine-state.json'),
        JSON.stringify({ activePlanPath: 'plan.md' }),
        'utf-8',
      );
      await fsPromises.writeFile(join(dir, '.pipeline', 'task-status.json'), status, 'utf-8');
      await fsPromises.writeFile(join(dir, '.pipeline', 'current-task'), '7', 'utf-8');

      const command = detectTaskCommand([
        'node',
        'conduct',
        'task',
        'done',
        '7',
        '--plan-gap',
        '1',
        '--reason',
        'The approved plan has no authorized way to satisfy this check.',
      ]);

      expect(command).toEqual({
        kind: 'done',
        id: '7',
        planGap: {
          index: 1,
          reason: 'The approved plan has no authorized way to satisfy this check.',
        },
      });
      expect(await dispatchTaskCommand(command!, dir)).toBe(1);

      await expect(fsPromises.readFile(join(dir, '.pipeline', 'HALT.class'), 'utf-8')).resolves.toBe('plan-gap');
      await expect(fsPromises.readFile(join(dir, '.pipeline', 'HALT'), 'utf-8')).resolves.toMatch(/task 7/i);
      await expect(fsPromises.readFile(join(dir, '.pipeline', 'HALT'), 'utf-8')).resolves.toMatch(/check 1/i);
      await expect(fsPromises.readFile(join(dir, '.pipeline', 'HALT'), 'utf-8')).resolves.toMatch(
        /The approved behavior can be verified without widening the plan\./,
      );
      await expect(fsPromises.readFile(join(dir, '.pipeline', 'current-task'), 'utf-8')).resolves.toBe('7');
      await expect(fsPromises.readFile(join(dir, '.pipeline', 'task-status.json'), 'utf-8')).resolves.toBe(status);
      await expect(fsPromises.readFile(planPath, 'utf-8')).resolves.toBe(plan);

      await expect(fsPromises.access(join(dir, '.pipeline', 'pipeline-events.jsonl'))).rejects.toThrow();
    });
  });
});
