import type { ConductorEventEmitter } from '../../ui/events.js';
import { parseCommitSha, type CommitSha } from '../restack/restack-types.js';
import { createRoutedConductStateStore } from '../conduct-state-store.js';
import type { ChildId } from '../child-context.js';
import { childBranchFor, leafBranchFor } from '../feature-branch-identity.js';
import { makeGitRunner, type GitRunner } from '../rebase.js';
import { switchToChild, type ChildLifecycleTarget } from '../child-lifecycle.js';
import type { StateMutation } from '../conduct-state-store.js';
import { readRestackJournal } from '../restack/restack-journal.js';
import { readRouteRecord, writeRoutingTransaction } from './route-record-store.js';
import { closureRefFor } from './routing-refs.js';
import { assertNever, type RouteKind, type RoundId } from './route-types.js';
import type { ConductState } from '../../types/state.js';

export type EnterHostRegionResult =
  | { readonly kind: 'entered'; readonly pinnedBase: CommitSha }
  | { readonly kind: 'resume'; readonly pinnedBase: CommitSha }
  | { readonly kind: 'refused'; readonly detail: string };

export interface EnterHostRegionInput {
  readonly worktree: string;
  readonly slug: string;
  readonly roundId: RoundId;
  readonly host: ChildId;
  readonly emitter: ConductorEventEmitter;
  readonly git?: GitRunner;
}

function terminalJournal(journal: Awaited<ReturnType<typeof readRestackJournal>>): boolean {
  return journal.kind === 'missing' || (journal.kind === 'journal' &&
    (journal.journal.state === 'aborted' ||
      (journal.journal.state === 'applied' && journal.journal.followOnCause === undefined)));
}

async function gitSha(git: GitRunner, ref: string): Promise<CommitSha | undefined> {
  try {
    const result = await git(['rev-parse', '-q', '--verify', ref]);
    return result.exitCode === 0 ? parseCommitSha(result.stdout.trim()) : undefined;
  } catch {
    return undefined;
  }
}

async function hostTarget(
  git: GitRunner,
  slug: string,
  host: ChildId,
): Promise<{ readonly target: ChildLifecycleTarget; readonly pinnedBase: CommitSha; readonly tree: CommitSha } | { readonly detail: string }> {
  let closure: CommitSha | undefined;
  try {
    const result = await git(['rev-parse', '-q', '--verify', closureRefFor(slug, host)]);
    if (result.exitCode === 0) {
      closure = parseCommitSha(result.stdout.trim());
      if (!closure) return { detail: `cannot parse host ${host} closure` };
    } else if (result.exitCode !== 1) {
      return { detail: `cannot resolve host ${host} closure` };
    }
  } catch {
    return { detail: `cannot resolve host ${host} closure` };
  }
  const isLeaf = closure === undefined;
  const pinnedBase = closure ?? await gitSha(git, `refs/heads/${leafBranchFor(slug)}`);
  if (!pinnedBase) return { detail: `cannot resolve host ${host} closure or leaf tip` };
  const tree = await gitSha(git, `${pinnedBase}^{tree}`);
  if (!tree) return { detail: `cannot resolve tree for host ${host} base ${pinnedBase}` };
  if (isLeaf) return { target: { child: host, position: host, branch: leafBranchFor(slug) }, pinnedBase, tree };
  const branch = childBranchFor(slug, host);
  if (!branch.ok) return { detail: branch.reason };
  return { target: { child: host, position: host, branch: branch.branch }, pinnedBase, tree };
}

async function verifyOrSwitch(
  input: EnterHostRegionInput,
  target: ChildLifecycleTarget,
  git: GitRunner,
): Promise<{ readonly kind: 'completed' } | { readonly kind: 'refused'; readonly detail: string }> {
  try {
    const current = await git(['symbolic-ref', '--short', 'HEAD']);
    if (current.exitCode !== 0) return { kind: 'refused', detail: 'cannot determine current branch before host switch' };
    if (current.stdout.trim() === target.branch) return { kind: 'completed' };
  } catch {
    return { kind: 'refused', detail: 'cannot determine current branch before host switch' };
  }
  const switched = await switchToChild(input.worktree, target, input.emitter, undefined, { git });
  return switched.kind === 'completed'
    ? switched
    : { kind: 'refused', detail: 'reason' in switched ? switched.reason : `cannot switch to host branch ${target.branch}` };
}

