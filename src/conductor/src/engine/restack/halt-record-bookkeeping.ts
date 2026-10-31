import { HALT_RECORD_DIR } from '../halt-record.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitRunner } from '../rebase.js';
import { ownedPaths } from './restack-ownership.js';
import { parseCommitSha, type ChildRange, type CommitSha } from './restack-types.js';
import type { CommitterStamp } from './restack-replay.js';

/** Resolve the repository-relative halt-record path for one feature. */
export function haltRecordPathFor(slug: string): string {
  return `${HALT_RECORD_DIR}/${slug}.md`;
}

/** Read the record's resolution time, or its halt time when it remains unresolved. */
export function haltRecordTime(text: string | undefined): Date | undefined {
  if (text === undefined) return undefined;

  const resolved = text.match(/^Resolved at: (.+)$/m)?.[1];
  const halted = text.match(/^Halted at: (.+)$/m)?.[1];
  const value = resolved ?? halted;
  if (value === undefined) return undefined;

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)$/);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) return undefined;

  const time = new Date(value);
  return Number.isNaN(time.valueOf()) ? undefined : time;
}

/** Choose the newer halt record, retaining the parent record for ties or uncertainty. */
export function chooseHaltRecord(parentText: string | undefined, rangeText: string | undefined): 'parent' | 'range' {
  if (rangeText === undefined) return 'parent';
  const rangeTime = haltRecordTime(rangeText);
  if (rangeTime === undefined) return 'parent';
  if (parentText === undefined) return 'range';

  const parentTime = haltRecordTime(parentText);
  if (parentTime === undefined) return 'range';
  return rangeTime > parentTime ? 'range' : 'parent';
}

function requiredSha(raw: string, context: string): CommitSha {
  const parsed = parseCommitSha(raw.trim());
  if (!parsed) throw new Error(`${context} did not return a full Git object name`);
  return parsed;
}

async function textAt(git: GitRunner, revision: CommitSha, path: string): Promise<string | undefined> {
  const result = await git(['show', `${revision}:${path}`]);
  return result.exitCode === 0 ? result.stdout : undefined;
}

interface BlobEntry {
  readonly mode: string;
  readonly sha: CommitSha;
}

async function blobAt(git: GitRunner, revision: CommitSha, path: string): Promise<BlobEntry | undefined> {
  const result = await git(['ls-tree', revision, '--', path]);
  if (result.exitCode !== 0) throw new Error(`could not read halt-record blob at ${revision}: ${result.stderr}`);
  if (result.stdout.trim() === '') return undefined;
  const match = result.stdout.trim().match(/^(\d+)\s+blob\s+([0-9a-f]{40,64})\t/);
  if (!match) throw new Error(`could not parse halt-record blob at ${revision}`);
  return { mode: match[1]!, sha: requiredSha(match[2]!, 'halt-record blob') };
}

async function commitsAreSigned(git: GitRunner): Promise<boolean> {
  const result = await git(['config', '--bool', 'commit.gpgSign']);
  return result.exitCode === 0 && result.stdout.trim() === 'true';
}

/** True only for a non-merge commit whose sole changed path is this feature's halt record. */
export async function isHaltRecordOnlyCommit(commit: CommitSha, slug: string, git: GitRunner): Promise<boolean> {
  const parents = await git(['rev-list', '--parents', '-n', '1', commit]);
  if (parents.exitCode !== 0) throw new Error(`could not read parents for ${commit}: ${parents.stderr}`);
  if (parents.stdout.trim().split(/\s+/).length !== 2) return false;
  const changed = await git(['diff-tree', '--no-commit-id', '--name-only', '-r', `${commit}^`, commit]);
  if (changed.exitCode !== 0) throw new Error(`could not read changed paths for ${commit}: ${changed.stderr}`);
  const paths = changed.stdout.split('\n').filter(Boolean);
  return paths.length === 1 && paths[0] === haltRecordPathFor(slug);
}

