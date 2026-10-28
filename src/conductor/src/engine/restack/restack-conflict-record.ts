import { parseChildId, type ChildId } from '../child-context.js';
import { makeGitRunner, type GitRunner } from '../rebase.js';
import { replayChildRange, type CommitterStamp } from './restack-replay.js';
import { parseCommitSha, type ChildRange, type CommitSha, type RefName, type RestackOpId } from './restack-types.js';

const ZERO_SHA = '0'.repeat(40) as CommitSha;

/** Durable hand-off data for one unresolved feature-repair replay conflict. */
export interface RestackConflictRecord {
  readonly opId: RestackOpId;
  readonly child: ChildId;
  readonly oldParent: CommitSha;
  readonly oldTip: CommitSha;
  readonly newParent: CommitSha;
  readonly newParentTree: CommitSha;
  readonly candidateSubjects: readonly string[];
  readonly commit: CommitSha;
  readonly paths: readonly string[];
}

export interface StoredConflictRecord {
  readonly kind: 'record';
  readonly slug: string;
  /** Blob behind the conflict-record ref; used as the record CAS value. */
  readonly blob: CommitSha;
  readonly record: RestackConflictRecord;
}

export type ReadConflictRecordResult =
  | { readonly kind: 'missing' }
  | { readonly kind: 'unreadable'; readonly blob: CommitSha }
  | StoredConflictRecord;

export type WriteConflictRecordResult =
  | { readonly kind: 'updated' }
  | { readonly kind: 'stale' }
  | { readonly kind: 'unavailable' };

export interface ConflictRecordDependencies {
  readonly git?: GitRunner;
}

/** Exact old values needed when a consuming restack removes conflict state. */
export interface ConsumedConflictRefs {
  readonly child: ChildId;
  readonly tip: CommitSha;
  readonly record: CommitSha;
  readonly parent: CommitSha;
}

export type ConsumeRecordedResolutionResult =
  | { readonly kind: 'none' }
  | { readonly kind: 'stale'; readonly field: 'record' | 'range' | 'parent-tree' }
  | {
    readonly kind: 'consumed';
    readonly tip: CommitSha;
    readonly rewrites: ReadonlyMap<CommitSha, CommitSha>;
    readonly resolution: ConsumedConflictRefs;
  };

export interface ConsumeRecordedResolutionInput {
  readonly slug: string;
  readonly range: ChildRange;
  readonly parent: CommitSha;
  readonly committer: CommitterStamp;
  readonly git: GitRunner;
}

export function conflictRecordRefFor(slug: string): RefName {
  return `refs/conductor/${slug}/restack/conflict/record` as RefName;
}

export function conflictParentRefFor(slug: string): RefName {
  return `refs/conductor/${slug}/restack/conflict/parent` as RefName;
}

export function resolutionRefFor(slug: string, child: ChildId): RefName {
  return `refs/conductor/${slug}/restack/resolution/c${child}` as RefName;
}

async function runGit(git: GitRunner, args: string[], input?: string) {
  try {
    return await git(args, input === undefined ? undefined : { input });
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0)
    ? [...value]
    : undefined;
}

/** Keep the durable hand-off fail-closed, matching the restack journal parser. */
function parseConflictRecord(value: unknown): RestackConflictRecord | undefined {
  if (!isRecord(value)
    || typeof value.opId !== 'string' || value.opId === ''
    || typeof value.child !== 'number'
    || typeof value.oldParent !== 'string'
    || typeof value.oldTip !== 'string'
    || typeof value.newParent !== 'string'
    || typeof value.newParentTree !== 'string'
    || typeof value.commit !== 'string') return undefined;
  const child = parseChildId(value.child);
  const oldParent = parseCommitSha(value.oldParent);
  const oldTip = parseCommitSha(value.oldTip);
  const newParent = parseCommitSha(value.newParent);
  const newParentTree = parseCommitSha(value.newParentTree);
  const commit = parseCommitSha(value.commit);
  const candidateSubjects = parseStringArray(value.candidateSubjects);
  const paths = parseStringArray(value.paths);
  if (!child || !oldParent || !oldTip || !newParent || !newParentTree || !commit || !candidateSubjects || !paths) return undefined;
  return {
    opId: value.opId as RestackOpId,
    child,
    oldParent,
    oldTip,
    newParent,
    newParentTree,
    candidateSubjects,
    commit,
    paths,
  };
}

