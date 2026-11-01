import { execa } from 'execa';
import { parseChildId, type ChildId } from '../child-context.js';
import { parseCommitSha, type ChildRange, type CommitSha, type RefName, type RestackOpId } from './restack-types.js';

const ZERO_SHA = '0'.repeat(40) as CommitSha;

interface GitRunner {
  (args: string[], opts?: { input?: string }): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

interface CommitterStamp { readonly name: string; readonly email: string; readonly date: string; }

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

/** Durable operator answer for one exact child range. */
export interface RestackDecision {
  readonly child: ChildId;
  readonly oldParent: CommitSha;
  readonly oldTip: CommitSha;
  readonly commit: CommitSha;
  readonly paths: readonly string[];
  readonly answer: string;
  readonly operator: string;
}

export interface StoredRestackDecision {
  readonly kind: 'decision';
  readonly slug: string;
  /** Blob behind the decision ref; used as the decision CAS value. */
  readonly blob: CommitSha;
  readonly decision: RestackDecision;
}

export type ReadRestackDecisionResult =
  | { readonly kind: 'missing' }
  | { readonly kind: 'unreadable'; readonly blob: CommitSha }
  | StoredRestackDecision;

export type RecordAnswerInput =
  | { readonly kind: 'decision'; readonly decision: RestackDecision }
  | { readonly kind: 'tip'; readonly child: ChildId; readonly tip: CommitSha };

export type RecordAnswerResult =
  | { readonly kind: 'updated' }
  | { readonly kind: 'stale' }
  | { readonly kind: 'unavailable' };

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
  readonly replay: (range: ChildRange, parent: CommitSha, committer: CommitterStamp, git: GitRunner) => Promise<{ tip: CommitSha; rewrites: ReadonlyMap<CommitSha, CommitSha> }>;
}

