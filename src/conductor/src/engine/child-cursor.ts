import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseChildId, type ChildId } from './child-context.js';
import { loadConfig } from './config.js';
import {
  COVERAGE_BINDING_COMPLETION_STATUSES,
  readCoverageBindingEnvelope,
  type CoverageBindingEnvelopeFilesystem,
} from './coverage-binding-envelope.js';
import { childBranchFor, featureSlugOf, leafBranchFor, parseFeatureBranch, parseFeatureRef } from './feature-branch-identity.js';
import { makeGitRunner, type GitRunner } from './rebase.js';
import { resolveThroughMap } from './rebase-translate.js';
import { readRepairMarker, readRevalidationQueue, readRouteRecord } from './routing/route-record-store.js';
import type { RoundId } from './routing/route-types.js';
import { routingSettingOn } from './routing/route-types.js';

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
  | { kind: 'envelope-missing' }
  | { kind: 'detached-head' }
  | { kind: 'git-error' }
  | { kind: 'divergent'; child: ChildId; check: 'closed-child-rewritten' | 'range-not-ancestor' }
  | (ActiveChildTarget & { kind: 'active' })
  | RepairPendingChildResolution;

export interface ActiveChildDependencies {
  readonly git?: GitRunner;
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
  | { kind: 'parent-missing'; parent: ChildId; branch: string }
  | { kind: 'parent-not-ancestor'; parent: ChildId; sha: string };

export interface ChildBaseDependencies {
  readonly git?: GitRunner;
}

const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

function positionsFromEnvelope(
  envelope: Awaited<ReturnType<typeof readCoverageBindingEnvelope>>,
): ChildId[] {
  if (!envelope?.sliceMembership || !COVERAGE_BINDING_COMPLETION_STATUSES.includes(envelope.status)) return [];
  return [...new Set(Object.values(envelope.sliceMembership.taskSlices))]
    .map((position) => parseChildId(position))
    .filter((position): position is ChildId => position !== undefined)
    .sort((left, right) => left - right);
}

/** Returns the terminal position declared by the completed sealed envelope. */
export async function resolveSealedLeaf(worktree: string): Promise<ChildId | undefined> {
  let envelope: Awaited<ReturnType<typeof readCoverageBindingEnvelope>>;
  try {
    envelope = await readCoverageBindingEnvelope(worktree, envelopeFilesystem);
  } catch {
    return undefined;
  }
  return positionsFromEnvelope(envelope).at(-1);
}

/** Returns the first position declared by the completed sealed envelope. */
export async function resolveSealedFirst(worktree: string): Promise<ChildId | undefined> {
  let envelope: Awaited<ReturnType<typeof readCoverageBindingEnvelope>>;
  try {
    envelope = await readCoverageBindingEnvelope(worktree, envelopeFilesystem);
  } catch {
    return undefined;
  }
  return positionsFromEnvelope(envelope).at(0);
}

type ClosedChild = { child: ChildId; tip: string };

async function runGit(git: GitRunner, args: string[]) {
  try {
    return await git(args);
  } catch {
    return undefined;
  }
}

/**
 * Whether durable child state survives for this feature, independent of the
 * current stacked-prs setting. A recreated worktree can lose
 * `.pipeline/children` while retaining the child branches and closure refs.
 */
export async function hasDurableChildState(
  worktree: string,
  slug: string,
  dependencies: ActiveChildDependencies = {},
): Promise<boolean | 'git-error'> {
  const git = dependencies.git ?? makeGitRunner(worktree);
  try {
    if ((await readdir(join(worktree, '.pipeline', 'children'))).length > 0) return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return 'git-error';
  }
  // Legacy N=1 callers and unit fixtures may intentionally have no Git
  // boundary.  Without child state on disk they cannot have durable child
  // refs, so preserve the flat path instead of making resume preflight fail.
  if (!existsSync(join(worktree, '.git'))) return false;
  const refs = await runGit(git, ['for-each-ref', '--format=%(refname)', 'refs/heads/feat']);
  if (!refs || refs.exitCode !== 0) return 'git-error';
  if (refs.stdout.split('\n').some((ref) => {
    const identity = parseFeatureRef(ref.trim());
    return identity.kind === 'child' && identity.slug === slug;
  })) return true;
  // The feature-owned conductor namespace is durable across worktree
  // recreation.  Do not restrict this probe to closure receipts: a published
  // positions/publication receipt is itself enough to keep the stack guard on.
  // Push receipts are durable stack state only for child branches.  The leaf
  // receipt is ordinary N=1 publication evidence and must retain the flat
  // FINISH path.
  const conductorRefs = await runGit(git, ['for-each-ref', '--format=%(refname)', `refs/conductor/${slug}/`]);
  if (!conductorRefs || conductorRefs.exitCode !== 0) return 'git-error';
  const prefix = `refs/conductor/${slug}/`;
  return conductorRefs.stdout.split('\n').some((line) => {
    const ref = line.trim();
    return ref.startsWith(prefix) && isStackOwnedConductorRef(ref.slice(prefix.length), slug);
  });
}

/** Stack-owned names under `refs/conductor/<slug>/`: exact refs and ref directories. */
const STACK_OWNED_CONDUCTOR_REFS = ['positions', 'publication', 'leaf-moved', 'cascades'] as const;
const STACK_OWNED_CONDUCTOR_REF_DIRS = ['closed/', 'restack/'] as const;
const STACK_PUSH_RECEIPT_DIRS = ['pushed/', 'push-intent/'] as const;

function isStackOwnedConductorRef(name: string, slug: string): boolean {
  const receiptBranch = STACK_PUSH_RECEIPT_DIRS
    .find((dir) => name.startsWith(dir));
  if (receiptBranch !== undefined) {
    const identity = parseFeatureBranch(name.slice(receiptBranch.length));
    return identity.kind === 'child' && identity.slug === slug;
  }
  return (STACK_OWNED_CONDUCTOR_REFS as readonly string[]).includes(name) ||
    STACK_OWNED_CONDUCTOR_REF_DIRS.some((dir) => name.startsWith(dir));
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
  let envelope: Awaited<ReturnType<typeof readCoverageBindingEnvelope>> | null;
  try {
    envelope = await readCoverageBindingEnvelope(worktree, envelopeFilesystem);
  } catch {
    envelope = null;
  }
  const positions = positionsFromEnvelope(envelope);
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
        if (route.kind === 'record' && route.record.hosts[child] === 'repairing' && route.record.entry?.host === child) {
          return { kind: 'routed-repair', child, sha: route.record.entry.pinnedBase };
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

  let envelope: Awaited<ReturnType<typeof readCoverageBindingEnvelope>>;
  try {
    envelope = await readCoverageBindingEnvelope(worktree, envelopeFilesystem);
  } catch {
    return artifacts ? { kind: 'envelope-missing' } : { kind: 'no-child' };
  }
  const positions = positionsFromEnvelope(envelope);
  if (positions.length === 0) return artifacts ? { kind: 'envelope-missing' } : { kind: 'no-child' };

  // A missing optional project config is today's ordinary N=1 default, not a
  // cursor failure. A malformed config is handled by configuration validation
  // before BUILD; it cannot make an existing child state disappear here.
  const config = await loadConfig(worktree);
  const eligible = config.ok && config.config.stacked_prs?.enabled === true && positions.length >= 2 &&
    envelope?.storyOwnership !== undefined;
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
          if (allUnstamped) coOrigins.push(closure.child);
          else { foreignRoundChildren.push(closure.child); foreignRounds[closure.child] = foreignStamp ?? repair.marker.roundId; }
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