async function restageHostRegion(worktree: string, host: ChildId, kind: RouteKind): Promise<{ readonly kind: 'restaged' } | { readonly kind: 'refused'; readonly detail: string }> {
  switch (kind) {
    case 'audit': {
      const state = createRoutedConductStateStore(worktree, host);
      const current = await state.read();
      if (!current.ok) return { kind: 'refused', detail: `cannot read host ${host} region state: ${current.error.message}` };
      const result = await state.applyBatch({
        name: `restage routed host ${host} region`,
        mutations: (['acceptance_specs', 'build', 'test_suite', 'build_review'] as const).map((step) => ({
          field: step,
          expected: current.value[step],
          next: 'pending',
          intent: `restage routed host ${host} ${step}`,
        } as StateMutation<ConductState>)),
      });
      return 'message' in result
        ? { kind: 'refused', detail: `cannot restage host ${host} region: ${result.message}` }
        : { kind: 'restaged' };
    }
    case 'revalidate':
      return { kind: 'refused', detail: `revalidate host region entry is delivered by #3212` };
  }
  return assertNever(kind);
}

/**
 * Pins and enters the selected routed host exactly once before its BUILD
 * region can run. Appending frozen blocks and moving to `repairing` belong to
 * the following task, so this boundary intentionally leaves an admitted host
 * admitted after its audit restage.
 */
export async function enterHostRegion(input: EnterHostRegionInput): Promise<EnterHostRegionResult> {
  const git = input.git ?? makeGitRunner(input.worktree);
  const journal = await readRestackJournal(input.worktree, input.slug, { git });
  if (!terminalJournal(journal)) {
    return { kind: 'refused', detail: journal.kind === 'unreadable' ? 'restack journal is unreadable' : 'restack journal is non-terminal' };
  }

  let stored = await readRouteRecord(input.worktree, input.slug, input.roundId, { git });
  if (stored.kind !== 'record') return { kind: 'refused', detail: `routing record ${input.roundId} is unavailable` };
  const hostState = stored.record.hosts[input.host];
  if (hostState !== 'admitted' && hostState !== 'repairing') {
    return { kind: 'refused', detail: `routing round ${input.roundId} host ${input.host} is not admitted` };
  }

  const resolved = await hostTarget(git, input.slug, input.host);
  if ('detail' in resolved) return { kind: 'refused', detail: resolved.detail };
  let pinnedBase = stored.record.entry?.pinnedBase;
  if (stored.record.entry === undefined) {
    const next = { ...stored.record, entry: { pinnedBase: resolved.pinnedBase, tree: resolved.tree } };
    const wrote = await writeRoutingTransaction(input.worktree, input.slug, [
      { kind: 'update-record', previous: stored, record: next },
    ], { git });
    if (wrote.kind !== 'updated') return { kind: 'refused', detail: `cannot pin routing host entry: ${wrote.kind}` };
    pinnedBase = resolved.pinnedBase;
    stored = await readRouteRecord(input.worktree, input.slug, input.roundId, { git });
    if (stored.kind !== 'record') return { kind: 'refused', detail: `routing record ${input.roundId} is unavailable after pin` };
  }

  const switched = await verifyOrSwitch(input, resolved.target, git);
  if (switched.kind === 'refused') return switched;
  if (stored.record.hosts[input.host] === 'repairing') return { kind: 'resume', pinnedBase: pinnedBase! };

  const restaged = await restageHostRegion(input.worktree, input.host, stored.record.kind);
  if (restaged.kind === 'refused') return restaged;
  return { kind: 'entered', pinnedBase: pinnedBase! };
}
