import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';

import type { ChildId } from '../child-context.js';
import { parseChildId } from '../child-context.js';
import { makeGitRunner, type GitRunner } from '../rebase.js';
import { parseRoundId, type RoundId } from '../routing/route-types.js';
import type { ConductorEventEmitter } from '../../ui/events.js';
import { emitRestackRefused } from './restack-events.js';
import {
  isLegalChildStatusTransition,
  isLegalJournalTransition,
  parseCommitSha,
  parseRefName,
  type ChildRange,
  type ChildStatus,
  type CommitSha,
  type JournalState,
  type RefName,
  type RestackCause,
  type RestackOpId,
} from './restack-types.js';
import type { CommitterStamp } from './restack-replay.js';

export interface RestackJournalOwner {
  readonly host: string;
  readonly pid: number;
  readonly processStartTime: string;
}

export interface RestackJournalRef {
  readonly ref: RefName;
  readonly oldSha: CommitSha;
}

export interface RestackJournalChild {
  readonly child: ChildId;
  readonly status: ChildStatus;
  /** Exact old-to-new identities produced by this child's replay or resolver. */
  readonly rewrites?: readonly RestackJournalRewrite[];
}

/** JSON-safe representation of one exact replay correspondence. */
export interface RestackJournalRewrite {
  readonly from: CommitSha;
  readonly to: CommitSha;
}

export interface RestackJournalRouted {
  readonly roundId: RoundId;
  readonly host: ChildId;
  readonly routeOld: CommitSha;
  readonly markerOld: CommitSha;
  readonly queueOld?: CommitSha;
  readonly routeNew?: CommitSha;
  readonly queueNew?: CommitSha;
}

export interface RestackJournalInvalidation {
  readonly child: ChildId;
  readonly gates: readonly string[];
}

/** The immutable data supplied by the planner before a journal is created. */
export interface RestackJournalDraft {
  readonly opId: RestackOpId;
  readonly cause: RestackCause;
  readonly followOnCause?: RestackCause;
  readonly committer: CommitterStamp;
  /** The exact target default used by this operation, never re-resolved on recovery. */
  readonly newDefault?: CommitSha;
  /** Commits which were already present on that target when replay began. */
  readonly comparisonCommits?: readonly CommitSha[];
  /** Repair origins whose cascade counters are charged when this journal applies. */
  readonly originatingChildren?: readonly ChildId[];
  /** Routing refs and precomputed replacement blobs owned by this restack. */
  readonly routed?: RestackJournalRouted;
  /** Closed-child gates invalidated by the restack. */
  readonly invalidation?: readonly RestackJournalInvalidation[];
  readonly dirtyPaths: readonly string[];
  readonly refs: readonly RestackJournalRef[];
  readonly ranges: readonly ChildRange[];
  readonly children: readonly RestackJournalChild[];
}

/** Durable state stored as a blob behind the journal ref. */
export interface RestackJournal extends RestackJournalDraft {
  readonly state: JournalState;
  readonly owner: RestackJournalOwner;
}

export interface StoredRestackJournal {
  readonly slug: string;
  readonly blob: CommitSha;
  readonly journal: RestackJournal;
}

export type ReadRestackJournalResult =
  | { readonly kind: 'missing' }
  | { readonly kind: 'unreadable'; readonly blob: CommitSha }
  | { readonly kind: 'journal'; readonly slug: string; readonly blob: CommitSha; readonly journal: RestackJournal };

export type CreateRestackJournalResult =
  | { readonly kind: 'created'; readonly journal: StoredRestackJournal }
  | { readonly kind: 'refused'; readonly reason: 'restack-outstanding' }
  | { readonly kind: 'unavailable'; readonly detail: string };

export type UpdateRestackChildStatusResult =
  | { readonly kind: 'updated'; readonly journal: StoredRestackJournal }
  | { readonly kind: 'stale' }
  | { readonly kind: 'unavailable'; readonly detail: string };

