import type { StackOwnersDispatch } from '../cli.js';
import { parseChildId, type ChildId } from './child-context.js';
import { resolveCliFeatureWorktree } from './cli-operator-authority.js';
import { childBranchFor, leafBranchFor } from './feature-branch-identity.js';
import { defaultTip } from './restack/restack-executor.js';
import { planRestackRanges } from './restack/restack-plan.js';
import { parseRefName } from './restack/restack-types.js';
import { makeGitRunner, type GitRunner } from './rebase.js';
import { loadSliceTopology, type SliceTopology } from './slice-topology.js';
import { loadConfig } from './config.js';
import { routingSettingOn } from './routing/route-types.js';

export interface StackOwnersCliDependencies {
  readonly cwd?: string;
  readonly print?: (line: string) => void;
  readonly resolveWorktree?: (slug: string) => Promise<string | undefined>;
  readonly loadTopology?: (worktree: string, slug: string) => Promise<SliceTopology>;
  readonly loadConfig?: typeof loadConfig;
  readonly git?: GitRunner;
}

interface Owner {
  readonly position: number;
  readonly branch: string;
  readonly title: string;
}

function refused(print: (line: string) => void, detail: string): number {
  print(`stack owners: refused — ${detail}`);
  return 1;
}

function pathsFromOutput(output: string): string[] {
  return output.split('\n').map((path) => path.trim()).filter(Boolean);
}

function branchFor(slug: string, child: ChildId, leaf: ChildId): string | undefined {
  if (child === leaf) return leafBranchFor(slug);
  const branch = childBranchFor(slug, child);
  return branch.ok ? branch.branch : undefined;
}

/**
 * Read-only ownership evidence for an operator deciding where a manual
 * change belongs. It never opens a round, reads leases, or changes refs.
 */
export async function dispatchStackOwnersCommand(
  command: StackOwnersDispatch,
  dependencies: StackOwnersCliDependencies = {},
): Promise<number> {
  const print = dependencies.print ?? console.log;
  const worktree = await (dependencies.resolveWorktree ?? ((slug) => resolveCliFeatureWorktree(slug, { cwd: dependencies.cwd })))(command.slug);
  if (worktree === undefined) return refused(print, `feature '${command.slug}' is unavailable.`);

  const git = dependencies.git ?? makeGitRunner(worktree);
  const topology = await (dependencies.loadTopology ?? loadSliceTopology)(worktree, command.slug);
  if (topology.kind === 'unavailable') return refused(print, `sealed-plan topology is unavailable (${topology.cause}).`);
  if (topology.kind !== 'sliced' || topology.positions.length < 2) return refused(print, `feature '${command.slug}' is not stacked.`);
  const config = await (dependencies.loadConfig ?? loadConfig)(worktree);
  if (!routingSettingOn(config.ok ? config.config : undefined)) {
    return refused(print, 'routing is disabled by stacked_prs.route_whole_feature_fixes.');
  }

  const leaf = parseChildId(topology.positions.at(-1)!);
  const leafRef = leaf === undefined ? undefined : parseRefName(`refs/heads/${leafBranchFor(command.slug)}`);
  if (leaf === undefined || leafRef === undefined) return refused(print, 'cannot resolve the stack leaf.');

  let plan: Awaited<ReturnType<typeof planRestackRanges>>;
  try {
    plan = await planRestackRanges(worktree, {
      slug: command.slug,
      oldDefaultTip: await defaultTip(git),
      cause: 'base-refresh',
      active: { child: leaf, branchRef: leafRef, isLeaf: true },
    }, { git });
  } catch (error) {
    return refused(print, error instanceof Error ? error.message : String(error));
  }
  if (plan.kind === 'unavailable') return refused(print, plan.detail);
  if (plan.kind === 'repair-pending') return refused(print, `child ${plan.child} has unlanded post-closure commits.`);
  if (plan.kind === 'refused') return refused(print, `${plan.reason} for child ${plan.child}.`);

  let requestedPaths = command.paths;
  if (command.diff !== undefined) {
    const changed = await git(['diff', '--no-renames', '--name-only', command.diff]);
    if (changed.exitCode !== 0) return refused(print, `cannot inspect diff ${command.diff}.`);
    requestedPaths = pathsFromOutput(changed.stdout);
  }

  const ownersByPath = new Map<string, Owner[]>();
  for (const path of requestedPaths) ownersByPath.set(path, []);
  for (const range of plan.ranges) {
    const changed = await git(['diff', '--no-renames', '--name-only', range.oldParent, range.oldTip]);
    if (changed.exitCode !== 0) return refused(print, `cannot inspect child ${range.child} range.`);
    const branch = branchFor(command.slug, range.child, leaf);
    const title = topology.sliceMembership.titles[range.child - 1];
    if (branch === undefined || title === undefined) return refused(print, `cannot resolve child ${range.child} ownership metadata.`);
    const owner = { position: range.child, branch, title };
    for (const path of pathsFromOutput(changed.stdout)) ownersByPath.get(path)?.push(owner);
  }

  print(JSON.stringify({ paths: requestedPaths.map((path) => ({ path, children: ownersByPath.get(path) ?? [] })) }));
  return 0;
}
