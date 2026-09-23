/**
 * Shared real-git fixture for `resolveConflictingPr` integration tests.
 *
 * The sweep resolves in a throwaway worktree of `repoCwd` and publishes with a
 * lease push to `origin`. Git semantics (replay, conflicts, skipped commits,
 * lease) are the behavior under test, so the fixture uses a private local repo
 * with a private bare remote. GitHub is the only third-party boundary and is
 * replaced by a recording `GhRunner`; the push boundary is observed through the
 * bare remote's reflog, which records every ref update a push makes.
 */
import { execFile as execFileCb } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import type { GhRunner } from '../../src/engine/pr-labels.js';
import type { ConductorEvent } from '../../src/types/events.js';

const execFile = promisify(execFileCb);

export interface FeatureCommit {
  subject: string;
  files: Record<string, string>;
}

export interface PrFixture {
  repo: string;
  remote: string;
  prUrl: string;
  /** Feature commit shas in replay order. */
  shas: string[];
  gh: GhRunner;
  ghCalls: string[][];
  emitted: ConductorEvent[];
  /** Minimal emitter stub accepted by the resolution deps. */
  events: never;
  logs: string[];
  log: (message: string) => void;
  /** Number of pushes that updated the feature branch on the remote. */
  pushes(): Promise<number>;
  /** Bodies of every `gh pr comment` create call, in order. */
  commentBodies(): string[];
  cleanup(): Promise<void>;
}

async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
}

export async function buildPrFixture(opts: {
  initial: Record<string, string>;
  feature: FeatureCommit[];
  main: Record<string, string>;
  /** When set, `gh pr comment` calls whose body contains this text throw. */
  failCommentContaining?: string;
}): Promise<PrFixture> {
  const repo = await mkdtemp(join(tmpdir(), 'autoresolve-pr-'));
  const remote = join(repo, '.remote.git');
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 't@example.test']);
  await git(['config', 'user.name', 'Test']);
  await execFile('git', ['init', '--bare', '-q', '-b', 'main', remote]);
  await execFile('git', ['config', 'core.logAllRefUpdates', 'true'], { cwd: remote });
  await git(['remote', 'add', 'origin', remote]);
  await writeFile(join(repo, '.gitignore'), '.remote.git/\n');
  await writeFiles(repo, opts.initial);
  await git(['add', '.']);
  await git(['commit', '-q', '-m', 'init']);

  await git(['checkout', '-q', '-b', 'feature']);
  const shas: string[] = [];
  for (const commit of opts.feature) {
    await writeFiles(repo, commit.files);
    await git(['add', '.']);
    await git(['commit', '-q', '-m', commit.subject]);
    shas.push((await git(['rev-parse', 'HEAD'])).stdout.trim());
  }

  await git(['checkout', '-q', 'main']);
  await writeFiles(repo, opts.main);
  await git(['add', '.']);
  await git(['commit', '-q', '-m', 'main: conflicting upstream change']);
  await git(['push', '-q', 'origin', 'main', 'feature']);

  const ghCalls: string[][] = [];
  const gh: GhRunner = async (args) => {
    ghCalls.push(args);
    if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify({ comments: [] }) };
    if (
      opts.failCommentContaining !== undefined
      && args[0] === 'pr' && args[1] === 'comment'
      && (args[args.indexOf('--body') + 1] ?? '').includes(opts.failCommentContaining)
    ) {
      throw new Error('gh comment unavailable');
    }
    return { stdout: '' };
  };
  const emitted: ConductorEvent[] = [];
  const logs: string[] = [];

  return {
    repo,
    remote,
    prUrl: 'https://github.com/example/repo/pull/77',
    shas,
    gh,
    ghCalls,
    emitted,
    events: { emit: async (event: ConductorEvent) => { emitted.push(event); } } as never,
    logs,
    log: (message) => logs.push(message),
    async pushes() {
      const reflog = await execFile('git', ['reflog', 'show', '--format=%H', 'refs/heads/feature'], { cwd: remote });
      // The fixture's own setup push is the first entry.
      return reflog.stdout.trim().split('\n').filter(Boolean).length - 1;
    },
    commentBodies() {
      return ghCalls
        .filter((args) => args[0] === 'pr' && args[1] === 'comment')
        .map((args) => args[args.indexOf('--body') + 1] ?? '');
    },
    cleanup: () => rm(repo, { recursive: true, force: true }),
  };
}

/** Stage `files` and continue the paused rebase, as a resolver would. */
export async function settleAndContinue(projectRoot: string, files: Record<string, string>): Promise<void> {
  await writeFiles(projectRoot, files);
  await execFile('git', ['add', ...Object.keys(files)], { cwd: projectRoot });
  await execFile('git', ['-c', 'core.editor=true', 'rebase', '--continue'], { cwd: projectRoot });
}

/** Drop the paused replay commit, as a resolver declaring supersession would. */
export async function skipReplay(projectRoot: string): Promise<void> {
  await execFile('git', ['-c', 'core.editor=true', 'rebase', '--skip'], { cwd: projectRoot }).catch(() => undefined);
}

export const PASSING_SUITE = async () => ({ exitCode: 0, durationMs: 0, configured: true });
