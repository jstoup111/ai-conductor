import { childBranchFor } from '../feature-branch-identity.js';
import type { GitRunner } from '../rebase.js';
import { makeGitRunner } from '../rebase.js';
import { parseChildId, type ChildId } from '../child-context.js';
import {
  parseCommitSha,
  type ChildRange,
  type CommitSha,
  type RefName,
  type RestackCause,
  type RestackRefusalReason,
} from './restack-types.js';

export interface RestackPlanActiveChild {
  readonly child: ChildId;
  readonly branchRef: RefName;
  readonly isLeaf: boolean;
}

export interface RestackPlanUnenteredLeaf {
  readonly child: ChildId;
  readonly branchRef: RefName;
}

/** Inputs captured before a journal is created or a ref can be moved. */
export interface RestackPlanOptions {
  readonly slug: string;
  readonly oldDefaultTip: CommitSha;
  readonly cause: RestackCause;
  readonly active: RestackPlanActiveChild;
  readonly unenteredLeaf?: RestackPlanUnenteredLeaf;
}

export interface RestackPlanDependencies {
  readonly git?: GitRunner;
}

export type RestackPlanningRefusalReason = Extract<
  RestackRefusalReason,
  'range-not-ancestor' | 'closed-child-rewritten'
>;

/** A planner-only result: its caller alone creates a journal after `planned`. */
export type RestackPlanResult =
  | { readonly kind: 'planned'; readonly ranges: readonly ChildRange[]; readonly originating: readonly ChildId[] }
  | { readonly kind: 'refused'; readonly reason: RestackPlanningRefusalReason; readonly child: ChildId }
  | { readonly kind: 'repair-pending'; readonly child: ChildId }
  | { readonly kind: 'unavailable'; readonly detail: string };

interface ClosedChild {
  readonly child: ChildId;
  readonly closureTip: CommitSha;
  readonly branchRef: RefName;
  readonly branchTip: CommitSha;
}

async function runGit(git: GitRunner, args: string[]) {
  try {
    return await git(args);
  } catch {
    return undefined;
  }
}

async function resolveTip(git: GitRunner, branchRef: RefName): Promise<CommitSha | undefined> {
  const result = await runGit(git, ['rev-parse', '--verify', branchRef]);
  return result?.exitCode === 0 ? parseCommitSha(result.stdout.trim()) : undefined;
}

async function refExists(git: GitRunner, branchRef: RefName): Promise<boolean | undefined> {
  const result = await runGit(git, ['show-ref', '--verify', '--quiet', branchRef]);
  if (result?.exitCode === 0) return true;
  if (result?.exitCode === 1) return false;
  return undefined;
}

async function isAncestor(git: GitRunner, ancestor: CommitSha, descendant: CommitSha): Promise<boolean | undefined> {
  const result = await runGit(git, ['merge-base', '--is-ancestor', ancestor, descendant]);
  if (result?.exitCode === 0) return true;
  if (result?.exitCode === 1) return false;
  return undefined;
}

async function readClosedChildren(git: GitRunner, slug: string): Promise<ClosedChild[] | undefined> {
  const result = await runGit(git, ['for-each-ref', '--format=%(refname) %(objectname)', `refs/conductor/${slug}/closed/`]);
  if (result?.exitCode !== 0) return undefined;
  const prefix = `refs/conductor/${slug}/closed/c`;
  const closed: ClosedChild[] = [];
  for (const line of result.stdout.split('\n')) {
    const [rawRef, rawTip] = line.trim().split(/\s+/, 2);
    if (rawRef === undefined || rawTip === undefined || !rawRef.startsWith(prefix)) continue;
    const rawChild = rawRef.slice(prefix.length);
    const child = parseChildId(rawChild);
    const closureTip = parseCommitSha(rawTip);
    const branch = child === undefined ? undefined : childBranchFor(slug, child);
    const branchRef = branch?.ok ? rawRefForBranch(branch.branch) : undefined;
    if (child === undefined || rawChild !== String(child) || closureTip === undefined || branchRef === undefined) return undefined;
    const branchTip = await resolveTip(git, branchRef);
    if (branchTip === undefined) return undefined;
    closed.push({ child, closureTip, branchRef, branchTip });
  }
  return closed.sort((left, right) => left.child - right.child);
}

function rawRefForBranch(branch: string): RefName | undefined {
  return branch === '' ? undefined : `refs/heads/${branch}` as RefName;
}

async function mergeBase(git: GitRunner, left: CommitSha, right: CommitSha): Promise<CommitSha | undefined> {
  const result = await runGit(git, ['merge-base', left, right]);
  return result?.exitCode === 0 ? parseCommitSha(result.stdout.trim()) : undefined;
}

async function isHaltRecordOnly(git: GitRunner, commit: CommitSha, slug: string): Promise<boolean | undefined> {
  const changed = await runGit(git, ['diff-tree', '--no-commit-id', '--name-only', '-r', commit]);
  if (changed?.exitCode !== 0) return undefined;
  const paths = changed.stdout.split('\n').filter(Boolean);
  return paths.length > 0 && paths.every((path) => path === `.docs/halted/${slug}.md`);
}

async function hasOnlyHaltRecordsPastClosure(
  git: GitRunner,
  closureTip: CommitSha,
  branchTip: CommitSha,
  slug: string,
): Promise<boolean | undefined> {
  const commits = await runGit(git, ['rev-list', `${closureTip}..${branchTip}`]);
  if (commits?.exitCode !== 0) return undefined;
  for (const rawCommit of commits.stdout.split('\n').filter(Boolean)) {
    const commit = parseCommitSha(rawCommit);
    if (commit === undefined) return undefined;
    const haltOnly = await isHaltRecordOnly(git, commit, slug);
    if (haltOnly === undefined) return undefined;
    if (!haltOnly) return false;
  }
  return true;
}

