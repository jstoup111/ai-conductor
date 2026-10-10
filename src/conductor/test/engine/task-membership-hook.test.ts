import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  detectTaskMembershipCheckCommand,
  runTaskMembershipCheck,
} from '../../src/engine/task-membership-check-cli.js';
import { extractBodyTaskIds } from '../../src/engine/autoheal.js';
import { prepareWorktree } from '../../src/engine/worktree-prepare.js';

const execFileAsync = promisify(execFile);

describe('task-membership-check hook command', () => {
  let root: string;
  let messagePath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'task-membership-check-'));
    await mkdir(join(root, '.pipeline'), { recursive: true });
    messagePath = join(root, 'COMMIT_EDITMSG');
    await writeFile(messagePath, 'feat: child work\n\nTask: T1\n');
    await writeFile(
      join(root, '.pipeline', 'coverage-binding.json'),
      JSON.stringify({
        version: 1,
        slug: 'demo',
        runId: 'run',
        status: 'done',
        entries: [],
        sliceMembership: {
          taskSlices: { T1: 1, T3: 2 },
          titles: ['foundation', 'delivery'],
        },
      }),
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const run = async (branch: string | undefined, output: string[] = []) => runTaskMembershipCheck({
    projectRoot: root,
    commitMessagePath: messagePath,
    symbolicRef: async () => branch,
    print: (line) => output.push(line),
  });

  it('recognizes only the hook-only command shape', () => {
    expect(detectTaskMembershipCheckCommand(['node', 'conduct', 'task-membership-check', '/tmp/message']))
      .toEqual({ commitMessagePath: '/tmp/message' });
    expect(detectTaskMembershipCheckCommand(['node', 'conduct', 'task', 'start', '1'])).toBeNull();
  });

  it('allows a task owned by the checked-out child', async () => {
    const output: string[] = [];

    await expect(run('feat/c1/demo', output)).resolves.toBe(0);
    expect(output).toEqual([]);
  });

  it('refuses a task owned by another child and names both owners', async () => {
    await writeFile(messagePath, 'feat: wrong child\n\nTask: T3\n');
    const output: string[] = [];

    await expect(run('feat/c1/demo', output)).resolves.toBe(1);
    expect(output.join('\n')).toContain('Task T3');
    expect(output.join('\n')).toContain('child 2');
    expect(output.join('\n')).toContain('child 1');
  });

  it('validates every task trailer in message order and accepts exactly the extracted child-local set', async () => {
    const accepted = ['T1', 'T1'];
    await writeFile(messagePath, `feat: local trailers\n\n${accepted.map((id) => `Task: ${id}`).join('\n')}\n`);
    expect(extractBodyTaskIds(await (await import('node:fs/promises')).readFile(messagePath, 'utf8'))).toEqual(accepted);
    await expect(run('feat/c1/demo')).resolves.toBe(0);

    for (const trailers of [['T3', 'T1'], ['T1', 'T3', 'T1'], ['T1', 'T3']] as const) {
      await writeFile(messagePath, `feat: foreign trailer\n\n${trailers.map((id) => `Task: ${id}`).join('\n')}\n`);
      const output: string[] = [];
      await expect(run('feat/c1/demo', output)).resolves.toBe(1);
      expect(output.join('\n')).toContain('Task T3');
      expect(output.join('\n')).toContain('child 2');
    }
  });

  it('also validates a foreign current-task stamp when message trailers are local', async () => {
    await writeFile(join(root, '.pipeline', 'current-task'), 'T3\n');
    const output: string[] = [];

    await expect(run('feat/c1/demo', output)).resolves.toBe(1);
    expect(output.join('\n')).toContain('Task T3');
    expect(output.join('\n')).toContain('child 2');
  });

  it('folds recorded remediation tasks into the owning child membership', async () => {
    await writeFile(messagePath, 'fix: remediation\n\nTask: rem-build-review-1\n');
    await writeFile(
      join(root, '.pipeline', 'engine-state.json'),
      JSON.stringify({
        appendedRemediationTaskIds: ['rem-build-review-1'],
        appendedRemediationTaskChildren: { 'rem-build-review-1': 2 },
      }),
    );
    const output: string[] = [];

    await expect(run('feat/c1/demo', output)).resolves.toBe(1);
    expect(output.join('\n')).toContain('rem-build-review-1');
    expect(output.join('\n')).toContain('child 2');
    expect(output.join('\n')).toContain('child 1');
    await expect(run('feat/c2/demo')).resolves.toBe(0);
  });

  it('fails closed when the child membership envelope cannot be read', async () => {
    await rm(join(root, '.pipeline', 'coverage-binding.json'));
    const output: string[] = [];

    await expect(run('feat/c1/demo', output)).resolves.toBe(1);
    expect(output.join('\n')).toContain('unreadable membership');
    expect(output.join('\n')).toContain('coverage-binding envelope');
  });

  it('abstains on a non-child branch without requiring membership artifacts', async () => {
    await rm(join(root, '.pipeline', 'coverage-binding.json'));

    await expect(run('feat/daemon-other')).resolves.toBe(0);
    await expect(run(undefined)).resolves.toBe(0);
  });

  it('blocks explicit and auto-stamped cross-child commits through the installed hook without moving HEAD', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'task-membership-hook-repo-'));
    const git = async (...args: string[]) => {
      try {
        const result = await execFileAsync('git', ['-C', repo, ...args]);
        return { code: 0, stdout: result.stdout, stderr: result.stderr };
      } catch (error) {
        const result = error as { code?: number; stdout?: string; stderr?: string };
        return { code: result.code ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
      }
    };
    try {
      await git('init', '-b', 'main');
      await git('config', 'user.email', 'test@example.com');
      await git('config', 'user.name', 'Test');
      await writeFile(join(repo, 'README.md'), '# scratch\n');
      await git('add', 'README.md');
      await git('commit', '-m', 'initial');
      await git('checkout', '-b', 'feat/c1/demo');
      await prepareWorktree(repo);
      await mkdir(join(repo, '.pipeline'), { recursive: true });
      await writeFile(join(repo, '.pipeline', 'task-status.json'), JSON.stringify({
        tasks: [{ id: 'T1' }, { id: 'T3' }],
      }));
      await writeFile(join(repo, '.pipeline', 'coverage-binding.json'), JSON.stringify({
        version: 1,
        slug: 'demo',
        runId: 'run',
        status: 'done',
        entries: [],
        sliceMembership: { taskSlices: { T1: 1, T3: 2 }, titles: ['first', 'second'] },
      }));

      await writeFile(join(repo, 'allowed.txt'), 'allowed\n');
      await git('add', 'allowed.txt');
      expect((await git('commit', '-m', 'feat: child one\n\nTask: T1')).code).toBe(0);
      const before = (await git('rev-list', '--count', 'HEAD')).stdout.trim();
      await writeFile(join(repo, '.pipeline', 'current-task'), 'T3');
      await writeFile(join(repo, 'auto-rejected.txt'), 'auto rejected\n');
      await git('add', 'auto-rejected.txt');
      const autoRejected = await git('commit', '-m', 'feat: stale stamp');
      expect(autoRejected.code).toBe(1);
      expect(autoRejected.stderr).toContain('Task T3');
      expect((await git('rev-list', '--count', 'HEAD')).stdout.trim()).toBe(before);
      await git('reset', 'HEAD', 'auto-rejected.txt');
      await writeFile(join(repo, 'rejected.txt'), 'rejected\n');
      await git('add', 'rejected.txt');
      const rejected = await git('commit', '-m', 'feat: wrong child\n\nTask: T3');

      expect(rejected.code).toBe(1);
      expect(rejected.stderr).toContain('Task T3');
      expect(rejected.stderr).toContain('child 2');
      expect(rejected.stderr).toContain('child 1');
      expect((await git('rev-list', '--count', 'HEAD')).stdout.trim()).toBe(before);
      await expect(
        execFileAsync('git', ['-C', repo, 'commit', '-m', 'chore: engine bookkeeping\n\nTask: T3'], {
          env: { ...process.env, CONDUCT_ENGINE_COMMIT: '1' },
        }),
      ).resolves.toBeDefined();
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
