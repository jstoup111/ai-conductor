import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { parseChildId, type ChildId } from './child-context.js';
import { loadConfig } from './config.js';
import {
  COVERAGE_BINDING_COMPLETION_STATUSES,
  readCoverageBindingEnvelope,
  type CoverageBindingEnvelopeFilesystem,
} from './coverage-binding-envelope.js';
import { childBranchFor, leafBranchFor } from './feature-branch-identity.js';
import { makeGitRunner, originDefaultBranch, type GitRunner } from './rebase.js';
import type { ConductorEventEmitter } from '../ui/events.js';
import { resolveActiveChild } from './child-cursor.js';

export type StartChildGitRunner = GitRunner;

export type StartChildResult =
  | { readonly kind: 'started' }
  | { readonly kind: 'refused'; readonly reason: string };

export interface StartChildDependencies {
  readonly git?: StartChildGitRunner;
}

export interface ChildLifecycleTarget {
  readonly child: ChildId;
  readonly position: ChildId;
  readonly branch: string;
}

/** The cursor-owned branch target needed to enter or advance a BUILD region. */
export interface ActiveChildLifecycleTarget extends ChildLifecycleTarget {
  readonly isLeaf: boolean;
}

export type ChildLifecycleResult =
  | StartChildResult
  | { readonly kind: 'completed' };

const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

function sealedPositions(
  envelope: Awaited<ReturnType<typeof readCoverageBindingEnvelope>>,
): ChildId[] {
  if (!envelope?.sliceMembership || !COVERAGE_BINDING_COMPLETION_STATUSES.includes(envelope.status)) {
    return [];
  }
  return [...new Set(Object.values(envelope.sliceMembership.taskSlices))]
    .map((position) => parseChildId(position))
    .filter((position): position is ChildId => position !== undefined)
    .sort((left, right) => left - right);
}

function refused(reason: string): StartChildResult {
  return { kind: 'refused', reason };
}

async function runGit(
  git: StartChildGitRunner,
  args: string[],
  input?: string,
): Promise<Awaited<ReturnType<StartChildGitRunner>> | undefined> {
  try {
    return await git(args, input === undefined ? undefined : { input });
  } catch {
    return undefined;
  }
}

/**
 * Creates the active non-leaf child's local branch from its declared parent.
 *
 * `emitter` is intentionally unused: lifecycle events are emitted only after a
 * successful checkout by switchToChild (Task 7), preserving their persisted
 * order around child closure and switching.
 */
export async function startChild(
  worktree: string,
  slug: string,
  child: ChildId,
  _emitter: ConductorEventEmitter,
  dependencies: StartChildDependencies = {},
): Promise<StartChildResult> {
  const envelope = await readCoverageBindingEnvelope(worktree, envelopeFilesystem);
  const positions = sealedPositions(envelope);
  const positionIndex = positions.indexOf(child);
  if (positionIndex === -1 || positions.length < 2) {
    return refused(`child ${child} is not a declared stacked position`);
  }

  const loaded = await loadConfig(worktree);
  if (!loaded.ok) return refused(`cannot load project config: ${loaded.error.message}`);
  const maxSlices = loaded.config.stacked_prs?.max_slices ?? 1;
  if (positions.length > maxSlices) {
    return refused(`sealed position count ${positions.length} exceeds stacked_prs.max_slices ${maxSlices}`);
  }

  const leaf = positions.at(-1)!;
  if (child === leaf) {
    await mkdir(`${worktree}/.pipeline/children/${child}`, { recursive: true });
    return { kind: 'started' };
  }

  const branch = childBranchFor(slug, child);
  if (!branch.ok) return refused(branch.reason);
  const git = dependencies.git ?? makeGitRunner(worktree);
  const namespaceRef = `refs/heads/feat/c${child}`;
  const namespace = await runGit(git, ['show-ref', '--verify', '--quiet', namespaceRef]);
  if (namespace === undefined || (namespace.exitCode !== 0 && namespace.exitCode !== 1)) {
    return refused(`cannot probe reserved child namespace ${namespaceRef}`);
  }
  if (namespace.exitCode === 0) return refused(`reserved child namespace already exists: ${namespaceRef}`);

  const sourceRef = positionIndex === 0
    ? `refs/heads/${leafBranchFor(slug)}`
    : `refs/conductor/${slug}/closed/c${positions[positionIndex - 1]}`;
  const source = await runGit(git, ['rev-parse', '--verify', sourceRef]);
  const sha = source?.stdout.trim();
  if (source === undefined || source.exitCode !== 0 || sha === '') {
    return refused(`cannot resolve declared parent ref ${sourceRef}`);
  }

  const ref = `refs/heads/${branch.branch}`;
  const created = await runGit(git, ['update-ref', ref, sha!, '']);
  if (created === undefined || created.exitCode !== 0) {
    return refused(`cannot create child branch ${ref}`);
  }

  await mkdir(`${worktree}/.pipeline/children/${child}`, { recursive: true });
  if (positionIndex !== 0) return { kind: 'started' };

  const blob = await runGit(git, ['hash-object', '-w', '--stdin'], JSON.stringify(positions));
  const blobSha = blob?.stdout.trim();
  if (blob === undefined || blob.exitCode !== 0 || blobSha === '') {
    return refused(`cannot write sealed positions for ${slug}`);
  }
  const positionsRef = `refs/conductor/${slug}/positions`;
  const recorded = await runGit(git, ['update-ref', positionsRef, blobSha!, '']);
  if (recorded === undefined || recorded.exitCode !== 0) {
    return refused(`cannot record sealed positions at ${positionsRef}`);
  }

  return { kind: 'started' };
}

