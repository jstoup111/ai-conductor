import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseChildId, type ChildId } from './child-context.js';
import { loadConfig } from './config.js';
import { childBranchFor, featureSlugOf, leafBranchFor, parseFeatureBranch } from './feature-branch-identity.js';
import { makeGitRunner, type GitRunner } from './rebase.js';
import { resolveGitRef } from './routing/git-ref-resolver.js';
import { hasDurableChildState, loadSliceTopology, type SliceTopology } from './slice-topology.js';
export { hasDurableChildState } from './slice-topology.js';
import { resolveThroughMap } from './rebase-translate.js';
import { readRepairMarker, readRevalidationQueue, readRouteRecord } from './routing/route-record-store.js';
import type { RoundId } from './routing/route-types.js';
import { assertNever, routingSettingOn } from './routing/route-types.js';

type ActiveChildTarget = {
  child: ChildId;
  position: ChildId;
  isLeaf: boolean;
  branch: string;
  leafMovePending?: boolean;
  nextChild?: ChildId;
  /** Pending revalidation entries do not change the cursor kind. */
  revalidating?: { child: ChildId; generation: number };
  /** A routed host does not change the active stack range. */
  routedRepair?: { child: ChildId; roundId: RoundId };
};

export type RepairPendingChildResolution = ActiveChildTarget & {
  kind: 'repair-pending';
  repairChildren: ChildId[];
  routedRepair?: { child: ChildId; roundId: RoundId };
  coOrigins?: readonly ChildId[];
  foreignRoundChildren?: readonly ChildId[];
  foreignRounds?: Readonly<Record<number, string>>;
};

export type ActiveChildResolution =
  | { kind: 'no-child' }
  | ({ kind: 'topology-unavailable' } & Omit<Extract<SliceTopology, { kind: 'unavailable' }>, 'kind'>)
  | { kind: 'detached-head' }
  | { kind: 'git-error' }
  | { kind: 'divergent'; child: ChildId; check: 'closed-child-rewritten' | 'range-not-ancestor' }
  | (ActiveChildTarget & { kind: 'active' })
  | RepairPendingChildResolution;

export interface ActiveChildDependencies {
  readonly git?: GitRunner;
  /** Reuse the cursor's durable-state probe in its immediate topology read. */
  readonly reuseDurableChildState?: boolean;
}

/**
 * The base against which a child-local consumer must compare its inputs.
 *
 * `parent` deliberately carries the closure-ref tip rather than the current
 * parent branch tip: halt-record commits may follow closure without becoming
 * part of the child's reviewed contribution.
 */
export type ChildBaseResolution =
  | { kind: 'none' }
  | { kind: 'parent'; parent: ChildId; sha: string }
  | { kind: 'routed-repair'; child: ChildId; sha: string }
  | { kind: 'revalidation'; child: ChildId; sha: string }
  | { kind: 'revalidation-fix'; child: ChildId; sha: string }
  | { kind: 'parent-missing'; parent: ChildId; branch: string }
  | { kind: 'parent-not-ancestor'; parent: ChildId; sha: string };

export interface ChildBaseDependencies {
  readonly git?: GitRunner;
}

function positionsFromTopology(topology: SliceTopology): ChildId[] {
  if (topology.kind !== 'sliced') return [];
  return topology.positions
    .map((position) => parseChildId(position))
    .filter((position): position is ChildId => position !== undefined);
}

async function currentFeatureTopology(worktree: string): Promise<SliceTopology | undefined> {
  const git = makeGitRunner(worktree);
  const branch = await runGit(git, ['symbolic-ref', '-q', '--short', 'HEAD']);
  if (!branch || branch.exitCode !== 0) return undefined;
  const slug = featureSlugOf(parseFeatureBranch(branch.stdout.trim()));
  return slug === undefined ? undefined : loadSliceTopology(worktree, slug, { git });
}

/** Returns the terminal position declared by the sealed plan. */
export async function resolveSealedLeaf(worktree: string): Promise<ChildId | undefined> {
  return positionsFromTopology(await currentFeatureTopology(worktree) ?? { kind: 'unsliced' }).at(-1);
}

/** Returns the first position declared by the sealed plan. */
export async function resolveSealedFirst(worktree: string): Promise<ChildId | undefined> {
  return positionsFromTopology(await currentFeatureTopology(worktree) ?? { kind: 'unsliced' }).at(0);
}

