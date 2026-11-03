import { makeLocalGitRunner, type LocalGitRunner } from '../local-git-runner.js';
import { parseCommitSha, type CommitSha } from '../restack/restack-types.js';
import { repairMarkerRefFor, revalidationQueueRefFor, routeRecordRefFor } from './routing-refs.js';
import {
  parseRepairMarker,
  parseRevalidationQueueRecord,
  parseRouteRecord,
  type RepairMarker,
  type RevalidationQueueRecord,
  type RouteRecord,
  type RoundId,
} from './route-types.js';

export type StoredRouteRecord = { readonly kind: 'record'; readonly slug: string; readonly blob: CommitSha; readonly record: RouteRecord };
export type ReadRouteRecordResult = { readonly kind: 'absent' } | { readonly kind: 'unreadable'; readonly blob?: CommitSha } | StoredRouteRecord;
export type ReadRepairMarkerResult = { readonly kind: 'absent' } | { readonly kind: 'unreadable'; readonly blob?: CommitSha } | { readonly kind: 'marker'; readonly slug: string; readonly blob: CommitSha; readonly marker: RepairMarker };
export type ReadRevalidationQueueResult = { readonly kind: 'absent' } | { readonly kind: 'unreadable'; readonly blob?: CommitSha } | { readonly kind: 'queue'; readonly slug: string; readonly blob: CommitSha; readonly queue: RevalidationQueueRecord };

export interface RoutingStateReaderDependencies { readonly git?: LocalGitRunner }

export type ReadRoutingRefResult =
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'blob'; readonly blob: CommitSha };

/** Resolves a durable routing ref without treating a missing ref as a failure. */
export async function readRoutingRef(git: LocalGitRunner, ref: string): Promise<ReadRoutingRefResult> {
  try {
    const resolved = await git(['rev-parse', '-q', '--verify', ref]);
    if (resolved.exitCode === 1) return { kind: 'absent' };
    const blob = resolved.exitCode === 0 ? parseCommitSha(resolved.stdout.trim()) : undefined;
    return blob === undefined ? { kind: 'unreadable' } : { kind: 'blob', blob };
  } catch {
    return { kind: 'unreadable' };
  }
}

export type ReadRoutingBlobResult =
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'contents'; readonly blob: CommitSha; readonly content: string };

/** Reads a durable routing blob while retaining absent and unreadable as distinct states. */
export async function readRoutingBlob(git: LocalGitRunner, ref: string): Promise<ReadRoutingBlobResult> {
  const resolved = await readRoutingRef(git, ref);
  if (resolved.kind !== 'blob') return resolved;
  try {
    const content = await git(['cat-file', '-p', resolved.blob]);
    return content.exitCode === 0
      ? { kind: 'contents', blob: resolved.blob, content: content.stdout }
      : { kind: 'unreadable' };
  } catch {
    return { kind: 'unreadable' };
  }
}

function readerGit(worktree: string, dependencies: RoutingStateReaderDependencies): LocalGitRunner {
  return dependencies.git ?? makeLocalGitRunner(worktree);
}

export async function readRouteRecord(worktree: string, slug: string, roundId: RoundId, dependencies: RoutingStateReaderDependencies = {}): Promise<ReadRouteRecordResult> {
  const value = await readRoutingBlob(readerGit(worktree, dependencies), routeRecordRefFor(slug, roundId));
  if (value.kind !== 'contents') return value;
  const record = parseRouteRecord(value.content);
  return record === undefined ? { kind: 'unreadable', blob: value.blob } : { kind: 'record', slug, blob: value.blob, record };
}

export async function readRepairMarker(worktree: string, slug: string, dependencies: RoutingStateReaderDependencies = {}): Promise<ReadRepairMarkerResult> {
  const value = await readRoutingBlob(readerGit(worktree, dependencies), repairMarkerRefFor(slug));
  if (value.kind !== 'contents') return value;
  const marker = parseRepairMarker(value.content);
  return marker === undefined ? { kind: 'unreadable', blob: value.blob } : { kind: 'marker', slug, blob: value.blob, marker };
}

export async function readRevalidationQueue(worktree: string, slug: string, dependencies: RoutingStateReaderDependencies = {}): Promise<ReadRevalidationQueueResult> {
  const value = await readRoutingBlob(readerGit(worktree, dependencies), revalidationQueueRefFor(slug));
  if (value.kind !== 'contents') return value;
  const queue = parseRevalidationQueueRecord(value.content);
  return queue === undefined ? { kind: 'unreadable', blob: value.blob } : { kind: 'queue', slug, blob: value.blob, queue };
}