/** Move the worktree between child branches without ever hiding dirty work in a stash. */
export async function switchToChild(
  worktree: string,
  target: ChildLifecycleTarget,
  emitter: ConductorEventEmitter,
  previous?: ChildLifecycleTarget,
  dependencies: StartChildDependencies = {},
): Promise<ChildLifecycleResult> {
  const git = dependencies.git ?? makeGitRunner(worktree);
  const status = await runGit(git, ['status', '--porcelain']);
  if (!status || status.exitCode !== 0) return refused('cannot inspect worktree cleanliness');
  if (status.stdout.trim() !== '') return refused(`worktree is dirty: ${status.stdout.trim().split('\n').join(', ')}`);
  const switched = await runGit(git, ['switch', target.branch]);
  if (!switched || switched.exitCode !== 0) return refused(`cannot switch to child branch ${target.branch}`);
  await rm(`${worktree}/.pipeline/current-task`, { force: true });
  if (previous && previous.child !== target.child) {
    await emitter.emit({
      type: 'child_switched', from: previous.child, to: target.child,
      position: target.position, branch: target.branch,
    });
  }
  await emitter.emit({ type: 'child_started', child: target.child, position: target.position, branch: target.branch });
  return { kind: 'completed' };
}

/**
 * Put a clean worktree on the cursor-selected child before its first region
 * dispatch.  The conductor owns cursor resolution; this helper owns the git
 * probe/create/switch sequence so that no loop-local branch logic grows in
 * conductor.ts.
 */
export async function enterChildRegion(
  worktree: string,
  slug: string,
  target: ActiveChildLifecycleTarget,
  emitter: ConductorEventEmitter,
  previous?: ChildLifecycleTarget,
  dependencies: StartChildDependencies = {},
): Promise<ChildLifecycleResult> {
  const git = dependencies.git ?? makeGitRunner(worktree);
  const exists = await runGit(git, ['show-ref', '--verify', '--quiet', `refs/heads/${target.branch}`]);
  if (!exists || (exists.exitCode !== 0 && exists.exitCode !== 1)) {
    return refused(`cannot inspect child branch ${target.branch}`);
  }
  if (exists.exitCode === 1 && !target.isLeaf) {
    const started = await startChild(worktree, slug, target.child, emitter, { git });
    if (started.kind === 'refused') return started;
  }
  // The leaf already exists, so it never goes through startChild here.
  if (exists.exitCode === 1 && target.isLeaf) {
    return refused(`cannot resolve leaf branch ${target.branch}`);
  }
  const head = await runGit(git, ['symbolic-ref', '--short', 'HEAD']);
  if (!head || head.exitCode !== 0) return refused('cannot determine current branch before child switch');
  if (head.stdout.trim() === target.branch) return { kind: 'completed' };
  return switchToChild(worktree, target, emitter, previous, { git });
}