export interface RoutedApplyPlan {
  readonly routeNew: CommitSha;
  readonly queueNew?: CommitSha;
  readonly invalidation: readonly RestackJournalInvalidation[];
}

export type RecordRoutedApplyPlanResult =
  | { readonly kind: 'updated'; readonly journal: StoredRestackJournal }
  | { readonly kind: 'stale' }
  | { readonly kind: 'unavailable'; readonly detail: string };

export interface RestackJournalDependencies {
  readonly git?: GitRunner;
}

const journalStates = new Set<JournalState>([
  'planned', 'ready', 'moved', 'synced', 'applied', 'aborted', 'rolling-back',
]);
const childStatuses = new Set<ChildStatus>(['pending', 'replayed', 'resolved']);
const causes = new Set<RestackCause>(['feature-repair', 'base-refresh']);

export function journalRefFor(slug: string): RefName {
  return `refs/conductor/${slug}/restack/journal` as RefName;
}

export function stagingRefFor(slug: string, child: ChildId): RefName {
  return `refs/conductor/${slug}/restack/staging/c${child}` as RefName;
}

function resultDetail(result: { readonly stderr: string }): string {
  return result.stderr.trim() || 'Git command failed';
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

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0);
}

function parseCause(value: unknown): RestackCause | undefined {
  return typeof value === 'string' && causes.has(value as RestackCause) ? value as RestackCause : undefined;
}

function parseOwner(value: unknown): RestackJournalOwner | undefined {
  if (!isRecord(value) || typeof value.host !== 'string' || value.host === '' || typeof value.pid !== 'number' || !Number.isInteger(value.pid) || value.pid <= 0
    || typeof value.processStartTime !== 'string' || value.processStartTime === '') return undefined;
  return { host: value.host, pid: value.pid, processStartTime: value.processStartTime };
}

function parseCommitter(value: unknown): CommitterStamp | undefined {
  if (!isRecord(value) || typeof value.name !== 'string' || value.name === '' || typeof value.email !== 'string' || value.email === ''
    || typeof value.date !== 'string' || value.date === '') return undefined;
  return { name: value.name, email: value.email, date: value.date };
}

function parseRefs(value: unknown): readonly RestackJournalRef[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const refs: RestackJournalRef[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.ref !== 'string' || typeof item.oldSha !== 'string') return undefined;
    const ref = parseRefName(item.ref);
    const oldSha = parseCommitSha(item.oldSha);
    if (!ref || !oldSha) return undefined;
    refs.push({ ref, oldSha });
  }
  return refs;
}

function parseRanges(value: unknown): readonly ChildRange[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ranges: ChildRange[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.child !== 'number' || typeof item.oldParent !== 'string' || typeof item.oldTip !== 'string'
      || (item.kind !== 'closed' && item.kind !== 'active' && item.kind !== 'leaf-active' && item.kind !== 'leaf-unentered')) return undefined;
    const child = parseChildId(item.child);
    const oldParent = parseCommitSha(item.oldParent);
    const oldTip = parseCommitSha(item.oldTip);
    if (!child || !oldParent || !oldTip) return undefined;
    ranges.push({ child, oldParent, oldTip, kind: item.kind });
  }
  return ranges;
}

function parseChildren(value: unknown): readonly RestackJournalChild[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const children: RestackJournalChild[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.child !== 'number' || typeof item.status !== 'string') return undefined;
    const child = parseChildId(item.child);
    if (!child || !childStatuses.has(item.status as ChildStatus)) return undefined;
    const rewrites = item.rewrites === undefined ? undefined : parseRewrites(item.rewrites);
    if (item.rewrites !== undefined && !rewrites) return undefined;
    children.push({ child, status: item.status as ChildStatus, ...(rewrites === undefined ? {} : { rewrites }) });
  }
  return children;
}

