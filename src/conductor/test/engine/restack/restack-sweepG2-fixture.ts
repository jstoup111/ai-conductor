/**
 * Shared real-local-Git fixture helpers for the G2 done-when evidence sweep.
 * Every repository is created under the run-scoped TMPDIR that the Vitest
 * configuration installs, and each caller removes its own directories.
 */
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { writeCoverageBindingEnvelope, type CoverageBindingEnvelopeFilesystem } from '../../../src/engine/coverage-binding-envelope.js';
import { parseCommitSha, type CommitSha } from '../../../src/engine/restack/restack-types.js';

const execFile = promisify(execFileCallback);

const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

export interface SweepRepository {
  readonly repo: string;
  readonly git: (args: string[], env?: NodeJS.ProcessEnv) => Promise<{ readonly stdout: string; readonly stderr: string }>;
  /** Write one file (creating parents), stage it, commit, and return HEAD. */
  readonly commit: (message: string, path: string, content: string) => Promise<CommitSha>;
  readonly write: (path: string, content: string) => Promise<void>;
  readonly rev: (revision: string) => Promise<CommitSha>;
}

export function sha(raw: string): CommitSha {
  const parsed = parseCommitSha(raw.trim());
  if (!parsed) throw new Error(`expected a full Git object name, got ${raw}`);
  return parsed;
}

export async function createSweepRepository(prefix: string, cleanup: string[]): Promise<SweepRepository> {
  const repo = await mkdtemp(join(tmpdir(), prefix));
  cleanup.push(repo);
  const git = (args: string[], env?: NodeJS.ProcessEnv) => execFile('git', args, { cwd: repo, ...(env === undefined ? {} : { env: { ...process.env, ...env } }) });
  const write = async (path: string, content: string) => {
    await mkdir(dirname(join(repo, path)), { recursive: true });
    await writeFile(join(repo, path), content);
  };
  const rev = async (revision: string) => sha((await git(['rev-parse', revision])).stdout);
  const commit = async (message: string, path: string, content: string) => {
    await write(path, content);
    await git(['add', path]);
    await git(['commit', '-qm', message]);
    return rev('HEAD');
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'restack-sweep@example.test']);
  await git(['config', 'user.name', 'Restack Sweep']);
  await write('.gitignore', '.pipeline/\n');
  await git(['add', '.gitignore']);
  return { repo, git, commit, write, rev };
}

/** Seal a stacked feature whose positions are 1..n, the last being the leaf. */
export async function sealStack(repo: string, positions: readonly number[] = [1, 2, 3]): Promise<void> {
  await writeCoverageBindingEnvelope(repo, {
    version: 1,
    slug: 'demo',
    runId: 'run-1',
    status: 'done',
    entries: [],
    sliceMembership: {
      taskSlices: Object.fromEntries(positions.map((position) => [String(position), position])),
      titles: positions.map((position) => position === positions.at(-1) ? 'Leaf' : `Child ${position}`),
    },
    storyOwnership: Object.fromEntries(positions.map((position) => [`S${position}`, position])),
  }, envelopeFilesystem);
}

export async function removeAll(cleanup: string[]): Promise<void> {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
}

export async function stackRefs(subject: SweepRepository): Promise<string> {
  return (await subject.git([
    'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/', 'refs/conductor/demo/closed/',
  ])).stdout;
}

export async function persistedEvents(repo: string): Promise<Array<Record<string, unknown> & { type: string }>> {
  const raw = await readFile(join(repo, '.pipeline', 'events.jsonl'), 'utf8');
  return raw.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown> & { type: string });
}