/** Seal a non-leaf child at its current branch tip. */
export async function closeChild(
  worktree: string,
  slug: string,
  child: ChildLifecycleTarget,
  emitter: ConductorEventEmitter,
  dependencies: StartChildDependencies = {},
): Promise<ChildLifecycleResult> {
  const git = dependencies.git ?? makeGitRunner(worktree);
  const resolved = await runGit(git, ['rev-parse', '--verify', `refs/heads/${child.branch}`]);
  const tip = resolved?.stdout.trim();
  if (!resolved || resolved.exitCode !== 0 || !tip) return refused(`cannot resolve child branch ${child.branch}`);
  const ref = `refs/conductor/${slug}/closed/c${child.child}`;
  const written = await runGit(git, ['update-ref', ref, tip, '']);
  if (!written || written.exitCode !== 0) return refused(`cannot close child ${child.child} at ${ref}`);
  await emitter.emit({ type: 'child_closed', child: child.child, position: child.position, branch: child.branch, tip });
  return { kind: 'completed' };
}

/** Advance the leaf ref only when it has no commits outside the completed child. */
export async function moveLeaf(
  worktree: string,
  slug: string,
  tip: string,
  dependencies: StartChildDependencies = {},
): Promise<ChildLifecycleResult> {
  const git = dependencies.git ?? makeGitRunner(worktree);
  const branch = leafBranchFor(slug);
  const old = await runGit(git, ['rev-parse', '--verify', `refs/heads/${branch}`]);
  const oldTip = old?.stdout.trim();
  if (!old || old.exitCode !== 0 || !oldTip) return refused(`cannot resolve leaf branch ${branch}`);
  let defaultBranch: string | null;
  try {
    defaultBranch = await originDefaultBranch(git);
  } catch {
    return refused(`cannot determine origin default branch while moving leaf ${branch}`);
  }
  if (!defaultBranch) return refused(`cannot determine origin default branch while moving leaf ${branch}`);
  const stray = await runGit(git, [
    'rev-list',
    `refs/heads/${branch}`,
    `^${tip}`,
    `^origin/${defaultBranch}`,
  ]);
  if (!stray || stray.exitCode !== 0) return refused(`cannot inspect leaf branch ${branch}`);
  const strayTip = stray.stdout.split('\n').find(Boolean);
  if (strayTip) return refused(`cannot move leaf branch ${branch}; unrelated commit ${strayTip}`);
  const moved = await runGit(git, ['update-ref', `refs/heads/${branch}`, tip, oldTip]);
  if (!moved || moved.exitCode !== 0) return refused(`cannot move leaf branch ${branch}; concurrent update refused`);
  return { kind: 'completed' };
}

/**
 * Close a completed non-leaf region, prepare the cursor's next child, and
 * switch before its acceptance_specs dispatch.  The leaf is advanced only at
 * the final non-leaf boundary; intermediate children are created from their
 * predecessor's closure by enterChildRegion/startChild.
 */
export async function advanceChildRegion(
  worktree: string,
  slug: string,
  completed: ActiveChildLifecycleTarget,
  emitter: ConductorEventEmitter,
  dependencies: StartChildDependencies = {},
): Promise<ChildLifecycleResult> {
  const git = dependencies.git ?? makeGitRunner(worktree);
  const closed = await closeChild(worktree, slug, completed, emitter, { git });
  if (closed.kind === 'refused') return closed;

  const cursor = await resolveActiveChild(worktree, slug, { git });
  if (cursor.kind !== 'active') return refused(`cannot resolve next child after closing ${completed.child}: ${cursor.kind}`);
  const next: ActiveChildLifecycleTarget = cursor;

  if (next.isLeaf) {
    const tip = await runGit(git, ['rev-parse', '--verify', `refs/heads/${completed.branch}`]);
    const sha = tip?.stdout.trim();
    if (!tip || tip.exitCode !== 0 || !sha) return refused(`cannot resolve completed child branch ${completed.branch}`);
    const moved = await moveLeaf(worktree, slug, sha, { git });
    if (moved.kind === 'refused') return moved;
  }
  return enterChildRegion(worktree, slug, next, emitter, completed, { git });
}
