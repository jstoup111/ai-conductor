import type { GitRunner } from '../rebase.js';
import { isHaltRecordOnlyCommit } from './halt-record-bookkeeping.js';
import { parseCommitSha, type ChildRange, type CommitSha } from './restack-types.js';

function requiredSha(raw: string, context: string): CommitSha {
  const sha = parseCommitSha(raw.trim());
  if (!sha) throw new Error(`${context} did not return a full Git object name`);
  return sha;
}

async function patchId(git: GitRunner, commit: CommitSha): Promise<string | undefined> {
  const patch = await git(['show', '--format=', '--no-ext-diff', commit]);
  if (patch.exitCode !== 0) throw new Error(`could not read patch for ${commit}: ${patch.stderr}`);
  const result = await git(['patch-id', '--stable'], { input: patch.stdout });
  if (result.exitCode !== 0) throw new Error(`could not compute patch-id for ${commit}: ${result.stderr}`);
  return result.stdout.trim().split('\n').find(Boolean)?.split(/\s+/, 1)[0];
}

/**
 * Select the first-parent commits that ordinary restack replay may apply.
 * Empty commits deliberately remain: unlike a patch-equivalent change, they
 * have no stable patch id and retain meaningful history.
 */
export async function selectReplayCandidates(
  git: GitRunner,
  range: ChildRange,
  comparisonCommits: readonly CommitSha[] = [],
  haltRecordSlug?: string,
): Promise<CommitSha[]> {
  const compared = new Set<string>();
  for (const commit of comparisonCommits) {
    const id = await patchId(git, commit);
    if (id !== undefined) compared.add(id);
  }
  const listed = await git(['rev-list', '--first-parent', '--reverse', `${range.oldParent}..${range.oldTip}`]);
  if (listed.exitCode !== 0) throw new Error(`could not list restack range: ${listed.stderr}`);

  const candidates: CommitSha[] = [];
  for (const raw of listed.stdout.split('\n').filter(Boolean)) {
    const commit = requiredSha(raw, 'restack replay candidate');
    if (haltRecordSlug !== undefined && await isHaltRecordOnlyCommit(commit, haltRecordSlug, git)) continue;
    // Only patches newly introduced by this operation are already carried. A
    // matching patch in the stack itself must remain in that child's history.
    if (!compared.has(await patchId(git, commit) ?? '')) candidates.push(commit);
  }
  return candidates;
}