async function leafIsInsideRange(git: GitRunner, leafTip: CommitSha, range: ChildRange): Promise<boolean | undefined> {
  // `oldParent..oldTip` excludes the parent itself. A leaf still pointing at
  // that parent has no carried child commit to rewrite and must remain out.
  if (leafTip === range.oldParent) return false;
  const afterParent = await isAncestor(git, range.oldParent, leafTip);
  if (afterParent !== true) return afterParent;
  return isAncestor(git, leafTip, range.oldTip);
}

/**
 * Compute the immutable, pre-journal ranges for the currently existing stack.
 * This function is deliberately read-only: all journal creation and ref moves
 * happen only after the caller receives a `planned` result.
 */
export async function planRestackRanges(
  worktree: string,
  options: RestackPlanOptions,
  dependencies: RestackPlanDependencies = {},
): Promise<RestackPlanResult> {
  const git = dependencies.git ?? makeGitRunner(worktree);
  const closed = await readClosedChildren(git, options.slug);
  if (closed === undefined) return { kind: 'unavailable', detail: 'cannot read closed child refs' };

  for (const entry of closed) {
    const containsClosure = await isAncestor(git, entry.closureTip, entry.branchTip);
    if (containsClosure === false) return { kind: 'refused', reason: 'closed-child-rewritten', child: entry.child };
    if (containsClosure === undefined) return { kind: 'unavailable', detail: `cannot inspect closed child ${entry.child}` };
  }

  const activeExists = await refExists(git, options.active.branchRef);
  if (activeExists === undefined) return { kind: 'unavailable', detail: `cannot inspect active child ${options.active.child}` };
  const activeTip = activeExists ? await resolveTip(git, options.active.branchRef) : undefined;
  if (activeExists && activeTip === undefined) return { kind: 'unavailable', detail: `cannot resolve active child ${options.active.child}` };

  const originating = options.cause === 'feature-repair'
    ? closed.filter((entry) => entry.branchTip !== entry.closureTip).map((entry) => entry.child)
    : [];

  for (const entry of closed) {
    if (originating.includes(entry.child)) continue;
    if (entry.branchTip === entry.closureTip) continue;
    const haltOnly = await hasOnlyHaltRecordsPastClosure(git, entry.closureTip, entry.branchTip, options.slug);
    if (haltOnly === undefined) return { kind: 'unavailable', detail: `cannot inspect commits after closed child ${entry.child}` };
    if (!haltOnly) return { kind: 'repair-pending', child: entry.child };
  }

  const closureByChild = new Map(closed.map((entry) => [entry.child, entry.closureTip]));
  const ranges: ChildRange[] = [];
  for (const [index, entry] of closed.entries()) {
    const oldParent = index === 0
      ? await mergeBase(git, entry.branchTip, options.oldDefaultTip)
      : closed[index - 1].closureTip;
    if (oldParent === undefined) return { kind: 'unavailable', detail: `cannot resolve old parent for child ${entry.child}` };
    const oldTip = originating.includes(entry.child) ? entry.branchTip : entry.closureTip;
    const validRange = await isAncestor(git, oldParent, oldTip);
    if (validRange === false) return { kind: 'refused', reason: 'range-not-ancestor', child: entry.child };
    if (validRange === undefined) return { kind: 'unavailable', detail: `cannot inspect range for child ${entry.child}` };
    ranges.push({ child: entry.child, oldParent, oldTip, kind: 'closed' });
  }

  if (activeTip !== undefined && !closureByChild.has(options.active.child)) {
    const parent = closed.filter((entry) => entry.child < options.active.child).at(-1)?.closureTip;
    const oldParent = parent ?? await mergeBase(git, activeTip, options.oldDefaultTip);
    if (oldParent === undefined) return { kind: 'unavailable', detail: `cannot resolve old parent for child ${options.active.child}` };
    const validRange = await isAncestor(git, oldParent, activeTip);
    if (validRange === false) return { kind: 'refused', reason: 'range-not-ancestor', child: options.active.child };
    if (validRange === undefined) return { kind: 'unavailable', detail: `cannot inspect range for child ${options.active.child}` };
    ranges.push({
      child: options.active.child,
      oldParent,
      oldTip: activeTip,
      kind: options.active.isLeaf ? 'leaf-active' : 'active',
    });
  }

  if (!options.active.isLeaf && options.unenteredLeaf !== undefined) {
    const leafExists = await refExists(git, options.unenteredLeaf.branchRef);
    if (leafExists === undefined) return { kind: 'unavailable', detail: `cannot inspect unentered leaf ${options.unenteredLeaf.child}` };
    const leafTip = leafExists ? await resolveTip(git, options.unenteredLeaf.branchRef) : undefined;
    if (leafExists && leafTip === undefined) return { kind: 'unavailable', detail: `cannot resolve unentered leaf ${options.unenteredLeaf.child}` };
    if (leafTip !== undefined) {
      for (const range of ranges) {
        const inside = await leafIsInsideRange(git, leafTip, range);
        if (inside === undefined) return { kind: 'unavailable', detail: `cannot inspect unentered leaf ${options.unenteredLeaf.child}` };
        if (inside) {
          ranges.push({ child: options.unenteredLeaf.child, oldParent: leafTip, oldTip: leafTip, kind: 'leaf-unentered' });
          break;
        }
      }
    }
  }

  return { kind: 'planned', ranges, originating };
}
