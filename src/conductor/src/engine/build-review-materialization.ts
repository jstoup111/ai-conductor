import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';

import {
  buildReviewSourceViewIdentity,
  type BuildReviewSourceSnapshot,
  type BuildReviewSourceViewIdentity,
} from './build-review-inputs.js';
import type { GitRunner } from './rebase.js';

export interface BuildReviewMaterializationMember {
  readonly id: string;
  readonly kind: 'builtin' | 'custom';
}

export interface BuildReviewMaterializedSourceView {
  readonly identity: BuildReviewSourceViewIdentity;
  readonly baselinePath: string;
  readonly headPath: string;
}

export interface BuildReviewMaterializedMemberContext {
  readonly memberId: string;
  readonly source: BuildReviewMaterializedSourceView;
}

export interface BuildReviewFrozenInputScope {
  readonly contentDigest: string;
  readonly mergeBase: string;
  readonly headSha: string;
  readonly changes: readonly ({ readonly kind: string; readonly path: string; readonly oldPath?: string })[];
  readonly view?: { readonly baselinePath: string; readonly headPath: string };
}

/** Engine-authored description of the same immutable change every lap member inspects. */
export function renderBuildReviewFrozenInputScope(scope: BuildReviewFrozenInputScope): string {
  return [
    `Frozen build-review input ${scope.contentDigest}.`,
    ...(scope.view === undefined ? [] : [
      `Reviewed baseline ${scope.mergeBase} (read-only): ${scope.view.baselinePath}`,
      `Reviewed head ${scope.headSha} (read-only): ${scope.view.headPath}`,
      'Compare the two trees to inspect the change; a deleted path exists only under the baseline.',
    ]),
    'Changed path inventory (git name-status, baseline..head):',
    ...(scope.changes.length === 0 ? ['(none)'] : scope.changes.map((change) =>
      change.oldPath === undefined ? `${change.kind} ${change.path}` : `${change.kind} ${change.oldPath} -> ${change.path}`)),
  ].join('\n');
}

export interface BuildReviewLapMaterialization {
  readonly source: BuildReviewMaterializedSourceView;
  contextFor(memberId: string): BuildReviewMaterializedMemberContext;
  settle(memberId: string): Promise<void>;
}

export interface BuildReviewMaterializationOptions {
  /** Feature worktree whose immutable commits are materialized. */
  readonly projectRoot: string;
  /** Private parent for the two detached source worktrees. */
  readonly runtimeRoot?: string;
}

export class BuildReviewSourceMaterializationError extends Error {
  constructor(
    readonly kind: 'invalid-baseline' | 'unreadable-baseline' | 'invalid-head' | 'unreadable-head' | 'materialization-failed' | 'cleanup-failed',
    detail: string,
  ) {
    super(`build_review source materialization ${kind}: ${detail}`);
    this.name = 'BuildReviewSourceMaterializationError';
  }
}

const GIT_OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

function isPrivateChild(parent: string, path: string): boolean {
  const child = relative(parent, path);
  return child.length > 0 && child !== '..' && !child.startsWith('../') && !child.startsWith('..\\');
}

function defaultRuntimeRoot(projectRoot: string): string {
  // A linked worktree cannot be nested in the feature checkout itself. Keep
  // this source beside it, with a feature-specific private parent, rather
  // than placing a second worktree in the checkout or under engine evidence.
  return join(dirname(projectRoot), '.build-review-source', basename(projectRoot));
}

async function assertCommit(
  git: GitRunner,
  revision: string,
  side: 'baseline' | 'head',
): Promise<void> {
  if (!GIT_OBJECT_ID.test(revision)) {
    throw new BuildReviewSourceMaterializationError(`invalid-${side}`, `reviewed ${side} is not a full commit object id`);
  }
  const result = await git(['cat-file', '-e', `${revision}^{commit}`]);
  if (result.exitCode !== 0) {
    throw new BuildReviewSourceMaterializationError(`unreadable-${side}`, result.stderr || `reviewed ${side} commit is unavailable`);
  }
}

