// Covers: task:23, task:54, task:rem-prd-audit-rem-prd-audit-S7.3-r1, task:rem-as-built-rem-asbuilt-b00b54a4-3-r1
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
import { recordAppendedRemediationTaskIds } from '../../src/engine/artifacts.js';

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

  // Covers: task:39
  it('projects an owner-one routed task onto its marker host only', async () => {
    const git = async (...args: string[]) => execFileAsync('git', ['-C', root, ...args]);
    await git('init', '-q', '-b', 'main');
    await mkdir(join(root, '.ai-conductor'), { recursive: true });
    await writeFile(join(root, '.ai-conductor', 'config.yml'),
      'stacked_prs:\n  enabled: true\n  max_slices: 2\n  route_whole_feature_fixes: true\n');
    await writeFile(join(root, '.pipeline', 'coverage-binding.json'), JSON.stringify({
      version: 1, slug: 'demo', runId: 'run', status: 'done', entries: [],
      sliceMembership: { taskSlices: { T1: 1, T3: 1 }, titles: ['foundation'] },
    }));
    const record = {
      roundId: 'r1', kind: 'audit', phase: 'open',
      items: [{ findingId: 'finding', kind: 'audit', owner: 1, host: 2, reason: 'routed', fallback: [], existingTask: true, taskIds: ['T1'] }],
      allocation: { 2: { remTaskIds: ['rem-r1-1'], blockBodies: ['### Task rem-r1-1\n'] } },
      hosts: { 2: 'repairing' }, currentHostIndex: 0, receipt: {}, outbox: [],
    };
    const writeRef = async (name: string, value: unknown) => {
      const source = join(root, `${name.replace('/', '-')}.json`);
      await writeFile(source, JSON.stringify(value));
      const blob = (await git('hash-object', '-w', source)).stdout.trim();
      await git('update-ref', `refs/conductor/demo/${name}`, blob);
    };
    await writeRef('routes/r1', record);
    await writeRef('repairing', { host: 2, roundId: 'r1' });

    await writeFile(messagePath, 'feat: routed task\n\nTask: T1\n');
    await expect(run('feat/c2/demo')).resolves.toBe(0);

    await writeFile(messagePath, 'feat: unrelated task\n\nTask: T3\n');
    const output: string[] = [];
    await expect(run('feat/c2/demo', output)).resolves.toBe(1);
    expect(output.join('\n')).toContain('T3');
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

  it.each([2, '2'] as const)('accepts a canonical cached remediation child %j when its Child line is absent', async (cachedChild) => {
    await writeFile(messagePath, 'fix: remediation\n\nTask: rem-prd-audit-T1\n');
    await mkdir(join(root, '.docs', 'plans'), { recursive: true });
    await writeFile(join(root, '.docs', 'plans', 'demo.md'), '### Task rem-prd-audit-T1: repair\n');
    await writeFile(join(root, '.pipeline', 'engine-state.json'), JSON.stringify({
      appendedRemediationTaskChildren: { 'rem-prd-audit-T1': cachedChild },
    }));

    await expect(run('feat/c2/demo')).resolves.toBe(0);
  });

  it('refuses a malformed cached remediation child when its Child line is absent', async () => {
    await writeFile(messagePath, 'fix: remediation\n\nTask: rem-prd-audit-T1\n');
    await mkdir(join(root, '.docs', 'plans'), { recursive: true });
    await writeFile(join(root, '.docs', 'plans', 'demo.md'), '### Task rem-prd-audit-T1: repair\n');
    await writeFile(join(root, '.pipeline', 'engine-state.json'), JSON.stringify({
      appendedRemediationTaskChildren: { 'rem-prd-audit-T1': 'x' },
    }));
    const output: string[] = [];

    await expect(run('feat/c2/demo', output)).resolves.toBe(1);
    expect(output.join('\n')).toContain('unreadable membership');
    expect(output.join('\n')).toContain('rem-prd-audit-T1');
  });

  it('reads a rem task child from its committed plan block after a worktree recreation', async () => {
    await writeFile(messagePath, 'fix: remediation\n\nTask: rem-prd-audit-T1\n');
    await mkdir(join(root, '.docs', 'plans'), { recursive: true });
    await writeFile(
      join(root, '.docs', 'plans', 'demo.md'),
      '### Task rem-prd-audit-T1: repair\n\n**Child:** 1\n',
    );

    await expect(run('feat/c1/demo')).resolves.toBe(0);
  });

  it('prefers a rem task committed Child line and rebuilds its stale cache', async () => {
    await writeFile(messagePath, 'fix: remediation\n\nTask: rem-prd-audit-T1\n');
    await mkdir(join(root, '.docs', 'plans'), { recursive: true });
    await writeFile(
      join(root, '.docs', 'plans', 'demo.md'),
      '### Task rem-prd-audit-T1: repair\n\n**Child:** 1\n',
    );
    await writeFile(
      join(root, '.pipeline', 'engine-state.json'),
      JSON.stringify({
        appendedRemediationTaskIds: ['rem-prd-audit-T1'],
        appendedRemediationTaskChildren: { 'rem-prd-audit-T1': 2 },
      }),
    );

    await expect(run('feat/c1/demo')).resolves.toBe(0);
    await recordAppendedRemediationTaskIds(root, ['rem-prd-audit-T1']);
    const state = JSON.parse(await (await import('node:fs/promises')).readFile(
      join(root, '.pipeline', 'engine-state.json'),
      'utf8',
    ));
    expect(state.appendedRemediationTaskChildren).toMatchObject({ 'rem-prd-audit-T1': 1 });
  });

  it('refuses a rem task when neither the committed Child line nor cache is available', async () => {
    await writeFile(messagePath, 'fix: remediation\n\nTask: rem-prd-audit-T1\n');
    await mkdir(join(root, '.docs', 'plans'), { recursive: true });
    await writeFile(join(root, '.docs', 'plans', 'demo.md'), '### Task rem-prd-audit-T1: repair\n');
    const output: string[] = [];

    await expect(run('feat/c1/demo', output)).resolves.toBe(1);
    expect(output.join('\n')).toContain('unreadable membership');
    expect(output.join('\n')).toContain('rem-prd-audit-T1');
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