function makeGitRunner(worktree: string): GitRunner {
  return async (args, opts) => {
    const result = await execa('git', args, { cwd: worktree, input: opts?.input, reject: false });
    return { exitCode: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr };
  };
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

export function decisionRefFor(slug: string, child: ChildId): RefName {
  return `refs/conductor/${slug}/restack/decision/c${child}` as RefName;
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

/** Keep decisions fail-closed: every field is consumed by a later replay. */
function parseRestackDecision(value: unknown): RestackDecision | undefined {
  if (!isRecord(value)
    || typeof value.child !== 'number'
    || typeof value.oldParent !== 'string'
    || typeof value.oldTip !== 'string'
    || typeof value.commit !== 'string'
    || typeof value.answer !== 'string' || value.answer === ''
    || typeof value.operator !== 'string' || value.operator === '') return undefined;
  const child = parseChildId(value.child);
  const oldParent = parseCommitSha(value.oldParent);
  const oldTip = parseCommitSha(value.oldTip);
  const commit = parseCommitSha(value.commit);
  const paths = parseStringArray(value.paths);
  if (!child || !oldParent || !oldTip || !commit || !paths) return undefined;
  return { child, oldParent, oldTip, commit, paths, answer: value.answer, operator: value.operator };
}

async function refValue(git: GitRunner, ref: RefName): Promise<CommitSha | typeof ZERO_SHA | undefined> {
  const resolved = await runGit(git, ['rev-parse', '-q', '--verify', ref]);
  if (resolved?.exitCode === 1) return ZERO_SHA;
  return resolved?.exitCode === 0 ? parseCommitSha(resolved.stdout.trim()) : undefined;
}

/** Read and validate a durable decision. A malformed blob is never usable. */
export async function readRestackDecision(
  worktree: string,
  slug: string,
  child: ChildId,
  dependencies: ConflictRecordDependencies = {},
): Promise<ReadRestackDecisionResult> {
  const git = dependencies.git ?? makeGitRunner(worktree);
  const resolved = await runGit(git, ['rev-parse', '-q', '--verify', decisionRefFor(slug, child)]);
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
  const decision = parseRestackDecision(parsed);
  return decision === undefined ? { kind: 'unreadable', blob } : { kind: 'decision', slug, blob, decision };
}

/** A decision can be delivered only to the same logical child range. */
export function decisionMatchesRange(decision: RestackDecision, range: ChildRange): boolean {
  return decision.child === range.child
    && decision.oldParent === range.oldParent
    && decision.oldTip === range.oldTip;
}

/** Materialize a validated decision as a Git blob for an answer transaction. */
export async function writeRestackDecision(
  worktree: string,
  decision: RestackDecision,
  dependencies: ConflictRecordDependencies = {},
): Promise<CommitSha | undefined> {
  const serialized = JSON.stringify(decision);
  if (!parseRestackDecision(JSON.parse(serialized))) return undefined;
  const git = dependencies.git ?? makeGitRunner(worktree);
  const written = await runGit(git, ['hash-object', '-w', '--stdin'], serialized);
  return written?.exitCode === 0 ? parseCommitSha(written.stdout.trim()) : undefined;
}

/** Delete a delivered decision with the blob value observed at delivery time. */
export function decisionDeleteLines(
  slug: string,
  decision: Pick<StoredRestackDecision, 'blob'> & { readonly decision: Pick<RestackDecision, 'child'> },
): readonly string[] {
  return [`delete ${decisionRefFor(slug, decision.decision.child)} ${decision.blob}`];
}

/**
 * Replace one answer kind with the other in one ref transaction.  Each named
 * ref is compared against the exact value observed before the transaction.
 */
export async function recordAnswer(
  worktree: string,
  slug: string,
  answer: RecordAnswerInput,
  dependencies: ConflictRecordDependencies = {},
): Promise<RecordAnswerResult> {
  const git = dependencies.git ?? makeGitRunner(worktree);
  const child = answer.kind === 'decision' ? answer.decision.child : answer.child;
  const decisionRef = decisionRefFor(slug, child);
  const resolutionRef = resolutionRefFor(slug, child);
  const [oldDecision, oldResolution] = await Promise.all([
    refValue(git, decisionRef), refValue(git, resolutionRef),
  ]);
  if (oldDecision === undefined || oldResolution === undefined) return { kind: 'unavailable' };

  let update: string;
  let oppositeLine: string | undefined;
  if (answer.kind === 'decision') {
    const blob = await writeRestackDecision(worktree, answer.decision, { git });
    if (!blob) return { kind: 'unavailable' };
    update = `update ${decisionRef} ${blob} ${oldDecision}`;
    oppositeLine = oldResolution === ZERO_SHA
      ? `verify ${resolutionRef} ${ZERO_SHA}`
      : `delete ${resolutionRef} ${oldResolution}`;
  } else {
    update = `update ${resolutionRef} ${answer.tip} ${oldResolution}`;
    oppositeLine = oldDecision === ZERO_SHA
      ? `verify ${decisionRef} ${ZERO_SHA}`
      : `delete ${decisionRef} ${oldDecision}`;
  }
  const transaction = ['start', update, ...(oppositeLine ? [oppositeLine] : []), 'prepare', 'commit', ''].join('\n');
  const updated = await runGit(git, ['update-ref', '--stdin'], transaction);
  if (updated?.exitCode === 0) return { kind: 'updated' };
  return updated === undefined ? { kind: 'unavailable' } : { kind: 'stale' };
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

/** Subjects are an operator-resolution contract, not a patch-equivalence hint. */
export async function missingCandidateSubjects(
  git: GitRunner, parent: CommitSha, tip: CommitSha, candidates: readonly string[],
): Promise<readonly string[]> {
  const logged = await runGit(git, ['log', '--format=%s', `${parent}..${tip}`]);
  if (logged?.exitCode !== 0) throw new Error('cannot inspect recorded resolution subjects');
  const available = new Set(logged.stdout.split('\n').filter(Boolean));
  return [...new Set(candidates.filter((subject) => !available.has(subject)))];
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
  const replay = await input.replay(replayRange, input.parent, input.committer, input.git);
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
