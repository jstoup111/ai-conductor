import { parseChildId, type ChildId } from './child-context.js';
import type { ActiveChildResolution } from './child-cursor.js';
import { makeGitRunner, type GitRunner } from './rebase.js';
import {
  activePublicationRecord,
  type PublicationRecordDependencies,
} from './stack-publication-record.js';
import type { GhRunner } from './tracker-client.js';

/** The FINISH snapshot's independent view of stack publication. */
export type StackDimension =
  | 'not-applicable'
  | 'members-missing'
  | 'unassembled'
  | 'valid'
  | 'diverged'
  | 'indeterminate';

export interface ObserveStackDimensionDependencies extends PublicationRecordDependencies {
  /** Read-only GitHub transport supplied by the FINISH composition root. */
  readonly gh?: GhRunner;
  /** Canonical repository for the registered read-only PR and stack queries. */
  readonly repository?: string;
}

function hasDurableChildState(cursor: ActiveChildResolution): boolean {
  return cursor.kind === 'active' || cursor.kind === 'repair-pending';
}

async function readSealedPositions(
  slug: string,
  git: GitRunner,
): Promise<readonly ChildId[] | 'absent' | 'unreadable'> {
  try {
    const result = await git(['cat-file', '-p', `refs/conductor/${slug}/positions`]);
    if (result.exitCode === 1) return 'absent';
    if (result.exitCode !== 0) return 'unreadable';
    const parsed: unknown = JSON.parse(result.stdout);
    if (!Array.isArray(parsed)) return 'unreadable';
    const positions = parsed.map((value) => parseChildId(value));
    if (positions.some((position) => position === undefined)) return 'unreadable';
    const values = positions as ChildId[];
    if (new Set(values).size !== values.length || values.some((position, index) => index > 0 && values[index - 1]! >= position)) {
      return 'unreadable';
    }
    return values;
  } catch {
    return 'unreadable';
  }
}

function recordHasEveryPosition(
  positions: readonly ChildId[],
  members: readonly { readonly position: ChildId }[],
): boolean {
  return positions.length === members.length && positions.every((position, index) => members[index]?.position === position);
}

async function observeMembers(
  root: string,
  repository: string,
  gh: GhRunner,
  members: readonly { readonly pr: number; readonly lastSeen?: string }[],
  requireDraft: boolean,
): Promise<'healthy' | 'diverged' | 'indeterminate'> {
  for (const member of members) {
    if (member.lastSeen !== undefined) return 'diverged';
    try {
      const response = await gh(
        ['pr', 'view', String(member.pr), '-R', repository, '--json', 'state,isDraft'],
        { cwd: root },
      );
      const parsed: unknown = JSON.parse(response.stdout);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'indeterminate';
      const state = (parsed as { state?: unknown }).state;
      if (state !== 'OPEN') return state === 'CLOSED' || state === 'MERGED' ? 'diverged' : 'indeterminate';
      const isDraft = (parsed as { isDraft?: unknown }).isDraft;
      if (typeof isDraft !== 'boolean') return 'indeterminate';
      if (requireDraft && !isDraft) return 'diverged';
    } catch {
      return 'indeterminate';
    }
  }
  return 'healthy';
}

async function observeVerifiedStack(
  root: string,
  repository: string,
  gh: GhRunner,
  pullRequest: number,
): Promise<'valid' | 'indeterminate'> {
  try {
    const response = await gh(
      ['api', `repos/${repository}/stacks?pull_request=${pullRequest}`],
      { cwd: root },
    );
    JSON.parse(response.stdout);
    return 'valid';
  } catch {
    return 'indeterminate';
  }
}

/**
 * Observes only the durable stack dimension for one already-resolved FINISH
 * observation. The cursor is supplied by that observation so an N=1 feature
 * neither re-resolves child state nor adds a process call.
 */
export async function observeStackDimension(
  root: string,
  slug: string,
  cursor: ActiveChildResolution,
  dependencies: ObserveStackDimensionDependencies = {},
): Promise<StackDimension> {
  if (cursor.kind === 'no-child') return 'not-applicable';
  if (!hasDurableChildState(cursor)) return 'indeterminate';

  const git = dependencies.git ?? makeGitRunner(root);
  const positions = await readSealedPositions(slug, git);
  if (positions === 'absent' || positions.length < 2) return 'not-applicable';
  if (positions === 'unreadable') return 'indeterminate';

  const stored = await activePublicationRecord(root, slug, { git });
  if (stored === undefined || !recordHasEveryPosition(positions, stored.record.members)) return 'members-missing';

  const { gh, repository } = dependencies;
  if (gh === undefined || repository === undefined) return 'indeterminate';
  const members = await observeMembers(root, repository, gh, stored.record.members, stored.record.stack?.verified !== true);
  if (members !== 'healthy') return members;
  if (stored.record.stack?.verified !== true) return 'unassembled';
  return observeVerifiedStack(root, repository, gh, stored.record.members[0]!.pr);
}
