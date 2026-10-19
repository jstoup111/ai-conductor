import { parseChildId, type ChildId } from './child-context.js';
import type { ActiveChildResolution } from './child-cursor.js';
import { makeGitRunner, type GitRunner } from './rebase.js';
import {
  activePublicationRecord,
  type PublicationRecordDependencies,
} from './stack-publication-record.js';
import type { GhRunner } from './tracker-client.js';
import type { GithubOperationRequest } from './github-operations.js';
import type { PublicationRecord } from './stack-publication-record.js';

/** A stack operation payload is never trusted merely because it passed argv decoding. */
export type StackPayloadValidation =
  | { readonly kind: 'valid' }
  | { readonly kind: 'refused'; readonly reason: 'invalid-payload' | 'invalid-target' };

/**
 * Bind the repository-addressed GitHub stack API to the durable publication
 * record before a caller hands it to the guarded operation runner.  The owner
 * gate establishes *who* may mutate; this check establishes *what* that owner
 * may publish.
 */
export function validateStackPayload(
  record: PublicationRecord,
  request: GithubOperationRequest,
): StackPayloadValidation {
  const memberNumbers = record.members.map((member) => member.pr);
  switch (request.operation) {
    case 'stack.read': {
      const payload = request.payload;
      return payload && 'pullRequest' in payload && typeof payload.pullRequest === 'number'
        && memberNumbers.includes(payload.pullRequest)
        ? { kind: 'valid' }
        : { kind: 'refused', reason: 'invalid-payload' };
    }
    case 'stack.create': {
      const payload = request.payload;
      if (!payload || !('pullRequests' in payload) || !Array.isArray(payload.pullRequests)) {
        return { kind: 'refused', reason: 'invalid-payload' };
      }
      const requested = payload.pullRequests;
      return requested.length === memberNumbers.length
        && requested.every((number, index) => number === memberNumbers[index])
        ? { kind: 'valid' }
        : { kind: 'refused', reason: 'invalid-payload' };
    }
    case 'stack.add': {
      if (record.stack === undefined || request.target.kind !== 'stack' || request.target.number !== record.stack.number) {
        return { kind: 'refused', reason: 'invalid-target' };
      }
      const payload = request.payload;
      if (!payload || !('pullRequests' in payload) || !Array.isArray(payload.pullRequests)
        || payload.pullRequests.some((number) => !memberNumbers.includes(number))) {
        return { kind: 'refused', reason: 'invalid-payload' };
      }
      return { kind: 'valid' };
    }
    case 'pull-request.retarget': {
      const member = record.members.find((candidate) => candidate.pr === (request.target.kind === 'pull-request' ? request.target.number : undefined));
      const payload = request.payload;
      return member !== undefined && payload && 'base' in payload && typeof payload.base === 'string'
        && record.members.some((candidate) => candidate.branch === payload.base)
        ? { kind: 'valid' }
        : { kind: 'refused', reason: 'invalid-payload' };
    }
    default:
      return { kind: 'valid' };
  }
}

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
