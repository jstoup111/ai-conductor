import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

import { readSnapshot } from '../src/engine/build-progress-watcher.js';

describe('readSnapshot', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-progress-watcher-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeStatus(content: unknown): Promise<void> {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline/task-status.json'),
      typeof content === 'string' ? content : JSON.stringify(content),
    );
  }

  it('reads the new {tasks:[]} shape, deriving resolved/total/currentTask from the array', async () => {
    await writeStatus({
      tasks: [
        { id: '1', title: 'first', status: 'completed' },
        { id: '2', title: 'second', status: 'in_progress' },
        { id: '3', title: 'third', status: 'pending' },
      ],
    });

    const snapshot = await readSnapshot(dir);

    expect(snapshot.resolved).toBe(1);
    expect(snapshot.total).toBe(3);
    expect(snapshot.currentTaskId).toBe('2');
    expect(snapshot.currentTaskName).toBe('second');
  });

  it('reads the legacy id-keyed map schema (no "tasks" wrapper)', async () => {
    await writeStatus({
      '1': { title: 'alpha', status: 'completed' },
      '2': { title: 'beta', status: 'skipped' },
      '3': { title: 'gamma', status: 'in_progress' },
      '4': { title: 'delta', status: 'pending' },
    });

    const snapshot = await readSnapshot(dir);

    expect(snapshot.resolved).toBe(2);
    expect(snapshot.total).toBe(4);
    expect(snapshot.currentTaskId).toBe('3');
    expect(snapshot.currentTaskName).toBe('gamma');
  });

  it('returns a null-ish "no data" snapshot without throwing when task-status.json is missing', async () => {
    const snapshot = await readSnapshot(dir);

    expect(snapshot.resolved).toBe(0);
    expect(snapshot.total).toBe(0);
    expect(snapshot.currentTaskId).toBeUndefined();
    expect(snapshot.currentTaskName).toBeUndefined();
  });

  it('returns a null-ish "no data" snapshot without throwing when task-status.json is corrupt', async () => {
    await writeStatus('not valid json{{{');

    const snapshot = await readSnapshot(dir);

    expect(snapshot.resolved).toBe(0);
    expect(snapshot.total).toBe(0);
    expect(snapshot.currentTaskId).toBeUndefined();
    expect(snapshot.currentTaskName).toBeUndefined();
  });

  it('omits the head property (rather than throwing) when the git HEAD probe fails', async () => {
    // dir is a plain tmpdir, not a git repo — `git rev-parse HEAD` must fail.
    await writeStatus({ tasks: [{ id: '1', status: 'pending' }] });

    const snapshot = await readSnapshot(dir);

    expect('head' in snapshot).toBe(false);
  });

  it('includes head when the project root is a real git repo with a commit', async () => {
    await execa('git', ['init'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });
    await writeFile(join(dir, 'README.md'), 'hello');
    await execa('git', ['add', '.'], { cwd: dir });
    await execa('git', ['commit', '-m', 'init'], { cwd: dir });
    await writeStatus({ tasks: [] });

    const snapshot = await readSnapshot(dir);

    expect(typeof snapshot.head).toBe('string');
    expect(snapshot.head).toMatch(/^[0-9a-f]{40}$/);
  });

  it('reads noEvidenceAttempts from task-evidence.json when present', async () => {
    await writeStatus({ tasks: [] });
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline/task-evidence.json'),
      JSON.stringify({
        evidenceStamps: {},
        noEvidenceAttempts: 3,
        migrationGrandfather: [],
      }),
    );

    const snapshot = await readSnapshot(dir);

    expect(snapshot.noEvidenceAttempts).toBe(3);
  });

  it('defaults noEvidenceAttempts to 0 when task-evidence.json is absent', async () => {
    await writeStatus({ tasks: [] });

    const snapshot = await readSnapshot(dir);

    expect(snapshot.noEvidenceAttempts).toBe(0);
  });
});