async function refValue(git: GitRunner, ref: RefName): Promise<CommitSha | typeof ZERO_SHA | undefined> {
  const resolved = await runGit(git, ['rev-parse', '-q', '--verify', ref]);
  if (resolved?.exitCode === 1) return ZERO_SHA;
  return resolved?.exitCode === 0 ? parseCommitSha(resolved.stdout.trim()) : undefined;
}

/** Read and validate a durable conflict record. A malformed blob is never usable. */
export async function readConflictRecord(
  worktree: string,
  slug: string,
  dependencies: ConflictRecordDependencies = {},
): Promise<ReadConflictRecordResult> {
  const git = dependencies.git ?? makeGitRunner(worktree);
  const resolved = await runGit(git, ['rev-parse', '-q', '--verify', conflictRecordRefFor(slug)]);
  if (resolved?.exitCode === 1) return { kind: 'missing' };
  const blob = resolved?.exitCode === 0 ? parseCommitSha(resolved.stdout.trim()) : undefined;
  if (!blob) return { kind: 'unreadable', blob: '' as CommitSha };
  const contents = await runGit(git, ['cat-file', 'blob', blob]);
  if (contents?.exitCode !== 0) return { kind: 'unreadable', blob };
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents.stdout);
  } catch {
    return { kind: 'unreadable', blob };
  }
  const record = parseConflictRecord(parsed);
  return record === undefined ? { kind: 'unreadable', blob } : { kind: 'record', slug, blob, record };
}

/**
 * Store the record blob and its reachable replay parent in one compare-and-
 * swap transaction. Both refs carry an explicit old value, including creates.
 */
export async function writeConflictRecord(
  worktree: string,
  slug: string,
  input: RestackConflictRecord,
  dependencies: ConflictRecordDependencies = {},
): Promise<WriteConflictRecordResult> {
  const serialized = JSON.stringify(input);
  if (!parseConflictRecord(JSON.parse(serialized))) return { kind: 'unavailable' };
  const git = dependencies.git ?? makeGitRunner(worktree);
  const previous = await readConflictRecord(worktree, slug, { git });
  if (previous.kind === 'unreadable') return { kind: 'unavailable' };
  const oldRecord = previous.kind === 'record' ? previous.blob : ZERO_SHA;
  const oldParent = await refValue(git, conflictParentRefFor(slug));
  if (oldParent === undefined) return { kind: 'unavailable' };
  // Existing record and parent must describe one coherent durable hand-off;
  // replacing a partially-written or externally-corrupted pair would hide it.
  if ((previous.kind === 'record' && oldParent !== previous.record.newParent)
    || (previous.kind === 'missing' && oldParent !== ZERO_SHA)) return { kind: 'unavailable' };
  const written = await runGit(git, ['hash-object', '-w', '--stdin'], serialized);
  const blob = written?.exitCode === 0 ? parseCommitSha(written.stdout.trim()) : undefined;
  if (!blob) return { kind: 'unavailable' };
  const transaction = [
    'start',
    `update ${conflictRecordRefFor(slug)} ${blob} ${oldRecord}`,
    `update ${conflictParentRefFor(slug)} ${input.newParent} ${oldParent}`,
    'prepare',
    'commit',
    '',
  ].join('\n');
  const updated = await runGit(git, ['update-ref', '--stdin'], transaction);
  if (updated?.exitCode === 0) return { kind: 'updated' };
  return updated === undefined ? { kind: 'unavailable' } : { kind: 'stale' };
}

/** Delete all state consumed by a successful restack with explicit old values. */
export function conflictDeleteLines(slug: string, refs: ConsumedConflictRefs): readonly string[] {
  return [
    `delete ${resolutionRefFor(slug, refs.child)} ${refs.tip}`,
    `delete ${conflictRecordRefFor(slug)} ${refs.record}`,
    `delete ${conflictParentRefFor(slug)} ${refs.parent}`,
  ];
}