/**
 * Creates the one private source view required by a custom-policy lap.
 * Built-in-only laps deliberately retain their existing by-reference path.
 */
export async function materializeBuildReviewLap(
  git: GitRunner,
  snapshot: BuildReviewSourceSnapshot,
  members: readonly BuildReviewMaterializationMember[],
  options: BuildReviewMaterializationOptions,
): Promise<BuildReviewLapMaterialization | undefined> {
  if (!members.some((member) => member.kind === 'custom')) return undefined;
  const memberIds = new Set(members.map((member) => member.id));
  if (memberIds.size !== members.length || [...memberIds].some((id) => id.trim().length === 0)) {
    throw new BuildReviewSourceMaterializationError('materialization-failed', 'lap members must have distinct non-empty ids');
  }

  // Validate before creating a private directory or invoking a provider. A
  // detached worktree also validates the tree is readable, but this cheap
  // preflight provides the named baseline refusal before any side effect.
  await assertCommit(git, snapshot.mergeBase, 'baseline');
  await assertCommit(git, snapshot.headSha, 'head');

  const runtimeRoot = options.runtimeRoot ?? defaultRuntimeRoot(options.projectRoot);
  await mkdir(runtimeRoot, { recursive: true });
  const privateRoot = await mkdtemp(join(runtimeRoot, 'lap-'));
  if (!isPrivateChild(runtimeRoot, privateRoot)) {
    throw new BuildReviewSourceMaterializationError('materialization-failed', 'private source root escaped its runtime parent');
  }
  const baselinePath = join(privateRoot, 'baseline');
  const headPath = join(privateRoot, 'head');
  let baselineAdded = false;
  let headAdded = false;

  const cleanup = async (): Promise<void> => {
    let failed = false;
    for (const path of [headAdded ? headPath : undefined, baselineAdded ? baselinePath : undefined]) {
      if (!path) continue;
      const result = await git(['worktree', 'remove', '--force', path]);
      failed ||= result.exitCode !== 0;
    }
    try {
      // The only recursive removal is the mkdtemp-created private root, never
      // the feature checkout, runtime parent, or engine evidence directory.
      await rm(privateRoot, { recursive: true, force: true });
    } catch {
      failed = true;
    }
    if (failed) throw new BuildReviewSourceMaterializationError('cleanup-failed', 'could not remove private source view');
  };

  try {
    const baseline = await git(['worktree', 'add', '--detach', baselinePath, snapshot.mergeBase]);
    if (baseline.exitCode !== 0) {
      throw new BuildReviewSourceMaterializationError('unreadable-baseline', baseline.stderr || 'could not materialize reviewed baseline');
    }
    baselineAdded = true;
    const head = await git(['worktree', 'add', '--detach', headPath, snapshot.headSha]);
    if (head.exitCode !== 0) {
      throw new BuildReviewSourceMaterializationError('unreadable-head', head.stderr || 'could not materialize reviewed head');
    }
    headAdded = true;
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw cleanupError;
    }
    throw error;
  }

  const source = Object.freeze({
    identity: buildReviewSourceViewIdentity(snapshot),
    baselinePath,
    headPath,
  });
  const unsettled = new Set(memberIds);
  let cleaned = false;
  const contexts = new Map([...memberIds].map((memberId) => [memberId, Object.freeze({ memberId, source })]));
  return Object.freeze({
    source,
    contextFor(memberId: string): BuildReviewMaterializedMemberContext {
      const context = contexts.get(memberId);
      if (!context) throw new BuildReviewSourceMaterializationError('materialization-failed', `unknown lap member ${JSON.stringify(memberId)}`);
      return context;
    },
    async settle(memberId: string): Promise<void> {
      if (!memberIds.has(memberId) || !unsettled.delete(memberId) || unsettled.size !== 0 || cleaned) return;
      cleaned = true;
      await cleanup();
    },
  });
}
