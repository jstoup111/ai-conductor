import { parseCommitSha, type CommitSha } from '../restack/restack-types.js';
import { routeRecordRefFor } from './routing-refs.js';
import { parseRouteRecord, type RouteRecord, type RoundId } from './route-types.js';

/** The read-only Git boundary used by durable route-record consumers. */
export interface RouteRecordGitRunner {
  (args: string[]): Promise<{ readonly exitCode: number; readonly stdout: string }>;
}

export type ReadRouteRecordResult =
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly blob?: CommitSha }
  | { readonly kind: 'record'; readonly slug: string; readonly blob: CommitSha; readonly record: RouteRecord };

/**
 * Reads and validates a durable route blob without loading the writer's
 * restack machinery. Writers retain ownership in route-record-store; readers
 * that only need the frozen allocation use this minimal store seam.
 */
export async function readRouteRecord(
  git: RouteRecordGitRunner,
  slug: string,
  roundId: RoundId,
): Promise<ReadRouteRecordResult> {
  try {
    const ref = await git(['rev-parse', '-q', '--verify', routeRecordRefFor(slug, roundId)]);
    if (ref.exitCode === 1) return { kind: 'absent' };
    const blob = ref.exitCode === 0 ? parseCommitSha(ref.stdout.trim()) : undefined;
    if (!blob) return { kind: 'unreadable' };
    const contents = await git(['cat-file', '-p', blob]);
    if (contents.exitCode !== 0) return { kind: 'unreadable', blob };
    const record = parseRouteRecord(contents.stdout);
    return record ? { kind: 'record', slug, blob, record } : { kind: 'unreadable', blob };
  } catch {
    return { kind: 'unreadable' };
  }
}
