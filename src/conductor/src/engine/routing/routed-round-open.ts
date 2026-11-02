import { makeLocalGitRunner, type LocalGitRunner } from '../local-git-runner.js';
import { parseCommitSha } from '../restack/restack-types.js';
import { routeRecordRefFor, revalidationQueueRefFor } from './routing-refs.js';
import { parseRevalidationQueueRecord, parseRoundId, parseRouteRecord } from './route-types.js';

export interface RoutedRoundOpenDependencies {
  readonly git?: LocalGitRunner;
}

type ReadRef =
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'contents'; readonly contents: string };

async function readRef(git: LocalGitRunner, ref: string): Promise<ReadRef> {
  try {
    const resolved = await git(['rev-parse', '-q', '--verify', ref]);
    if (resolved.exitCode === 1) return { kind: 'absent' };
    const blob = resolved.exitCode === 0 ? parseCommitSha(resolved.stdout.trim()) : undefined;
    if (!blob) return { kind: 'unreadable' };
    const contents = await git(['cat-file', '-p', blob]);
    return contents.exitCode === 0 ? { kind: 'contents', contents: contents.stdout } : { kind: 'unreadable' };
  } catch {
    return { kind: 'unreadable' };
  }
}

/** True when durable routing state says that automatic base movement would race a round. */
export async function routedRoundOpen(
  worktree: string,
  slug: string,
  dependencies: RoutedRoundOpenDependencies = {},
): Promise<boolean> {
  const git = dependencies.git ?? makeLocalGitRunner(worktree);
  const queue = await readRef(git, revalidationQueueRefFor(slug));
  if (queue.kind === 'unreadable') return true;
  if (queue.kind === 'contents') {
    const parsed = parseRevalidationQueueRecord(queue.contents);
    if (parsed === undefined || parsed.entries.length > 0) return true;
  }

  try {
    const listed = await git(['for-each-ref', '--format=%(refname)', `refs/conductor/${slug}/routes/`]);
    if (listed.exitCode !== 0) return true;
    for (const ref of listed.stdout.split('\n').filter(Boolean)) {
      const id = parseRoundId(ref.split('/').at(-1) ?? '');
      if (!id) return true;
      const record = await readRef(git, routeRecordRefFor(slug, id));
      if (record.kind !== 'contents') return true;
      const parsed = parseRouteRecord(record.contents);
      if (parsed === undefined || parsed.phase !== 'closed') return true;
    }
  } catch {
    return true;
  }
  return false;
}