type ClosedChild = { child: ChildId; tip: string };

async function runGit(git: GitRunner, args: string[]) {
  try {
    return await git(args);
  } catch {
    return undefined;
  }
}

async function closedChildren(slug: string, positions: readonly ChildId[], git: GitRunner): Promise<ClosedChild[] | 'git-error'> {
  const result = await runGit(git, ['for-each-ref', '--format=%(refname) %(objectname)', `refs/conductor/${slug}/closed/`]);
  if (!result || result.exitCode !== 0) return 'git-error';
  const prefix = `refs/conductor/${slug}/closed/c`;
  const declared = new Set(positions);
  return result.stdout.split('\n').flatMap((line) => {
    const [ref, tip] = line.trim().split(/\s+/, 2);
    const rawChild = ref?.startsWith(prefix) ? ref.slice(prefix.length) : undefined;
    const child = rawChild === undefined ? undefined : parseChildId(rawChild);
    // `c01` is not the canonical ref for child 1 and must not close it.
    return child !== undefined && rawChild === String(child) && declared.has(child) && tip ? [{ child, tip }] : [];
  });
}

async function readRewriteMap(worktree: string): Promise<{ map: Record<string, string>; present: boolean } | 'git-error'> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(worktree, '.pipeline', 'rebase-rewrites.json'), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
      !Object.values(parsed).every((value) => typeof value === 'string')) return 'git-error';
    return { map: parsed as Record<string, string>, present: true };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { map: {}, present: false } : 'git-error';
  }
}

async function hasLeafMovedMarker(slug: string, git: GitRunner): Promise<boolean | 'git-error'> {
  const marker = await runGit(git, ['show-ref', '--verify', '--quiet', `refs/conductor/${slug}/leaf-moved`]);
  if (!marker || (marker.exitCode !== 0 && marker.exitCode !== 1)) return 'git-error';
  return marker.exitCode === 0;
}

async function writeLeafMovedMarker(slug: string, git: GitRunner): Promise<boolean> {
  const leaf = await runGit(git, ['rev-parse', '--verify', `refs/heads/${leafBranchFor(slug)}`]);
  if (!leaf || leaf.exitCode !== 0 || !leaf.stdout.trim()) return false;
  const written = await runGit(git, ['update-ref', `refs/conductor/${slug}/leaf-moved`, leaf.stdout.trim()]);
  return written?.exitCode === 0;
}

/**
 * Produces the local comparison base for a child region. This intentionally
 * reads only local refs: child branches and their closure refs are daemon
 * state, never a remote-discovery concern.
 */
