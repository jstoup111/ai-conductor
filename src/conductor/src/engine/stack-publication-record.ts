import { parseChildId, type ChildId } from './child-context.js';
import { makeGitRunner, type GitRunner } from './rebase.js';
import { parseCommitSha, type CommitSha } from './restack/restack-types.js';

const ZERO_SHA = '0'.repeat(40);

export type PublicationMemberLifecycle = 'merged' | 'closed' | 'reverted';

export interface PublicationMember {
  readonly position: ChildId;
  readonly branch: string;
  readonly pr: number;
  readonly lastSeen?: PublicationMemberLifecycle;
}

export interface PublicationRecord {
  readonly version: 1;
  readonly retarget?: { readonly from: string; readonly to: string; readonly phase: 'intended' | 'observed' };
  readonly stack?: { readonly number: number; readonly verified: boolean };
  readonly members: readonly PublicationMember[];
  readonly tornDown?: boolean;
  readonly unreachableReported?: boolean;
}

export interface StoredPublicationRecord {
  readonly kind: 'record';
  readonly slug: string;
  readonly blob: CommitSha;
  readonly record: PublicationRecord;
}

export type PublicationRecordDiagnostic =
  | 'invalid-json'
  | 'invalid-record'
  | 'unknown-version'
  | 'member-pr-missing'
  | 'invalid-blob'
  | 'git-read-failed';

export type ReadPublicationRecordResult =
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly diagnostic: PublicationRecordDiagnostic; readonly blob?: CommitSha }
  | StoredPublicationRecord;

export type WritePublicationRecordResult =
  | { readonly kind: 'updated' }
  | { readonly kind: 'cas-failed' }
  | { readonly kind: 'unavailable' };

export interface PublicationRecordDependencies {
  readonly git?: GitRunner;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function parseMember(value: unknown): PublicationMember | PublicationRecordDiagnostic {
  if (!isRecord(value)) return 'invalid-record';
  if (!Object.hasOwn(value, 'pr')) return 'member-pr-missing';
  const position = parseChildId(value.position as number);
  if (!position || !nonEmptyString(value.branch) || !isPositiveInteger(value.pr)) return 'invalid-record';
  if (value.lastSeen !== undefined && value.lastSeen !== 'merged' && value.lastSeen !== 'closed' && value.lastSeen !== 'reverted') {
    return 'invalid-record';
  }
  return value.lastSeen === undefined
    ? { position, branch: value.branch, pr: value.pr }
    : { position, branch: value.branch, pr: value.pr, lastSeen: value.lastSeen };
}

function parsePublicationRecord(serialized: string): { readonly record: PublicationRecord } | { readonly diagnostic: PublicationRecordDiagnostic } {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return { diagnostic: 'invalid-json' };
  }
  if (!isRecord(value)) return { diagnostic: 'invalid-record' };
  if (value.version !== 1) return { diagnostic: 'unknown-version' };
  if (!Array.isArray(value.members)) return { diagnostic: 'invalid-record' };

  const members: PublicationMember[] = [];
  let priorPosition = 0;
  for (const rawMember of value.members) {
    const member = parseMember(rawMember);
    if (typeof member === 'string') return { diagnostic: member };
    if (member.position <= priorPosition) return { diagnostic: 'invalid-record' };
    priorPosition = member.position;
    members.push(member);
  }

  let retarget: PublicationRecord['retarget'];
  if (value.retarget !== undefined) {
    if (!isRecord(value.retarget) || !nonEmptyString(value.retarget.from) || !nonEmptyString(value.retarget.to)
      || (value.retarget.phase !== 'intended' && value.retarget.phase !== 'observed')) return { diagnostic: 'invalid-record' };
    retarget = { from: value.retarget.from, to: value.retarget.to, phase: value.retarget.phase };
  }

