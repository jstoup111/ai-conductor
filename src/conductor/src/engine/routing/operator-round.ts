import { access } from 'node:fs/promises';
import { join } from 'node:path';

import type { ChildId } from '../child-context.js';
import { childBranchFor } from '../feature-branch-identity.js';
import { loadConfig } from '../config.js';
import { makeGitRunner, type GitRunner } from '../rebase.js';
import { loadSliceTopology, type SliceTopology } from '../slice-topology.js';
import { publishedStackRefusal } from '../stack-publication.js';
import { readRestackJournal } from '../restack/restack-journal.js';
import { parseCommitSha, type CommitSha } from '../restack/restack-types.js';
import { routedRoundOpen } from './round-admission.js';
import { readRepairMarker, readRevalidationQueue, routingFenceOpen } from './route-record-store.js';
import { closureRefFor, redRefFor } from './routing-refs.js';
import { routingSettingOn, type CarriedOperatorChild } from './route-types.js';

export interface CheckOpenOperatorRoundInput {
  readonly worktree: string;
  readonly slug: string;
  readonly child: ChildId;
  readonly carry: readonly ChildId[];
  readonly reason: string;
}

export type OpenOperatorRoundRefusalKind =
  | 'published-stack'
  | 'leaf-target'
  | 'unknown-position'
  | 'target-open'
  | 'topology-unavailable'
  | 'not-stacked'
  | 'routing-off'
  | 'round-open'
  | 'queue-non-empty'
  | 'journal-open'
  | 'dirty-worktree'
  | 'reason-missing'
  | 'verify-green-contract-missing'
  | 'uncarried-commits'
  | 'carried-below-host';

export type OpenOperatorRoundRefusal = {
  readonly kind: OpenOperatorRoundRefusalKind;
  readonly text: string;
};

export type CheckOpenOperatorRoundResult =
  | {
      readonly kind: 'accepted';
      readonly topology: Extract<SliceTopology, { readonly kind: 'sliced' }>;
      readonly host: ChildId;
      readonly closure: CommitSha;
      readonly carried: readonly CarriedOperatorChild[];
    }
  | { readonly kind: 'refused'; readonly refusal: OpenOperatorRoundRefusal };

/** Read seams let the CLI keep all mutation after this predicate returns accepted. */
export interface CheckOpenOperatorRoundDependencies {
  readonly git?: GitRunner;
  readonly loadSliceTopology?: typeof loadSliceTopology;
  readonly publishedStackRefusal?: typeof publishedStackRefusal;
  readonly routedRoundOpen?: typeof routedRoundOpen;
  readonly routingFenceOpen?: typeof routingFenceOpen;
  readonly readRepairMarker?: typeof readRepairMarker;
  readonly readRevalidationQueue?: typeof readRevalidationQueue;
  readonly readRestackJournal?: typeof readRestackJournal;
  readonly loadConfig?: typeof loadConfig;
  readonly access?: typeof access;
}

function command(slug: string, child: ChildId, carry: readonly ChildId[] = []): string {
  const carried = [...new Set(carry)].sort((left, right) => left - right)
    .map((position) => ` --carry ${position}`).join('');
  return `ai-conductor stack land --slug ${slug} --child ${child}${carried} --reason "<why>"`;
}

function refuse(kind: OpenOperatorRoundRefusalKind, text: string): CheckOpenOperatorRoundResult {
  return { kind: 'refused', refusal: { kind, text } };
}

async function closureAt(
  git: GitRunner,
  slug: string,
  child: ChildId,
): Promise<CommitSha | undefined> {
  try {
    const result = await git(['rev-parse', '-q', '--verify', closureRefFor(slug, child)]);
    return result.exitCode === 0 ? parseCommitSha(result.stdout.trim()) : undefined;
  } catch {
    return undefined;
  }
}

async function childRawCommitTip(
  git: GitRunner,
  slug: string,
  child: ChildId,
  closure: CommitSha,
): Promise<CommitSha | undefined> {
  const branch = childBranchFor(slug, child);
  if (!branch.ok) return closure;
  try {
    const commits = await git(['rev-list', `${closure}..refs/heads/${branch.branch}`]);
    if (commits.exitCode !== 0) return closure;
    for (const commit of commits.stdout.split('\n').filter(Boolean)) {
      const changed = await git(['diff-tree', '--no-commit-id', '--name-only', '-r', commit]);
      if (changed.exitCode !== 0) return closure;
      const paths = changed.stdout.split('\n').filter(Boolean);
      if (paths.length === 0 || !paths.every((path) => path === `.docs/halted/${slug}.md`)) {
        const tip = await git(['rev-parse', '-q', '--verify', `refs/heads/${branch.branch}`]);
        return tip.exitCode === 0 ? parseCommitSha(tip.stdout.trim()) ?? closure : closure;
      }
    }
    return undefined;
  } catch {
    return closure;
  }
}

async function worktreeDirty(git: GitRunner): Promise<boolean> {
  try {
    const status = await git(['status', '--porcelain']);
    return status.exitCode !== 0 || status.stdout.trim() !== '';
  } catch {
    return true;
  }
}

