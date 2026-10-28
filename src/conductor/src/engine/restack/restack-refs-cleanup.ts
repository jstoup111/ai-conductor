import { MAX_CHILD_ID, parseChildId } from '../child-context.js';
import { childBranchFor, leafBranchFor } from '../feature-branch-identity.js';
import { pushedTipIntentRef, pushedTipRef } from '../push-lease.js';
import type { GitRunner } from '../rebase.js';
import { routingTeardownRefNames } from '../routing/routing-refs.js';
import { journalRefFor, readRestackJournal, stagingRefFor } from './restack-journal.js';
import { cascadesRefFor } from './cascade-cap.js';
import { conflictParentRefFor, conflictRecordRefFor, resolutionRefFor } from './restack-conflict-record.js';

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
    conflictRecordRefFor(slug),
    conflictParentRefFor(slug),
  ];
  for (let id = 1; id <= MAX_CHILD_ID; id += 1) {
    const child = childBranchFor(slug, id);
    const childId = parseChildId(id);
    if (!child.ok || !childId) continue;
    refs.push(
      pushedTipRef(slug, child.branch),
      pushedTipIntentRef(slug, child.branch),
      resolutionRefFor(slug, childId),
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

function closureRefNames(slug: string): readonly string[] {
  return Array.from({ length: MAX_CHILD_ID }, (_unused, index) =>
    `refs/conductor/${slug}/closed/c${index + 1}`,
  );
}

interface RefProbe {
  readonly existing: readonly { ref: string; oid: string }[];
  readonly complete: boolean;
}

/** Probe a known list in one request, retaining only exact object ids. */
async function probeRefs(git: GitRunner, refs: readonly string[]): Promise<RefProbe> {
  if (refs.length === 0) return { existing: [], complete: true };
  const result = await run(git, ['cat-file', '--batch-check'], `${refs.join('\n')}\n`);
  if (result?.exitCode !== 0) return { existing: [], complete: false };

  const lines = result.stdout.split('\n');
  const existing: Array<{ ref: string; oid: string }> = [];
  let complete = true;
  for (const [index, ref] of refs.entries()) {
    const line = lines[index]?.trim();
    if (!line) {
      complete = false;
      continue;
    }
    const [oid, kind] = line.split(/\s+/, 2);
    if (kind === 'missing') continue;
    if (oid === undefined || !/^[0-9a-f]{40,64}$/i.test(oid) || !kind) {
      complete = false;
      continue;
    }
    existing.push({ ref, oid });
  }
  return { existing, complete };
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

  // Closed-child refs establish durable child state after a worktree is gone.
  // They lead the first batch so an N=1 feature never even names routing refs.
  const closureProbe = await probeRefs(git, [
    ...closureRefNames(slug),
    ...candidates,
  ]);
  complete = complete && closureProbe.complete;
  const existing = [...closureProbe.existing];
  const hasDurableChildState = closureProbe.existing.some(({ ref }) => ref.startsWith(`refs/conductor/${slug}/closed/c`));

  if (hasDurableChildState) {
    const routingProbe = await probeRefs(git, routingTeardownRefNames(slug));
    complete = complete && routingProbe.complete;
    // Closure refs are the only durable eligibility evidence for a later
    // routing teardown. If its bounded probe is incomplete, keep them (and
    // leave the whole deletion retryable) rather than stranding routing refs.
    if (!routingProbe.complete) return false;
    existing.push(...routingProbe.existing);
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