  let stack: PublicationRecord['stack'];
  if (value.stack !== undefined) {
    if (!isRecord(value.stack) || !isPositiveInteger(value.stack.number) || typeof value.stack.verified !== 'boolean') {
      return { diagnostic: 'invalid-record' };
    }
    stack = { number: value.stack.number, verified: value.stack.verified };
  }
  if (value.tornDown !== undefined && typeof value.tornDown !== 'boolean') return { diagnostic: 'invalid-record' };
  if (value.unreachableReported !== undefined && typeof value.unreachableReported !== 'boolean') return { diagnostic: 'invalid-record' };

  return {
    record: {
      version: 1,
      ...(retarget ? { retarget } : {}),
      ...(stack ? { stack } : {}),
      members,
      ...(value.tornDown === true ? { tornDown: true } : {}),
      ...(value.unreachableReported === true ? { unreachableReported: true } : {}),
    },
  };
}

/** The one durable publication record for a feature. */
export function publicationRefFor(slug: string): string {
  return `refs/conductor/${slug}/publication`;
}

/** Reads the ref and parses its blob exactly once, without retaining a cache. */
export async function readPublicationRecord(
  worktree: string,
  slug: string,
  dependencies: PublicationRecordDependencies = {},
): Promise<ReadPublicationRecordResult> {
  const git = dependencies.git ?? makeGitRunner(worktree);
  try {
    const ref = await git(['rev-parse', '-q', '--verify', publicationRefFor(slug)]);
    if (ref.exitCode === 1) return { kind: 'absent' };
    const blob = ref.exitCode === 0 ? parseCommitSha(ref.stdout.trim()) : undefined;
    if (!blob) return { kind: 'unreadable', diagnostic: 'invalid-blob' };
    const contents = await git(['cat-file', '-p', blob]);
    if (contents.exitCode !== 0) return { kind: 'unreadable', diagnostic: 'git-read-failed', blob };
    const parsed = parsePublicationRecord(contents.stdout);
    return 'record' in parsed
      ? { kind: 'record', slug, blob, record: parsed.record }
      : { kind: 'unreadable', diagnostic: parsed.diagnostic, blob };
  } catch {
    return { kind: 'unreadable', diagnostic: 'git-read-failed' };
  }
}

/** Returns no active record after a completed teardown; the next feature may replace it. */
export async function activePublicationRecord(
  worktree: string,
  slug: string,
  dependencies: PublicationRecordDependencies = {},
): Promise<StoredPublicationRecord | undefined> {
  const stored = await readPublicationRecord(worktree, slug, dependencies);
  return stored.kind === 'record' && stored.record.tornDown !== true ? stored : undefined;
}

/**
 * Stores a validated JSON blob, using the exact observed old blob for CAS.
 * `undefined` is an explicit create expectation, never a read-then-write shortcut.
 */
export async function writePublicationRecord(
  worktree: string,
  slug: string,
  expectedOld: StoredPublicationRecord | undefined,
  next: PublicationRecord,
  dependencies: PublicationRecordDependencies = {},
): Promise<WritePublicationRecordResult> {
  if (expectedOld?.slug !== undefined && expectedOld.slug !== slug) return { kind: 'unavailable' };
  const serialized = JSON.stringify(next);
  if (!('record' in parsePublicationRecord(serialized))) return { kind: 'unavailable' };
  const git = dependencies.git ?? makeGitRunner(worktree);
  try {
    const hashed = await git(['hash-object', '-w', '--stdin'], { input: serialized });
    const blob = hashed.exitCode === 0 ? parseCommitSha(hashed.stdout.trim()) : undefined;
    if (!blob) return { kind: 'unavailable' };
    const updated = await git([
      'update-ref',
      publicationRefFor(slug),
      blob,
      expectedOld?.blob ?? ZERO_SHA,
    ]);
    return updated.exitCode === 0 ? { kind: 'updated' } : { kind: 'cas-failed' };
  } catch {
    return { kind: 'unavailable' };
  }
}