function parseRewrites(value: unknown): readonly RestackJournalRewrite[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rewrites: RestackJournalRewrite[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.from !== 'string' || typeof item.to !== 'string') return undefined;
    const from = parseCommitSha(item.from);
    const to = parseCommitSha(item.to);
    if (!from || !to) return undefined;
    rewrites.push({ from, to });
  }
  return rewrites;
}

function parseRouted(value: unknown): RestackJournalRouted | undefined {
  if (!isRecord(value) || typeof value.roundId !== 'string' || typeof value.host !== 'number'
    || typeof value.routeOld !== 'string' || typeof value.markerOld !== 'string') return undefined;
  const roundId = parseRoundId(value.roundId);
  const host = parseChildId(value.host);
  const routeOld = parseCommitSha(value.routeOld);
  const markerOld = parseCommitSha(value.markerOld);
  const queueOld = value.queueOld === undefined ? undefined : typeof value.queueOld === 'string' ? parseCommitSha(value.queueOld) : undefined;
  const routeNew = value.routeNew === undefined ? undefined : typeof value.routeNew === 'string' ? parseCommitSha(value.routeNew) : undefined;
  const queueNew = value.queueNew === undefined ? undefined : typeof value.queueNew === 'string' ? parseCommitSha(value.queueNew) : undefined;
  if (!roundId || !host || !routeOld || !markerOld
    || (value.queueOld !== undefined && !queueOld)
    || (value.routeNew !== undefined && !routeNew)
    || (value.queueNew !== undefined && !queueNew)) return undefined;
  return {
    roundId,
    host,
    routeOld,
    markerOld,
    ...(queueOld === undefined ? {} : { queueOld }),
    ...(routeNew === undefined ? {} : { routeNew }),
    ...(queueNew === undefined ? {} : { queueNew }),
  };
}

function parseInvalidation(value: unknown): readonly RestackJournalInvalidation[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const invalidation: RestackJournalInvalidation[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.child !== 'number' || !isStringArray(item.gates)) return undefined;
    const child = parseChildId(item.child);
    if (!child) return undefined;
    invalidation.push({ child, gates: [...item.gates] });
  }
  return invalidation;
}

function parseJournal(value: unknown): RestackJournal | undefined {
  if (!isRecord(value) || typeof value.opId !== 'string' || value.opId === '' || typeof value.state !== 'string') return undefined;
  const cause = parseCause(value.cause);
  const followOnCause = value.followOnCause === undefined ? undefined : parseCause(value.followOnCause);
  const owner = parseOwner(value.owner);
  const committer = parseCommitter(value.committer);
  const refs = parseRefs(value.refs);
  const ranges = parseRanges(value.ranges);
  const children = parseChildren(value.children);
  const newDefault = value.newDefault === undefined ? undefined : typeof value.newDefault === 'string' ? parseCommitSha(value.newDefault) : undefined;
  const comparisonCommits = value.comparisonCommits === undefined ? undefined
    : Array.isArray(value.comparisonCommits)
      ? value.comparisonCommits.map((commit) => typeof commit === 'string' ? parseCommitSha(commit) : undefined)
      : undefined;
  const originatingChildren = value.originatingChildren === undefined ? undefined
    : Array.isArray(value.originatingChildren)
      ? value.originatingChildren.map((child) => typeof child === 'number' ? parseChildId(child) : undefined)
      : undefined;
  const routed = value.routed === undefined ? undefined : parseRouted(value.routed);
  const invalidation = value.invalidation === undefined ? undefined : parseInvalidation(value.invalidation);
  if (!cause || (value.followOnCause !== undefined && !followOnCause) || !journalStates.has(value.state as JournalState) || !owner || !committer
    || !isStringArray(value.dirtyPaths) || !refs || !ranges || !children
    || (value.newDefault !== undefined && !newDefault)
    || (value.comparisonCommits !== undefined && (!comparisonCommits || comparisonCommits.some((commit) => !commit)))
    || (value.originatingChildren !== undefined && (!originatingChildren || originatingChildren.some((child) => !child)))
    || (value.routed !== undefined && !routed)
    || (value.invalidation !== undefined && !invalidation)) return undefined;
  return {
    opId: value.opId as RestackOpId,
    cause,
    ...(followOnCause === undefined ? {} : { followOnCause }),
    committer,
    ...(newDefault === undefined ? {} : { newDefault }),
    ...(comparisonCommits === undefined ? {} : { comparisonCommits: comparisonCommits as CommitSha[] }),
    ...(originatingChildren === undefined ? {} : { originatingChildren: originatingChildren as ChildId[] }),
    ...(routed === undefined ? {} : { routed }),
    ...(invalidation === undefined ? {} : { invalidation }),
    dirtyPaths: [...value.dirtyPaths],
    refs,
    ranges,
    children,
    state: value.state as JournalState,
    owner,
  };
}