async function recordTree(
  git: GitRunner,
  tip: CommitSha,
  path: string,
  source: BlobEntry | undefined,
): Promise<CommitSha> {
  const directory = await mkdtemp(join(tmpdir(), 'restack-halt-record-index-'));
  const env = { GIT_INDEX_FILE: join(directory, 'index') };
  try {
    const read = await git(['read-tree', tip], { env });
    if (read.exitCode !== 0) throw new Error(`could not load tip tree: ${read.stderr}`);
    const update = source === undefined
      ? await git(['update-index', '--force-remove', path], { env })
      : await git(['update-index', '--add', '--cacheinfo', `${source.mode},${source.sha},${path}`], { env });
    if (update.exitCode !== 0) throw new Error(`could not update halt-record tree: ${update.stderr}`);
    const written = await git(['write-tree'], { env });
    if (written.exitCode !== 0) throw new Error(`could not write halt-record tree: ${written.stderr}`);
    return requiredSha(written.stdout, 'halt-record tree');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export interface CarriedHaltRecord {
  readonly tip: CommitSha;
  readonly added: boolean;
}

/** Carry the range's newest owned record to the replay tip with an engine-stamped bookkeeping commit. */
export async function carryNewestHaltRecord(
  range: ChildRange,
  newParent: CommitSha,
  slug: string,
  tip: CommitSha,
  stamp: CommitterStamp,
  git: GitRunner,
): Promise<CarriedHaltRecord> {
  const path = haltRecordPathFor(slug);
  const rangeTouchedRecord = (await ownedPaths(range, newParent, git)).has(path);
  const [parentRecord, rangeRecord, parentBlob, rangeBlob, tipBlob] = await Promise.all([
    textAt(git, newParent, path), textAt(git, range.oldTip, path),
    blobAt(git, newParent, path), blobAt(git, range.oldTip, path), blobAt(git, tip, path),
  ]);
  const rangeWins = rangeTouchedRecord && chooseHaltRecord(parentRecord, rangeRecord) === 'range';
  const winner = rangeWins ? rangeBlob : parentBlob;
  if (tipBlob?.sha === winner?.sha) return { tip, added: false };

  const tree = await recordTree(git, tip, path, winner);
  const committed = await git([
    'commit-tree',
    ...(await commitsAreSigned(git) ? ['-S'] : []),
    tree, '-p', tip,
  ], {
    input: `halt record: ${slug}\n`,
    env: {
      GIT_AUTHOR_NAME: stamp.name,
      GIT_AUTHOR_EMAIL: stamp.email,
      GIT_AUTHOR_DATE: stamp.date,
      GIT_COMMITTER_NAME: stamp.name,
      GIT_COMMITTER_EMAIL: stamp.email,
      GIT_COMMITTER_DATE: stamp.date,
    },
  });
  if (committed.exitCode !== 0) throw new Error(`could not commit halt record: ${committed.stderr}`);
  return { tip: requiredSha(committed.stdout, 'halt-record commit'), added: true };
}

/** Add rewrite entries for halt-record commits omitted from a first-parent replay. */
export async function mapOmittedHaltRecordCommits(
  range: ChildRange,
  slug: string,
  newParent: CommitSha,
  finalTip: CommitSha,
  rewrites: Map<CommitSha, CommitSha>,
  git: GitRunner,
): Promise<void> {
  const result = await git(['rev-list', '--first-parent', '--reverse', `${range.oldParent}..${range.oldTip}`]);
  if (result.exitCode !== 0) throw new Error(`could not list omitted halt-record commits: ${result.stderr}`);
  let prior = newParent;
  let pending: CommitSha[] = [];
  for (const raw of result.stdout.split('\n').filter(Boolean)) {
    const commit = requiredSha(raw, 'omitted halt-record commit');
    const rewrite = rewrites.get(commit);
    if (rewrite !== undefined) {
      for (const omitted of pending) rewrites.set(omitted, prior);
      pending = [];
      prior = rewrite;
    } else if (await isHaltRecordOnlyCommit(commit, slug, git)) {
      pending.push(commit);
    }
  }
  for (const omitted of pending) rewrites.set(omitted, finalTip);
}