export async function resolveChildBase(
  worktree: string,
  slug: string,
  child?: ChildId,
  dependencies: ChildBaseDependencies = {},
): Promise<ChildBaseResolution> {
  if (child === undefined) return { kind: 'none' };

  const git = dependencies.git ?? makeGitRunner(worktree);
  const topology = await loadSliceTopology(worktree, slug, { git });
  const positions = positionsFromTopology(topology);
  const index = positions.indexOf(child);

  // A routed host's record freezes the repair comparison before any branch
  // mutation. Consult routing only for an eligible stacked feature, so an N=1
  // or non-routed child retains the existing no-routing-ref path.
  if (positions.length > 1) {
    const config = await loadConfig(worktree);
    if (routingSettingOn(config.ok ? config.config : undefined)) {
      const marker = await readRepairMarker(worktree, slug, { git });
      if (marker.kind === 'marker' && marker.marker.host === child) {
        const route = await readRouteRecord(worktree, slug, marker.marker.roundId, { git });
        if (route.kind === 'record') {
          const routedBase = await (async (): Promise<ChildBaseResolution | undefined> => {
            switch (route.record.kind) {
              case 'revalidate': {
                const queue = await readRevalidationQueue(worktree, slug, { git });
                const entry = queue.kind === 'queue' ? queue.queue.entries.find((candidate) => candidate.child === child) : undefined;
                const head = await resolveGitRef(git, 'HEAD');
                if (entry !== undefined && head === entry.closureSha) return { kind: 'revalidation', child, sha: entry.replay.newParent };
                if (route.record.entry?.host === child && route.record.hosts[child] === 'repairing') return { kind: 'revalidation-fix', child, sha: route.record.entry.pinnedBase };
                return entry === undefined ? undefined : { kind: 'revalidation', child, sha: entry.replay.newParent };
              }
              case 'audit':
              case 'operator':
                return route.record.hosts[child] === 'repairing' && route.record.entry?.host === child
                  ? { kind: 'routed-repair', child, sha: route.record.entry.pinnedBase }
                  : undefined;
            }
            return assertNever(route.record.kind);
          })();
          if (routedBase !== undefined) return routedBase;
        }
      }
    }
  }

  // A position is first according to the sealed slice order, not its numeric
  // spelling (a valid manifest may use a gap such as positions 1 and 3).
  if (index === 0 || (positions.length === 0 && child === 1)) return { kind: 'none' };

  // An absent or malformed envelope cannot establish a declared predecessor.
  // Preserve the typed, fail-closed surface rather than guessing a diff base.
  const parent = index > 0 ? positions[index - 1] : parseChildId(child - 1);
  if (parent === undefined) return { kind: 'none' };
  const branchResult = childBranchFor(slug, parent);
  if (!branchResult.ok) {
    return { kind: 'parent-missing', parent, branch: `feat/c${parent}/${slug}` };
  }
  const branch = branchResult.branch;

  const closureRef = `refs/conductor/${slug}/closed/c${parent}`;
  const closure = await runGit(git, ['rev-parse', '--verify', closureRef]);
  if (!closure || closure.exitCode !== 0 || !closure.stdout.trim()) {
    return { kind: 'parent-missing', parent, branch };
  }

  const branchExists = await runGit(git, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
  if (!branchExists || branchExists.exitCode !== 0) {
    return { kind: 'parent-missing', parent, branch };
  }

  const rewrites = await readRewriteMap(worktree);
  if (rewrites === 'git-error') {
    return { kind: 'parent-not-ancestor', parent, sha: closure.stdout.trim() };
  }
  const sha = resolveThroughMap(closure.stdout.trim(), rewrites.map);
  const ancestry = await runGit(git, ['merge-base', '--is-ancestor', sha, 'HEAD']);
  if (!ancestry || ancestry.exitCode !== 0) {
    return { kind: 'parent-not-ancestor', parent, sha };
  }

  return { kind: 'parent', parent, sha };
}

async function onlyHaltRecordChanged(git: GitRunner, sha: string, slug: string): Promise<boolean | 'git-error'> {
  const changed = await runGit(git, ['diff-tree', '--no-commit-id', '--name-only', '-r', sha]);
  if (!changed || changed.exitCode !== 0) return 'git-error';
  const paths = changed.stdout.split('\n').filter(Boolean);
  // An empty metadata commit is still an authored commit past closure.  It
  // must trigger the routed exit restack rather than disappearing through the
  // halt-record exemption's vacuous `every` result.
  return paths.length > 0 && paths.every((path) => path === `.docs/halted/${slug}.md`);
}

/** Resolves the next child and fails closed when stacked state is ambiguous or divergent. */
export async function resolveActiveChild(
  worktree: string,
  slug: string,
  dependencies: ActiveChildDependencies = {},
): Promise<ActiveChildResolution> {
  const git = dependencies.git ?? makeGitRunner(worktree);
  // Durable ref detection runs whether or not disposable metadata (child
  // directory, envelope) survives: a recreated worktree keeps its child refs
  // (ADR 2026-10-17 D1 amendment). hasDurableChildState preserves the flat path
  // for fixtures without a Git boundary.
  const artifacts = await hasDurableChildState(worktree, slug, { git });
  if (artifacts === 'git-error') return { kind: 'git-error' };

  const topology = await loadSliceTopology(worktree, slug, {
    git,
    ...(dependencies.reuseDurableChildState ? { durableChildState: artifacts } : {}),
  });
  if (topology.kind === 'unavailable') {
    const { kind: _kind, ...details } = topology;
    return artifacts ? { kind: 'topology-unavailable', ...details } : { kind: 'no-child' };
  }
  const positions = positionsFromTopology(topology);
  if (positions.length === 0) return { kind: 'no-child' };

  const config = await loadConfig(worktree);
  const eligible = topology.kind === 'sliced' && positions.length >= 2 && topology.stackEligibility.kind === 'eligible';
  if (!artifacts && !eligible) return { kind: 'no-child' };

  // Routing metadata is only consulted after durable child state established
  // a stacked feature. That preserves the N=1 no-routing-ref contract.
  const routingOn = artifacts === true && routingSettingOn(config.ok ? config.config : undefined);
  const repair = routingOn ? await readRepairMarker(worktree, slug, { git }) : { kind: 'absent' as const };
  const queue = routingOn ? await readRevalidationQueue(worktree, slug, { git }) : { kind: 'absent' as const };
  if (repair.kind === 'unreadable' || queue.kind === 'unreadable') return { kind: 'git-error' };

  const symbolic = await runGit(git, ['symbolic-ref', '-q', 'HEAD']);
  if (!symbolic || (symbolic.exitCode !== 0 && symbolic.exitCode !== 1)) return { kind: 'git-error' };
  if (symbolic.exitCode === 1) return { kind: 'detached-head' };

  const closed = await closedChildren(slug, positions, git);
  if (closed === 'git-error') return { kind: 'git-error' };
  const rewrites = await readRewriteMap(worktree);
  if (rewrites === 'git-error') return { kind: 'git-error' };
  let leafMoved = await hasLeafMovedMarker(slug, git);
  if (leafMoved === 'git-error') return { kind: 'git-error' };
  let leafMovePending = false;
  const repairChildren: ChildId[] = [];
  const coOrigins: ChildId[] = [];
  const foreignRoundChildren: ChildId[] = [];
  const foreignRounds: Record<number, string> = {};
  const carriedOperatorChildren = new Set<ChildId>();
  if (repair.kind === 'marker') {
    const route = await readRouteRecord(worktree, slug, repair.marker.roundId, { git });
    if (route.kind === 'record' && route.record.kind === 'operator' && route.record.phase === 'open') {
      for (const carried of route.record.operator!.carried) carriedOperatorChildren.add(carried.child);
    }
  }
  const lastClosed = closed.reduce<ClosedChild | undefined>((last, closure) => (
    last === undefined || positions.indexOf(closure.child) > positions.indexOf(last.child) ? closure : last
  ), undefined);
  let lastClosureRewriteOnLeaf = false;

  for (const closure of closed) {
    const branch = childBranchFor(slug, closure.child);
    if (!branch.ok) return { kind: 'git-error' };
    const branchExists = await runGit(git, ['show-ref', '--verify', '--quiet', `refs/heads/${branch.branch}`]);
    if (!branchExists || (branchExists.exitCode !== 0 && branchExists.exitCode !== 1)) return { kind: 'git-error' };
    if (branchExists.exitCode === 0) {
      const containsClosure = await runGit(git, ['merge-base', '--is-ancestor', closure.tip, `refs/heads/${branch.branch}`]);
      if (!containsClosure || (containsClosure.exitCode !== 0 && containsClosure.exitCode !== 1)) return { kind: 'git-error' };
      if (containsClosure.exitCode === 1) {
        return { kind: 'divergent', child: closure.child, check: 'closed-child-rewritten' };
      }
      const postClosure = await runGit(git, ['rev-list', `${closure.tip}..refs/heads/${branch.branch}`]);
      if (!postClosure || postClosure.exitCode !== 0) return { kind: 'git-error' };
      let needsRepair = false;
      let allUnstamped = true;
      let foreignStamp: string | undefined;
      for (const sha of postClosure.stdout.split('\n').filter(Boolean)) {
        const haltOnly = await onlyHaltRecordChanged(git, sha, slug);
        if (haltOnly === 'git-error') return { kind: 'git-error' };
        if (!haltOnly) {
          needsRepair = true;
          if (repair.kind === 'marker') {
            const message = await runGit(git, ['log', '-1', '--format=%B', sha]);
            if (!message || message.exitCode !== 0) return { kind: 'git-error' };
            const stamp = message.stdout.match(/^Round:\s*(r\d+)\s*$/m)?.[1];
            if (stamp !== undefined) { allUnstamped = false; if (closure.child !== repair.marker.host) foreignStamp = stamp; }
          }
        }
      }
      if (needsRepair) {
        repairChildren.push(closure.child);
        if (repair.kind === 'marker' && closure.child !== repair.marker.host) {
          if (allUnstamped) {
            if (carriedOperatorChildren.has(closure.child)) coOrigins.push(closure.child);
          } else {
            foreignRoundChildren.push(closure.child);
            foreignRounds[closure.child] = foreignStamp ?? repair.marker.roundId;
          }
        }
      }
    }
    const index = positions.indexOf(closure.child);
    const next = positions[index + 1];
    if (next === undefined) continue;
    const nextChildBranch = next === positions.at(-1) ? undefined : childBranchFor(slug, next);
    if (nextChildBranch && !nextChildBranch.ok) return { kind: 'git-error' };
    const nextBranch = next === positions.at(-1) ? leafBranchFor(slug) : nextChildBranch!.branch;
    if (!nextBranch) return { kind: 'git-error' };
    // The next intermediate branch is intentionally absent between closure
    // and region entry. Its creation is startChild's responsibility, so there
    // is no successor ancestry to validate until that branch exists.
    const nextExists = await runGit(git, ['show-ref', '--verify', '--quiet', `refs/heads/${nextBranch}`]);
    if (!nextExists || (nextExists.exitCode !== 0 && nextExists.exitCode !== 1)) return { kind: 'git-error' };
    if (nextExists.exitCode === 1 && next !== positions.at(-1)) continue;
    const closureImage = resolveThroughMap(closure.tip, rewrites.map);
    const ancestry = await runGit(git, ['merge-base', '--is-ancestor', closureImage, `refs/heads/${nextBranch}`]);
    if (!ancestry || (ancestry.exitCode !== 0 && ancestry.exitCode !== 1)) return { kind: 'git-error' };
    if (next === positions.at(-1) && ancestry.exitCode === 0 && lastClosed?.child === closure.child &&
      Object.hasOwn(rewrites.map, closure.tip)) lastClosureRewriteOnLeaf = true;
    if (ancestry.exitCode === 1) {
      if (next === positions.at(-1) && !leafMoved) leafMovePending = true;
      else if (next !== positions.at(-1)) return { kind: 'divergent', child: next, check: 'range-not-ancestor' };
    }
  }

  const closedSet = new Set(closed.map(({ child }) => child));
  const leaf = positions.at(-1)!;
  const child = positions.slice(0, -1).find((position) => !closedSet.has(position)) ?? leaf;
  const nextChild = positions[positions.indexOf(child) + 1];
  const isLeaf = child === leaf;
  const active = isLeaf
    ? {
      kind: 'active' as const, child, position: child, isLeaf, branch: leafBranchFor(slug),
      ...(leafMovePending || leafMoved ? { leafMovePending } : {}),
      ...(nextChild === undefined ? {} : { nextChild }),
    }
    : (() => {
      const branch = childBranchFor(slug, child);
      return branch.ok ? { kind: 'active' as const, child, position: child, isLeaf, branch: branch.branch, ...(nextChild === undefined ? {} : { nextChild }) } : undefined;
    })();
  if (active === undefined) return { kind: 'git-error' };
  const routingFields = {
    ...(repair.kind === 'marker' ? { routedRepair: { child: repair.marker.host, roundId: repair.marker.roundId } } : {}),
    ...(queue.kind === 'queue' && queue.queue.entries[0] !== undefined ? { revalidating: { child: queue.queue.entries[0].child, generation: queue.queue.generation } } : {}),
  };
  if (repairChildren.length > 0) return {
    ...active, kind: 'repair-pending', repairChildren, ...routingFields,
    ...(coOrigins.length ? { coOrigins } : {}),
    ...(foreignRoundChildren.length ? { foreignRoundChildren, foreignRounds } : {}),
  };
  if (isLeaf) {
    if (!leafMoved && !leafMovePending && lastClosureRewriteOnLeaf) {
      if (!await writeLeafMovedMarker(slug, git)) return { kind: 'git-error' };
      leafMoved = true;
    }
    return { ...active, ...(leafMovePending || leafMoved ? { leafMovePending } : {}), ...routingFields };
  }
  return { ...active, ...routingFields };
}

/**
 * Resolves a cursor for an operator command issued from a feature worktree.
 * Non-feature directories deliberately retain the N=1 command path; a
 * feature branch delegates to the cursor, which owns stacked-state refusal.
 */
export async function resolveActiveChildForCurrentFeature(
  worktree: string,
  dependencies: ActiveChildDependencies = {},
): Promise<ActiveChildResolution> {
  const git = dependencies.git ?? makeGitRunner(worktree);
  const head = await runGit(git, ['symbolic-ref', '-q', '--short', 'HEAD']);
  if (!head || head.exitCode !== 0 || !head.stdout.trim()) return { kind: 'no-child' };
  const slug = featureSlugOf(parseFeatureBranch(head.stdout.trim()));
  return slug === undefined ? { kind: 'no-child' } : resolveActiveChild(worktree, slug, { git });
}