async function processStartTime(pid: number): Promise<string | undefined> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    const afterCommand = stat.slice(stat.lastIndexOf(') ') + 2).trim().split(/\s+/);
    // Field 3 is index zero after the command; field 22 is the process start time.
    return afterCommand[19];
  } catch {
    return undefined;
  }
}

async function currentOwner(): Promise<RestackJournalOwner | undefined> {
  const start = await processStartTime(process.pid);
  return start === undefined ? undefined : { host: hostname(), pid: process.pid, processStartTime: start };
}

/** A PID is trusted only when its boot-relative start time still matches. */
export async function isJournalOwnerAlive(owner: RestackJournalOwner): Promise<boolean> {
  if (owner.host !== hostname()) return false;
  return (await processStartTime(owner.pid)) === owner.processStartTime;
}

/** Writes a journal JSON object as a loose Git blob without moving any ref. */
export async function writeRestackJournalBlob(
  worktree: string,
  journal: RestackJournal,
  dependencies: RestackJournalDependencies = {},
): Promise<CommitSha> {
  const git = dependencies.git ?? makeGitRunner(worktree);
  const written = await runGit(git, ['hash-object', '-w', '--stdin'], JSON.stringify(journal));
  const blob = written?.exitCode === 0 ? parseCommitSha(written.stdout.trim()) : undefined;
  if (!blob) throw new Error(`could not write restack journal blob: ${written ? resultDetail(written) : 'Git unavailable'}`);
  return blob;
}

/** Read and schema-check the journal ref; malformed blobs fail closed. */
export async function readRestackJournal(
  worktree: string,
  slug: string,
  dependencies: RestackJournalDependencies = {},
): Promise<ReadRestackJournalResult> {
  const git = dependencies.git ?? makeGitRunner(worktree);
  const ref = journalRefFor(slug);
  // A deleted journal is the normal post-recovery condition. `-q` gives it
  // Git's distinct exit status 1 instead of an error diagnostic/128.
  const resolved = await runGit(git, ['rev-parse', '-q', '--verify', ref]);
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
  const journal = parseJournal(parsed);
  return journal === undefined ? { kind: 'unreadable', blob } : { kind: 'journal', slug, blob, journal };
}

/** Create a new outstanding journal with Git's empty-old-value CAS. */
export async function createRestackJournal(
  worktree: string,
  slug: string,
  draft: RestackJournalDraft,
  emitter?: ConductorEventEmitter,
  dependencies: RestackJournalDependencies = {},
): Promise<CreateRestackJournalResult> {
  const owner = await currentOwner();
  if (!owner) return { kind: 'unavailable', detail: 'cannot determine restack journal owner process start time' };
  const journal: RestackJournal = { ...draft, state: 'planned', owner };
  const blob = await writeRestackJournalBlob(worktree, journal, dependencies);
  const git = dependencies.git ?? makeGitRunner(worktree);
  const created = await runGit(git, ['update-ref', journalRefFor(slug), blob, '']);
  if (created?.exitCode === 0) return { kind: 'created', journal: { slug, blob, journal } };
  if (created !== undefined) {
    await emitter?.emit(emitRestackRefused({ reason: 'restack-outstanding' }));
    return { kind: 'refused', reason: 'restack-outstanding' };
  }
  return { kind: 'unavailable', detail: 'Git unavailable while creating restack journal' };
}