async function subjectsByCommit(
  git: GitRunner,
  range: string,
): Promise<ReadonlyMap<string, readonly CommitSha[]>> {
  const listed = await runGit(git, ['rev-list', '--first-parent', '--reverse', range]);
  if (listed?.exitCode !== 0) throw new Error(`cannot list resolution range ${range}`);
  const subjects = new Map<string, CommitSha[]>();
  for (const raw of listed?.stdout.split('\n').filter(Boolean) ?? []) {
    const commit = parseCommitSha(raw);
    if (!commit) throw new Error('cannot parse resolution range commit');
    const subject = await runGit(git, ['show', '-s', '--format=%s', commit]);
    if (subject?.exitCode !== 0 || subject.stdout.trim() === '') throw new Error(`cannot read resolution subject for ${commit}`);
    const value = subject.stdout.trim();
    subjects.set(value, [...(subjects.get(value) ?? []), commit]);
  }
  return subjects;
}

function uniqueSubjectCommit(
  subjects: ReadonlyMap<string, readonly CommitSha[]>,
  subject: string,
): CommitSha | undefined {
  const commits = subjects.get(subject);
  return commits?.length === 1 ? commits[0] : undefined;
}

/**
 * Rebuild an operator-recorded resolution only when it still describes this
 * exact child range and the live replay parent has the recorded tree.
 */
export async function consumeRecordedResolution(
  input: ConsumeRecordedResolutionInput,
): Promise<ConsumeRecordedResolutionResult> {
  const resolutionRef = resolutionRefFor(input.slug, input.range.child);
  const resolved = await runGit(input.git, ['rev-parse', '-q', '--verify', `${resolutionRef}^{commit}`]);
  if (resolved?.exitCode === 1) return { kind: 'none' };
  const tip = resolved?.exitCode === 0 ? parseCommitSha(resolved.stdout.trim()) : undefined;
  if (!tip) throw new Error(`cannot resolve recorded resolution ${resolutionRef}`);

  // `readConflictRecord` only needs a worktree when it creates its runner;
  // consumption receives the caller's runner so the root is deliberately inert.
  const stored = await readConflictRecord('', input.slug, { git: input.git });
  if (stored.kind !== 'record' || stored.record.child !== input.range.child) return { kind: 'stale', field: 'record' };
  if (stored.record.oldParent !== input.range.oldParent || stored.record.oldTip !== input.range.oldTip) {
    return { kind: 'stale', field: 'range' };
  }
  const liveTree = await runGit(input.git, ['rev-parse', '--verify', `${input.parent}^{tree}`]);
  if (liveTree?.exitCode !== 0 || parseCommitSha(liveTree.stdout.trim()) !== stored.record.newParentTree) {
    return { kind: 'stale', field: 'parent-tree' };
  }

  const replayRange: ChildRange = {
    ...input.range,
    oldParent: stored.record.newParent,
    oldTip: tip,
  };
  const replay = await replayChildRange(replayRange, input.parent, input.committer, input.git, { comparisonCommits: [] });
  const [originals, resolutions] = await Promise.all([
    subjectsByCommit(input.git, `${input.range.oldParent}..${input.range.oldTip}`),
    subjectsByCommit(input.git, `${stored.record.newParent}..${tip}`),
  ]);
  const recordedCounts = new Map<string, number>();
  for (const subject of stored.record.candidateSubjects) recordedCounts.set(subject, (recordedCounts.get(subject) ?? 0) + 1);
  const rewrites = new Map<CommitSha, CommitSha>();
  for (const subject of stored.record.candidateSubjects) {
    if (recordedCounts.get(subject) !== 1) continue;
    const original = uniqueSubjectCommit(originals, subject);
    const resolution = uniqueSubjectCommit(resolutions, subject);
    const rebuilt = resolution === undefined ? undefined : replay.rewrites.get(resolution);
    if (original !== undefined && rebuilt !== undefined) rewrites.set(original, rebuilt);
  }
  return {
    kind: 'consumed',
    tip: replay.tip,
    rewrites,
    resolution: { child: input.range.child, tip, record: stored.blob, parent: stored.record.newParent },
  };
}
