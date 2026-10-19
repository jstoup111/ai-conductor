import { parseChildId, type ChildId } from './child-context.js';
import { childBranchFor } from './feature-branch-identity.js';
import type { ActiveChildResolution } from './child-cursor.js';
import { makeGitRunner, type GitRunner } from './rebase.js';
import {
  activePublicationRecord,
  type PublicationRecordDependencies,
} from './stack-publication-record.js';
import type { GhRunner } from './tracker-client.js';
import type { GithubOperationRequest } from './github-operations.js';
import type { PublicationRecord } from './stack-publication-record.js';
import { executeRemoteGit, type RemoteGitOperationDependencies } from './remote-git-operations.js';
import { pushedTipRef } from './push-lease.js';
import { writeHaltMarker } from './halt-marker.js';
import type { ConductorEvent } from '../types/events.js';

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

/** Persist the operator-owned divergence stop and mirror it on the event spine. */
export async function haltStackTipDiverged(
  root: string,
  members: readonly { readonly pr: number }[],
  events?: { emit(event: Extract<ConductorEvent, { type: 'stack_tip_diverged' }>): Promise<void> },
): Promise<void> {
  const prs = members.map((member) => member.pr);
  await writeHaltMarker(root, `published stack tip diverged for PRs: ${prs.join(', ')}\n`, 'stack-tip-diverged');
  await events?.emit({ type: 'stack_tip_diverged', prs });
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

export interface StackPublicationChild {
  readonly position: ChildId;
  readonly branch: string;
  readonly closure: string;
}

/** Read only the non-leaf members that own a durable closure. */
export async function readStackPublicationChildren(
  root: string,
  slug: string,
  dependencies: { readonly git?: GitRunner } = {},
): Promise<readonly StackPublicationChild[] | 'unreadable'> {
  const git = dependencies.git ?? makeGitRunner(root);
  const positions = await readSealedPositions(slug, git);
  if (positions === 'absent' || positions === 'unreadable' || positions.length < 2) return 'unreadable';
  const children: StackPublicationChild[] = [];
  for (const position of positions.slice(0, -1)) {
    const branch = childBranchFor(slug, position);
    if (!branch.ok) return 'unreadable';
    try {
      const closure = await git(['rev-parse', '--verify', `refs/conductor/${slug}/closed/c${position}`]);
      const tip = closure.exitCode === 0 ? closure.stdout.trim() : '';
      if (tip === '') return 'unreadable';
      children.push({ position, branch: branch.branch, closure: tip });
    } catch {
      return 'unreadable';
    }
  }
  return children;
}

export type ChildChainVerification = { readonly kind: 'valid' } | { readonly kind: 'broken'; readonly position: ChildId } | { readonly kind: 'unreadable' };

/** Every later child must include the closure of its direct predecessor. */
export async function verifyChildChain(
  root: string,
  children: readonly StackPublicationChild[],
  dependencies: { readonly git?: GitRunner } = {},
): Promise<ChildChainVerification> {
  const git = dependencies.git ?? makeGitRunner(root);
  for (let index = 1; index < children.length; index += 1) {
    const predecessor = children[index - 1]!;
    const next = children[index]!;
    try {
      const contains = await git(['merge-base', '--is-ancestor', predecessor.closure, `refs/heads/${next.branch}`]);
      if (contains.exitCode !== 0) return { kind: 'broken', position: predecessor.position };
    } catch {
      return { kind: 'unreadable' };
    }
  }
  return { kind: 'valid' };
}

export type PushChildClosureResult =
  | { readonly kind: 'pushed'; readonly position: ChildId; readonly tip: string }
  | { readonly kind: 'unchanged'; readonly position: ChildId; readonly tip: string }
  | { readonly kind: 'diverged'; readonly position: ChildId }
  | { readonly kind: 'read-failed'; readonly position: ChildId };

export interface PushChildClosureDependencies {
  readonly git?: GitRunner;
  /** The canonical guarded write boundary. Required: no raw Git fallback exists. */
  readonly remote?: Omit<RemoteGitOperationDependencies, 'cwd'>;
  readonly remoteGit?: typeof executeRemoteGit;
}

function lsRemoteTip(stdout: string, ref: string): string | undefined {
  const line = stdout.split('\n').find((candidate) => candidate.endsWith(`\t${ref}`));
  return line?.split('\t', 1)[0]?.trim() || undefined;
}

/**
 * Publish one immutable child closure.  A child branch is only ever created
 * with a plain push; a pre-existing branch is accepted only when both the
 * durable pushed-tip receipt and closure agree with the remote.
 */
export async function pushChildClosure(
  root: string,
  slug: string,
  child: StackPublicationChild,
  dependencies: PushChildClosureDependencies = {},
): Promise<PushChildClosureResult> {
  const git = dependencies.git ?? makeGitRunner(root);
  const destination = `refs/heads/${child.branch}`;
  let remote: Awaited<ReturnType<GitRunner>>;
  let recorded: Awaited<ReturnType<GitRunner>>;
  try {
    [remote, recorded] = await Promise.all([
      git(['ls-remote', '--heads', 'origin', destination]),
      git(['rev-parse', '--verify', '--quiet', pushedTipRef(slug, child.branch)]),
    ]);
  } catch {
    return { kind: 'read-failed', position: child.position };
  }
  if (remote.exitCode !== 0) return { kind: 'read-failed', position: child.position };
  const remoteTip = lsRemoteTip(remote.stdout, destination);
  const recordedTip = recorded.exitCode === 0 ? recorded.stdout.trim() : undefined;
  if (remoteTip !== undefined) {
    return remoteTip === child.closure && recordedTip === child.closure
      ? { kind: 'unchanged', position: child.position, tip: child.closure }
      : { kind: 'diverged', position: child.position };
  }
  if (!dependencies.remote) return { kind: 'read-failed', position: child.position };
  const result = await (dependencies.remoteGit ?? executeRemoteGit)([
    'push', 'origin', `${child.closure}:${destination}`,
  ], { cwd: root, ...dependencies.remote });
  return result.kind === 'executed'
    ? { kind: 'pushed', position: child.position, tip: child.closure }
    : result.kind === 'failed'
      ? { kind: 'read-failed', position: child.position }
      : { kind: 'diverged', position: child.position };
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
