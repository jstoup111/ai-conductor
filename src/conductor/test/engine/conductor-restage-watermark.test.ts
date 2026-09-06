// Covers: task:8

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { resolveTaskIds } from '../../src/engine/task-progress.js';

const execFile = promisify(execFileCallback);

let projectRoot: string;
let planPath: string;

async function git(...args: string[]): Promise<void> {
  await execFile('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Conductor test', ...args], {
    cwd: projectRoot,
  });
}

async function commitWithTrailer(id: string): Promise<void> {
  const name = `work-${id}-${Math.random().toString(16).slice(2)}.txt`;
  await writeFile(join(projectRoot, name), `${id}\n`);
  await git('add', '--', name);
  await git('commit', '-m', `test: task ${id}`, '-m', `Task: ${id}`);
}

async function writeFixture(rows: Array<{ id: string; status: string }>): Promise<void> {
  await mkdir(join(projectRoot, '.docs', 'plans'), { recursive: true });
  await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
  planPath = join(projectRoot, '.docs', 'plans', 'restage.md');
  await writeFile(planPath, [
    '### Task 16: First task',
    '### Task 21: Second task',
    '### Task 22: No trailer task',
    '',
  ].join('\n'));
  await writeFile(join(projectRoot, '.pipeline', 'engine-state.json'), JSON.stringify({ activePlanPath: planPath }));
  await writeFile(join(projectRoot, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: rows }, null, 2) + '\n');
}

async function restage(
  ids: ReadonlySet<string>,
  dependencies?: { resolveMainRepoRoot?: () => Promise<string> },
): Promise<{ kind: string; detail?: string; watermarks?: Array<{ id: string; trailerCount: number }> }> {
  const conductor = await import('../../src/engine/conductor.js') as Record<string, unknown>;
  const seam = conductor.restageExistingRemediationTaskStatuses;
  if (typeof seam !== 'function') throw new Error('restage seam is not exported');
  return seam(projectRoot, planPath, ids, dependencies) as ReturnType<typeof restage>;
}

beforeEach(async () => {
  projectRoot = await mkdtemp(join(process.env.TMPDIR!, 'conductor-restage-watermark-'));
  await git('init', '-q', '-b', 'main');
  await writeFile(join(projectRoot, 'README.md'), 'initial\n');
  await git('add', '--', 'README.md');
  await git('commit', '-m', 'test: initial');
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe('existing-task restage watermark seam (plan Task 8)', () => {
  it('restage records watermarks and flips rows', async () => {
    await writeFixture([{ id: '16', status: 'completed' }, { id: '21', status: 'completed' }]);
    await commitWithTrailer('16');
    await commitWithTrailer('16');
    await commitWithTrailer('21');

    await expect(restage(new Set(['16', '21']))).resolves.toEqual({
      kind: 'restaged',
      watermarks: [{ id: '16', trailerCount: 2 }, { id: '21', trailerCount: 1 }],
    });
    await expect(readFile(join(projectRoot, '.daemon', 'restage-watermarks', 'restage.json'), 'utf8')).resolves.toBe(
      '{\n  "version": 1,\n  "tasks": {\n    "16": 2,\n    "21": 1\n  }\n}\n',
    );
    const status = JSON.parse(await readFile(join(projectRoot, '.pipeline', 'task-status.json'), 'utf8'));
    expect(status.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '16', status: 'pending' }),
      expect.objectContaining({ id: '21', status: 'pending' }),
    ]));
  });

  it('a repeated id in one round is recorded once', async () => {
    await writeFixture([{ id: '16', status: 'completed' }]);
    await commitWithTrailer('16');

    await expect(restage(new Set(['16', 'T16']))).resolves.toEqual({
      kind: 'restaged',
      watermarks: [{ id: '16', trailerCount: 1 }],
    });
  });

  it('unresolvable main root fails the restage before any row write', async () => {
    await writeFixture([{ id: '16', status: 'completed' }]);
    const before = await readFile(join(projectRoot, '.pipeline', 'task-status.json'), 'utf8');

    await expect(restage(new Set(['16']), {
      resolveMainRepoRoot: async () => { throw new Error('main root unavailable'); },
    })).resolves.toMatchObject({ kind: 'failed', detail: expect.stringMatching(/main root/i) });
    await expect(readFile(join(projectRoot, '.pipeline', 'task-status.json'), 'utf8')).resolves.toBe(before);
    await expect(stat(join(projectRoot, '.daemon', 'restage-watermarks'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('an absent bound id fails the restage and writes no watermark', async () => {
    await writeFixture([{ id: '16', status: 'completed' }]);

    await expect(restage(new Set(['21']))).resolves.toMatchObject({ kind: 'failed', detail: expect.stringContaining("'21'") });
    await expect(stat(join(projectRoot, '.daemon', 'restage-watermarks'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('a bound id with no trailer is recorded at count 0 and stays unresolved', async () => {
    await writeFixture([{ id: '22', status: 'completed' }]);

    await expect(restage(new Set(['22']))).resolves.toEqual({
      kind: 'restaged',
      watermarks: [{ id: '22', trailerCount: 0 }],
    });
    await expect(readFile(join(projectRoot, '.daemon', 'restage-watermarks', 'restage.json'), 'utf8')).resolves.toContain('"22": 0');
    await expect(resolveTaskIds(projectRoot, ['22'])).resolves.toEqual(new Set());
  });
});
