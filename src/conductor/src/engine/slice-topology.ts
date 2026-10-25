import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { resolveFeaturePlanPath, parseComplexityTier, parseStackedDeliverySignoff, splitStoryBlocks } from './artifacts.js';
import { buildStepRegistry } from './steps.js';
import { loadConfig } from './config.js';
import { parseFeatureBranch, parseFeatureRef } from './feature-branch-identity.js';
import { makeGitRunner, type GitRunner } from './rebase.js';
import { resolveMainRepoRoot } from './park-marker.js';
import { resolvePlanStoriesPath } from './plan-stories-reference.js';
import {
  customStepsInPerChildRegion,
  deriveStoryOwnership,
  evaluateStackEligibility,
  validatePlanSlices,
  type PlanSliceViolation,
  type StackEligibilityVerdict,
} from './plan-slices.js';
import { isEngineAppendedRemediationTaskId } from './remediation-append.js';

export type SliceTopologyUnavailableCause =
  | 'plan-missing'
  | 'plan-invalid'
  | 'positions-changed'
  | 'positions-ref-unreadable'
  | 'git-error';

export interface SliceTopologyMembership {
  readonly taskSlices: Readonly<Record<string, number>>;
  readonly titles: readonly string[];
}

export type SliceTopology =
  | { readonly kind: 'unsliced' }
  | {
      readonly kind: 'sliced';
      readonly positions: readonly number[];
      readonly sliceMembership: SliceTopologyMembership;
      readonly storyOwnership: Readonly<Record<string, number>>;
      readonly stackEligibility: StackEligibilityVerdict;
    }
  | {
      readonly kind: 'unavailable';
      readonly cause: SliceTopologyUnavailableCause;
      readonly planPath?: string;
      readonly storiesPath?: string;
      readonly violations?: readonly PlanSliceViolation[];
      /** Parsed task membership remains useful to retired compatibility readers even when story ownership is invalid. */
      readonly sliceMembership?: SliceTopologyMembership;
      readonly positionsRef?: string;
      readonly recordedPositions?: readonly number[];
      readonly planPositions?: readonly number[];
    };

export interface DurableChildStateDependencies {
  readonly git?: GitRunner;
}

export interface LoadSliceTopologyDependencies extends DurableChildStateDependencies {
  /** The root whose project config decides whether a new stack is eligible. */
  readonly projectRoot?: string;
  /** An explicit feature-plan path for compatibility callers with an injected plan. */
  readonly planPath?: string;
}

/**
 * Extract proposed stack positions through the sealed-topology boundary.
 * `undefined` preserves the caller's existing invalid-plan refusal path.
 */
export function slicePositionsFromPlan(planText: string): number[] | undefined {
  const parsed = validatePlanSlices(planText);
  if (parsed.kind === 'invalid') return undefined;
  return parsed.kind === 'sliced' ? parsed.slices.map((slice) => slice.position) : [];
}

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
  dependencies: DurableChildStateDependencies = {},
): Promise<boolean | 'git-error'> {
  const git = dependencies.git ?? makeGitRunner(worktree);
  try {
    if ((await readdir(join(worktree, '.pipeline', 'children'))).length > 0) return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return 'git-error';
  }
  // Legacy N=1 callers and unit fixtures may intentionally have no Git
  // boundary. Without child state on disk they cannot have durable child refs.
  if (!existsSync(join(worktree, '.git'))) return false;
  const refs = await runGit(git, ['for-each-ref', '--format=%(refname)', 'refs/heads/feat']);
  if (!refs || refs.exitCode !== 0) return 'git-error';
  if (refs.stdout.split('\n').some((ref) => {
    const identity = parseFeatureRef(ref.trim());
    return identity.kind === 'child' && identity.slug === slug;
  })) return true;
  const conductorRefs = await runGit(git, ['for-each-ref', '--format=%(refname)', `refs/conductor/${slug}/`]);
  if (!conductorRefs || conductorRefs.exitCode !== 0) return 'git-error';
  const prefix = `refs/conductor/${slug}/`;
  return conductorRefs.stdout.split('\n').some((line) => {
    const ref = line.trim();
    return ref.startsWith(prefix) && isStackOwnedConductorRef(ref.slice(prefix.length), slug);
  });
}

const STACK_OWNED_CONDUCTOR_REFS = ['positions', 'publication', 'leaf-moved', 'cascades'] as const;
const STACK_OWNED_CONDUCTOR_REF_DIRS = ['closed/', 'restack/'] as const;
const STACK_PUSH_RECEIPT_DIRS = ['pushed/', 'push-intent/'] as const;

function isStackOwnedConductorRef(name: string, slug: string): boolean {
  const receiptBranch = STACK_PUSH_RECEIPT_DIRS.find((dir) => name.startsWith(dir));
  if (receiptBranch !== undefined) {
    const identity = parseFeatureBranch(name.slice(receiptBranch.length));
    return identity.kind === 'child' && identity.slug === slug;
  }
  return (STACK_OWNED_CONDUCTOR_REFS as readonly string[]).includes(name) ||
    STACK_OWNED_CONDUCTOR_REF_DIRS.some((dir) => name.startsWith(dir));
}

function unavailable(
  cause: SliceTopologyUnavailableCause,
  details: Omit<Extract<SliceTopology, { kind: 'unavailable' }>, 'kind' | 'cause'> = {},
): Extract<SliceTopology, { kind: 'unavailable' }> {
  return { kind: 'unavailable', cause, ...details };
}

function conventionalPlanPath(slug: string): string {
  return `.docs/plans/${slug}.md`;
}

function repoPath(worktree: string, absolutePath: string): string {
  return relative(worktree, absolutePath).replaceAll('\\', '/');
}

