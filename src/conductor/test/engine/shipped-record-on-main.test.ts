import { afterEach, describe, expect, it } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);
const roots: string[] = [];

type GitRunner = (
  args: string[],
  opts: { cwd: string },
) => Promise<{ stdout: string; stderr: string }>;

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFile('git', args, { cwd });
  return result.stdout.trim();
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('shippedRecordOnMain', () => {
  it('returns indeterminate when fetch or an ambiguous cat-file lookup fails', async () => {
    const module = await import('../../src/engine/shipped-record-on-main.js').catch(() => undefined);
    const failures: GitRunner[] = [
      async () => {
        throw new Error('fetch transport failed');
      },
      async (args) => {
        if (args[0] === 'cat-file') {
          throw Object.assign(new Error('git cat-file exited with code 128'), {
            code: 128,
            stdout: '',
            stderr: "fatal: invalid object name 'origin/main'",
          });
        }
        return { stdout: '', stderr: '' };
      },
    ];
    const results = module
      ? await Promise.all(
          failures.map((run) =>
            module.shippedRecordOnMain('/repo', 'uncertain', run).catch(() => 'threw'),
          ),
        )
      : ['missing-export', 'missing-export'];

    expect(results).toEqual(['indeterminate', 'indeterminate']);
  });

  it('returns absent when origin/main has no shipped record', async () => {
    const slug = 'not-shipped';
    const calls: string[][] = [];
    const run: GitRunner = async (args) => {
      calls.push(args);
      if (args[0] === 'cat-file') {
        throw Object.assign(new Error('git cat-file exited with code 128'), {
          code: 128,
          stdout: '',
          stderr: `fatal: path '.docs/shipped/${slug}.md' does not exist in 'origin/main'`,
        });
      }
      return { stdout: '', stderr: '' };
    };
    const module = await import('../../src/engine/shipped-record-on-main.js').catch(() => undefined);
    const result = module
      ? await module.shippedRecordOnMain('/repo', slug, run)
      : 'missing-export';

    expect({ result, calls }).toEqual({
      result: 'absent',
      calls: [
        ['fetch', 'origin', 'main'],
        ['cat-file', '-e', `origin/main:.docs/shipped/${slug}.md`],
      ],
    });
  });

  it('finds a shipped record on origin/main after squash merge even though feature ancestry is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shipped-record-squash-'));
    roots.push(root);
    const origin = join(root, 'origin.git');
    const repo = join(root, 'repo');
    const slug = 'squash-shipped';

    await git(root, 'init', '--bare', origin);
    await git(root, 'init', '-b', 'main', repo);
    await git(repo, 'config', 'user.name', 'Test User');
    await git(repo, 'config', 'user.email', 'test@example.invalid');
    await writeFile(join(repo, 'README.md'), 'fixture\n');
    await git(repo, 'add', 'README.md');
    await git(repo, 'commit', '-m', 'initial');
    await git(repo, 'remote', 'add', 'origin', origin);
    await git(repo, 'push', '-u', 'origin', 'main');
    await git(repo, 'checkout', '-b', `feature/${slug}`);
    await mkdir(join(repo, '.docs', 'shipped'), { recursive: true });
    await writeFile(join(repo, '.docs', 'shipped', `${slug}.md`), 'shipped\n');
    await git(repo, 'add', '.docs/shipped');
    await git(repo, 'commit', '-m', 'record shipment');
    const featureTip = await git(repo, 'rev-parse', 'HEAD');
    await git(repo, 'checkout', 'main');
    await git(repo, 'merge', '--squash', `feature/${slug}`);
    await git(repo, 'commit', '-m', 'squash merge feature');
    await git(repo, 'push', 'origin', 'main');

    const calls: string[][] = [];
    const run: GitRunner = async (args, opts) => {
      calls.push(args);
      const result = await execFile('git', args, { cwd: opts.cwd });
      return { stdout: result.stdout, stderr: result.stderr };
    };
    const module = await import('../../src/engine/shipped-record-on-main.js').catch(() => undefined);
    const result = module
      ? await module.shippedRecordOnMain(repo, slug, run)
      : 'missing-export';
    const ancestry = await execFile(
      'git',
      ['merge-base', '--is-ancestor', featureTip, 'main'],
      { cwd: repo },
    ).then(
      () => true,
      () => false,
    );

    expect({ result, ancestry, calls }).toEqual({
      result: 'present',
      ancestry: false,
      calls: [
        ['fetch', 'origin', 'main'],
        ['cat-file', '-e', `origin/main:.docs/shipped/${slug}.md`],
      ],
    });
  });
});