/** Persist the routed refs' precomputed replacement blobs before applying them. */
export async function recordRoutedApplyPlan(
  worktree: string,
  previous: StoredRestackJournal,
  plan: RoutedApplyPlan,
  dependencies: RestackJournalDependencies = {},
): Promise<RecordRoutedApplyPlanResult> {
  if (previous.journal.state !== 'synced' || !previous.journal.routed) return { kind: 'stale' };
  const journal: RestackJournal = {
    ...previous.journal,
    routed: {
      ...previous.journal.routed,
      routeNew: plan.routeNew,
      ...(plan.queueNew === undefined ? {} : { queueNew: plan.queueNew }),
    },
    invalidation: plan.invalidation.map((entry) => ({ ...entry, gates: [...entry.gates] })),
  };
  const git = dependencies.git ?? makeGitRunner(worktree);
  const blob = await writeRestackJournalBlob(worktree, journal, { git });
  const updated = await runGit(git, ['update-ref', journalRefFor(previous.slug), blob, previous.blob]);
  if (!updated) return { kind: 'unavailable', detail: 'Git unavailable while recording routed apply plan' };
  if (updated.exitCode !== 0) return { kind: 'stale' };
  return { kind: 'updated', journal: { slug: previous.slug, blob, journal } };
}

/** Lines for a caller-owned update-ref transaction. The old blob is always pinned. */
export function journalStateUpdateLines(
  previous: StoredRestackJournal,
  nextBlob: CommitSha,
  nextState: JournalState,
): readonly string[] {
  if (!isLegalJournalTransition(previous.journal.state, nextState)) {
    throw new Error(`illegal restack journal transition: ${previous.journal.state} -> ${nextState}`);
  }
  return [`update ${journalRefFor(previous.slug)} ${nextBlob} ${previous.blob}`];
}

async function stagingTip(git: GitRunner, ref: RefName): Promise<CommitSha | '' | undefined> {
  // `-q` gives a missing ref the distinct status 1 even in the private
  // refs/conductor namespace, making the empty-old-value CAS unambiguous.
  const result = await runGit(git, ['rev-parse', '-q', '--verify', ref]);
  if (result?.exitCode === 1) return '';
  return result?.exitCode === 0 ? parseCommitSha(result.stdout.trim()) : undefined;
}

/** Create a staging ref outside refs/heads so an off-worktree commit remains reachable. */
export async function pinStagingRef(
  worktree: string,
  slug: string,
  child: ChildId,
  tip: CommitSha,
  dependencies: RestackJournalDependencies = {},
): Promise<boolean> {
  const git = dependencies.git ?? makeGitRunner(worktree);
  const ref = stagingRefFor(slug, child);
  const old = await stagingTip(git, ref);
  if (old === undefined) return false;
  const pinned = await runGit(git, ['update-ref', ref, tip, old]);
  return pinned?.exitCode === 0;
}

function childWithStatus(
  journal: RestackJournal,
  child: ChildId,
  status: ChildStatus,
  rewrites: ReadonlyMap<CommitSha, CommitSha>,
): RestackJournal | undefined {
  if (journal.state !== 'planned') return undefined;
  let found = false;
  const children = journal.children.map((entry) => {
    if (entry.child !== child) return entry;
    if (!isLegalChildStatusTransition(entry.status, status)) return entry;
    found = true;
    return { ...entry, status, rewrites: [...rewrites].map(([from, to]) => ({ from, to })) };
  });
  return found ? { ...journal, children } : undefined;
}