function parseRecordedPositions(value: string): number[] | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.every((position) => Number.isSafeInteger(position) && position > 0)) return undefined;
    const positions = [...new Set(parsed)].sort((left, right) => left - right);
    return positions.length === parsed.length ? positions : undefined;
  } catch {
    return undefined;
  }
}

export async function verifySlicePositions(
  worktree: string,
  slug: string,
  positions: readonly number[],
  git: GitRunner,
  planPath?: string,
): Promise<Extract<SliceTopology, { kind: 'unavailable' }> | undefined> {
  const durable = await hasDurableChildState(worktree, slug, { git });
  if (durable === 'git-error') return unavailable('git-error', { planPath });
  if (!durable) return undefined;

  const positionsRef = `refs/conductor/${slug}/positions`;
  const planPositions = [...positions].sort((left, right) => left - right);
  const recorded = await runGit(git, ['cat-file', '-p', positionsRef]);
  if (!recorded) return unavailable('git-error', { planPath, positionsRef });
  const recordedPositions = recorded.exitCode === 0 ? parseRecordedPositions(recorded.stdout) : undefined;
  if (recorded.exitCode !== 0 || recordedPositions === undefined) {
    return unavailable('positions-ref-unreadable', { positionsRef, planPath, planPositions });
  }
  if (recordedPositions.length !== planPositions.length || recordedPositions.some((position, index) => position !== planPositions[index])) {
    return unavailable('positions-changed', { recordedPositions, planPositions, planPath });
  }
  return undefined;
}

/** Derive one feature's stack topology from its sealed plan and stories artifacts. */
export async function loadSliceTopology(
  worktree: string,
  slug: string,
  dependencies: LoadSliceTopologyDependencies = {},
): Promise<SliceTopology> {
  const git = dependencies.git ?? makeGitRunner(worktree);
  const planPath = dependencies.planPath ?? await resolveFeaturePlanPath(worktree, slug);
  if (!planPath) return unavailable('plan-missing', { planPath: conventionalPlanPath(slug) });

  const planRepoPath = repoPath(worktree, planPath);
  let planText: string;
  try {
    planText = await readFile(planPath, 'utf8');
  } catch {
    return unavailable('plan-missing', { planPath: planRepoPath });
  }

  const validation = validatePlanSlices(planText);
  if (validation.kind === 'invalid') return unavailable('plan-invalid', { planPath: planRepoPath, violations: validation.violations });

  const positions = validation.kind === 'sliced' ? validation.slices.map((slice) => slice.position) : [];

  // Flat and singleton plans are cheap for ordinary consumers: the durable
  // probe returns immediately when no child state exists. Once child state
  // does exist, however, every proposed cardinality must match the sealed
  // positions ref. Otherwise an operator could flatten or shrink a stack and
  // make its child cursor appear to be an ordinary N=1 feature.
  const positionFailure = await verifySlicePositions(worktree, slug, positions, git, planRepoPath);
  if (positionFailure) return positionFailure;

  if (validation.kind === 'unsliced') return { kind: 'unsliced' };

  const membership: SliceTopologyMembership = {
    taskSlices: Object.fromEntries(validation.slices.flatMap((slice) =>
      slice.taskIds
        .filter((taskId) => !isEngineAppendedRemediationTaskId(taskId))
        .map((taskId) => [taskId, slice.position]),
    )),
    titles: validation.slices.map((slice) => slice.title),
  };
  const storiesPath = resolvePlanStoriesPath(planRepoPath, planText);
  if (storiesPath === null) {
    return unavailable('plan-invalid', {
      planPath: planRepoPath,
      violations: [{ code: 'stories-path', message: 'the plan Stories reference does not resolve to a .docs stories artifact' }],
      sliceMembership: membership,
    });
  }
  let storiesText: string;
  try {
    storiesText = await readFile(join(worktree, storiesPath), 'utf8');
  } catch {
    return unavailable('plan-invalid', {
      planPath: planRepoPath,
      storiesPath,
      violations: [{ code: 'stories-unreadable', message: `cannot read stories artifact ${storiesPath}` }],
      sliceMembership: membership,
    });
  }

  const ownership = deriveStoryOwnership(
    planText,
    validation.slices,
    new Set(splitStoryBlocks(storiesText).flatMap(({ id }) => id === undefined ? [] : [id])),
  );
  if (ownership.kind === 'invalid') return unavailable('plan-invalid', {
    planPath: planRepoPath,
    storiesPath,
    violations: ownership.violations,
    sliceMembership: membership,
  });
  const configResult = await loadConfig(dependencies.projectRoot ?? await resolveMainRepoRoot(worktree));
  const config = configResult.ok ? configResult.config : undefined;
  const complexityPath = join(worktree, '.docs', 'complexity', `${basename(planPath, '.md')}.md`);
  const complexityContent = await readFile(complexityPath, 'utf8').catch(() => null);
  const eligibility = evaluateStackEligibility({
    tier: parseComplexityTier(complexityContent),
    signoff: parseStackedDeliverySignoff(complexityContent) === 'approved' ? 'approved' : undefined,
    slicePositions: positions,
    maxSlices: config?.stacked_prs?.max_slices ?? 1,
    regionCoupledSteps: config ? customStepsInPerChildRegion(buildStepRegistry(config)) : [],
    complexityPath: repoPath(worktree, complexityPath),
  });
  const stackEligibility: StackEligibilityVerdict = config?.stacked_prs?.enabled === false
    ? { kind: 'ineligible', reasons: ['stacked_prs.enabled is false'] }
    : eligibility;
  return { kind: 'sliced', positions, sliceMembership: membership, storyOwnership: ownership.ownership, stackEligibility };
}
