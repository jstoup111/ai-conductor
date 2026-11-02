import { makeLocalGitRunner, type LocalGitRunner } from '../local-git-runner.js';
import { readRevalidationQueue, readRouteRecord } from './routing-state-reader.js';
import { parseRoundId } from './route-types.js';

export interface RoutedRoundOpenDependencies {
  readonly git?: LocalGitRunner;
}

/** True when durable routing state says that automatic base movement would race a round. */
export async function routedRoundOpen(
  worktree: string,
  slug: string,
  dependencies: RoutedRoundOpenDependencies = {},
): Promise<boolean> {
  const git = dependencies.git ?? makeLocalGitRunner(worktree);
  const queue = await readRevalidationQueue(worktree, slug, { git });
  if (queue.kind === 'unreadable') return true;
  if (queue.kind === 'queue' && queue.queue.entries.length > 0) return true;

  try {
    const listed = await git(['for-each-ref', '--format=%(refname)', `refs/conductor/${slug}/routes/`]);
    if (listed.exitCode !== 0) return true;
    for (const ref of listed.stdout.split('\n').filter(Boolean)) {
      const id = parseRoundId(ref.split('/').at(-1) ?? '');
      if (!id) return true;
      const record = await readRouteRecord(worktree, slug, id, { git });
      if (record.kind !== 'record' || record.record.phase !== 'closed') return true;
    }
  } catch {
    return true;
  }
  return false;
}