/** Atomically record a planned child's replay result and pin its staged commit. */
export async function updateRestackChildStatus(
  worktree: string,
  slug: string,
  previous: StoredRestackJournal,
  child: ChildId,
  status: ChildStatus,
  tip: CommitSha,
  rewrites: ReadonlyMap<CommitSha, CommitSha>,
  dependencies: RestackJournalDependencies = {},
): Promise<UpdateRestackChildStatusResult> {
  if (previous.slug !== slug) return { kind: 'unavailable', detail: 'journal slug does not match staging slug' };
  const journal = childWithStatus(previous.journal, child, status, rewrites);
  if (!journal) return { kind: 'unavailable', detail: 'invalid restack child-status transition' };
  const git = dependencies.git ?? makeGitRunner(worktree);
  const blob = await writeRestackJournalBlob(worktree, journal, { git });
  const stage = stagingRefFor(slug, child);
  const oldStage = await stagingTip(git, stage);
  if (oldStage === undefined) return { kind: 'unavailable', detail: 'cannot read staging ref' };
  // Child progress changes are not journal *state* transitions; keeping this
  // CAS separate is what lets the state-transition guard stay exact.
  const input = ['start', `update ${journalRefFor(slug)} ${blob} ${previous.blob}`, `update ${stage} ${tip} ${oldStage}`, 'prepare', 'commit', ''].join('\n');
  const updated = await runGit(git, ['update-ref', '--stdin'], input);
  if (updated?.exitCode !== 0) return { kind: 'stale' };
  if (!updated) return { kind: 'unavailable', detail: 'Git unavailable while updating restack journal' };
  return { kind: 'updated', journal: { slug, blob, journal } };
}

async function stagingDeleteLines(git: GitRunner, slug: string): Promise<string[] | undefined> {
  const prefix = `refs/conductor/${slug}/restack/staging/`;
  const listed = await runGit(git, ['for-each-ref', '--format=%(refname) %(objectname)', prefix]);
  if (listed?.exitCode !== 0) return undefined;
  const lines: string[] = [];
  for (const raw of listed.stdout.split('\n')) {
    if (raw.trim() === '') continue;
    const [name, object] = raw.trim().split(/\s+/, 2);
    const ref = name === undefined ? undefined : parseRefName(name);
    const sha = object === undefined ? undefined : parseCommitSha(object);
    if (!ref || !sha) return undefined;
    lines.push(`delete ${ref} ${sha}`);
  }
  return lines;
}

/**
 * Replace an applied repair that explicitly names its follow-on. This is the
 * sole non-create journal transition; its CAS and staging deletion are atomic.
 */
export async function replaceAppliedJournalWithFollowOn(
  worktree: string,
  slug: string,
  applied: StoredRestackJournal,
  followOn: RestackJournalDraft,
  dependencies: RestackJournalDependencies = {},
): Promise<CreateRestackJournalResult> {
  if (applied.slug !== slug || applied.journal.state !== 'applied' || applied.journal.followOnCause !== followOn.cause) {
    return { kind: 'refused', reason: 'restack-outstanding' };
  }
  const owner = await currentOwner();
  if (!owner) return { kind: 'unavailable', detail: 'cannot determine restack journal owner process start time' };
  const journal: RestackJournal = { ...followOn, state: 'planned', owner };
  const git = dependencies.git ?? makeGitRunner(worktree);
  const blob = await writeRestackJournalBlob(worktree, journal, { git });
  const deletes = await stagingDeleteLines(git, slug);
  if (deletes === undefined) return { kind: 'unavailable', detail: 'cannot list restack staging refs' };
  const input = ['start', `update ${journalRefFor(slug)} ${blob} ${applied.blob}`, ...deletes, 'prepare', 'commit', ''].join('\n');
  const replaced = await runGit(git, ['update-ref', '--stdin'], input);
  if (replaced?.exitCode === 0) return { kind: 'created', journal: { slug, blob, journal } };
  if (replaced !== undefined) return { kind: 'refused', reason: 'restack-outstanding' };
  return { kind: 'unavailable', detail: 'Git unavailable while replacing restack journal' };
}
