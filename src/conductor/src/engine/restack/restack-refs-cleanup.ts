import { MAX_CHILD_ID } from '../child-context.js';
import { childBranchFor, leafBranchFor } from '../feature-branch-identity.js';
import { pushedTipIntentRef, pushedTipRef } from '../push-lease.js';
import type { GitRunner } from '../rebase.js';
import { journalRefFor, readRestackJournal, stagingRefFor } from './restack-journal.js';
import { cascadesRefFor } from './cascade-cap.js';

/**
 * The feature-owned conductor refs have deliberately finite names.  Cleanup
 * must never discover them with `for-each-ref`: a typo in a slug must not turn
 * a teardown into a prefix delete.
 */
export function featureConductorRefNames(slug: string): readonly string[] {
  const refs = [
    pushedTipRef(slug, leafBranchFor(slug)),
    pushedTipIntentRef(slug, leafBranchFor(slug)),
    cascadesRefFor(slug),
    `refs/conductor/${slug}/leaf-moved`,
    journalRefFor(slug),
  ];
  for (let id = 1; id <= MAX_CHILD_ID; id += 1) {
    const child = childBranchFor(slug, id);
    if (!child.ok) continue;
    refs.push(
      pushedTipRef(slug, child.branch),
      pushedTipIntentRef(slug, child.branch),
    );
  }
  return refs;
}

async function run(git: GitRunner, args: string[], input?: string) {
  try {
    return await git(args, input === undefined ? undefined : { input });
  } catch {
    return undefined;
  }
}

/**
 * Remove all known durable state for one feature after its normal teardown
 * gate succeeded.  Every candidate is individually verified first and every
 * existing ref is deleted in a single compare-and-swap transaction.
 *
 * The caller supplies a Git runner already scoped to the repository.  A false
 * result is intentionally observational: teardown/reclaim is already decided
 * and a later sweep can retry the finite list without changing that decision.
 */
export async function deleteFeatureConductorRefs(
  slug: string,
  git: GitRunner,
): Promise<boolean> {
  let complete = true;
  const journal = await readRestackJournal('.', slug, { git });
  const candidates = new Set(featureConductorRefNames(slug));
  if (journal.kind === 'journal') {
    for (const range of journal.journal.ranges) candidates.add(stagingRefFor(slug, range.child));
  } else if (journal.kind === 'unreadable') {
    // The fixed names remain safe to remove, but an unreadable journal may
    // name staging refs we cannot prove are this operation's refs.
    complete = false;
  }

  const existing: Array<{ ref: string; oid: string }> = [];
  for (const ref of candidates) {
    const resolved = await run(git, ['rev-parse', '-q', '--verify', ref]);
    if (resolved?.exitCode === 1) continue;
    if (resolved?.exitCode !== 0 || resolved.stdout.trim() === '') {
      complete = false;
      continue;
    }
    existing.push({ ref, oid: resolved.stdout.trim() });
  }
  if (existing.length === 0) return complete;

  const input = [
    'start',
    ...existing.map(({ ref, oid }) => `delete ${ref} ${oid}`),
    'prepare',
    'commit',
    '',
  ].join('\n');
  const deleted = await run(git, ['update-ref', '--stdin'], input);
  return complete && deleted?.exitCode === 0;
}