async function hasVerifyGreenContract(
  worktree: string,
  slug: string,
  child: ChildId,
  git: GitRunner,
  checkAccess: typeof access,
): Promise<boolean> {
  try {
    const red = await git(['rev-parse', '-q', '--verify', redRefFor(slug, child)]);
    if (red.exitCode === 0) return true;
  } catch {
    return false;
  }
  try {
    await checkAccess(join(worktree, '.pipeline', 'children', String(child), 'acceptance-specs-run.json'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Rejects an unsafe landing before the CLI parks, leases, or creates a route.
 * Every branch is read-only so a refusal preserves the feature exactly as found.
 */
export async function checkOpenOperatorRound(
  input: CheckOpenOperatorRoundInput,
  dependencies: CheckOpenOperatorRoundDependencies = {},
): Promise<CheckOpenOperatorRoundResult> {
  const git = dependencies.git ?? makeGitRunner(input.worktree);
  const readTopology = dependencies.loadSliceTopology ?? loadSliceTopology;
  const readPublished = dependencies.publishedStackRefusal ?? publishedStackRefusal;
  const roundOpen = dependencies.routedRoundOpen ?? routedRoundOpen;
  const fenceOpen = dependencies.routingFenceOpen ?? routingFenceOpen;
  const readMarker = dependencies.readRepairMarker ?? readRepairMarker;
  const readQueue = dependencies.readRevalidationQueue ?? readRevalidationQueue;
  const readJournal = dependencies.readRestackJournal ?? readRestackJournal;
  const readConfig = dependencies.loadConfig ?? loadConfig;
  const checkAccess = dependencies.access ?? access;

  if (input.reason.trim() === '') {
    return refuse('reason-missing', `A non-empty reason is required; retry ${command(input.slug, input.child, input.carry)}.`);
  }

  const topology = await readTopology(input.worktree, input.slug, { git });
  if (topology.kind === 'unavailable') {
    return refuse('topology-unavailable', `Cannot read the sealed stack topology (${topology.cause}; #3365); resolve it, then retry ${command(input.slug, input.child, input.carry)}.`);
  }
  if (topology.kind !== 'sliced' || topology.positions.length < 2) {
    return refuse('not-stacked', `Feature ${input.slug} is not a stacked feature; use ordinary BUILD workflow instead of ${command(input.slug, input.child, input.carry)}.`);
  }

  const config = await readConfig(input.worktree);
  if (!routingSettingOn(config.ok ? config.config : undefined)) {
    return refuse('routing-off', `Routing is disabled by stacked_prs.route_whole_feature_fixes; enable it, then retry ${command(input.slug, input.child, input.carry)}.`);
  }
  if (await readPublished(input.worktree, input.slug, { git })) {
    return refuse('published-stack', `This stack is published and frozen by #3268; resolve publication first, then retry ${command(input.slug, input.child, input.carry)}.`);
  }

  const positions = topology.positions as readonly ChildId[];
  if (!positions.includes(input.child)) {
    return refuse('unknown-position', `Child ${input.child} is not a declared position (declared: ${positions.join(', ')}); choose one, then retry ${command(input.slug, input.child, input.carry)}.`);
  }
  const leaf = positions.at(-1)!;
  if (input.child === leaf) {
    return refuse('leaf-target', `Child ${input.child} is the leaf and cannot be a landing host; choose a closed child, then retry ${command(input.slug, input.child, input.carry)}.`);
  }

  const closure = await closureAt(git, input.slug, input.child);
  if (closure === undefined) {
    return refuse('target-open', `Child ${input.child} has no closure ref and is already open; work on it directly instead of ${command(input.slug, input.child, input.carry)}.`);
  }

  const carriedPositions = [...new Set(input.carry)];
  const carriedBelow = carriedPositions.find((child) => positions.indexOf(child) <= positions.indexOf(input.child));
  if (carriedBelow !== undefined) {
    return refuse('carried-below-host', `Child ${carriedBelow} is at or below host ${input.child}; land from the lowest affected child with ai-conductor stack land --child ${carriedBelow} --carry ${input.child} --reason "<why>".`);
  }

  const carried: CarriedOperatorChild[] = [];
  for (const child of positions.slice(0, -1)) {
    if (child === input.child) continue;
    const childClosure = await closureAt(git, input.slug, child);
    const tip = childClosure === undefined ? undefined : await childRawCommitTip(git, input.slug, child, childClosure);
    if (tip === undefined) continue;
    if (!carriedPositions.includes(child)) {
      return refuse('uncarried-commits', `child ${child} has commits past its closure; carry it with ${command(input.slug, input.child, [child])}.`);
    }
    carried.push({ child, tip });
  }

  const marker = await readMarker(input.worktree, input.slug, { git });
  if (marker.kind === 'marker') {
    return refuse('round-open', `Routing round ${marker.marker.roundId} is already open; finish or abandon it, then retry ${command(input.slug, input.child, input.carry)}.`);
  }
  const open = await roundOpen(input.worktree, input.slug, { git });
  const queue = await readQueue(input.worktree, input.slug, { git });
  if (queue.kind === 'queue' && queue.queue.entries.length > 0) {
    return refuse('queue-non-empty', `The revalidation queue has child ${queue.queue.entries[0]!.child} open; drain it, then retry ${command(input.slug, input.child, input.carry)}.`);
  }
  if (open) {
    return refuse('round-open', `A routing round is already open; finish or abandon it, then retry ${command(input.slug, input.child, input.carry)}.`);
  }
  const journal = await readJournal(input.worktree, input.slug, { git });
  if (!fenceOpen(journal)) {
    return refuse('journal-open', `The restack journal is open; recover it, then retry ${command(input.slug, input.child, input.carry)}.`);
  }
  if (await worktreeDirty(git)) {
    return refuse('dirty-worktree', `The worktree has uncommitted changes; commit or stash them, then retry ${command(input.slug, input.child, input.carry)}.`);
  }

  const ownsCriteria = Object.values(topology.storyOwnership).includes(input.child);
  if (ownsCriteria && !await hasVerifyGreenContract(input.worktree, input.slug, input.child, git, checkAccess)) {
    return refuse('verify-green-contract-missing', `Child ${input.child} has no verify-green contract; restore red/c${input.child} or acceptance evidence, then retry ${command(input.slug, input.child, input.carry)}.`);
  }
  return { kind: 'accepted', topology, host: input.child, closure, carried };
}
