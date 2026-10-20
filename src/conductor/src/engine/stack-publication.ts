import { parseChildId, type ChildId } from './child-context.js';
import { childBranchFor } from './feature-branch-identity.js';
import type { ActiveChildResolution } from './child-cursor.js';
import { makeGitRunner, type GitRunner } from './rebase.js';
import {
  activePublicationRecord,
  writePublicationRecord,
  type PublicationRecordDependencies,
  type StoredPublicationRecord,
} from './stack-publication-record.js';
import { runTrackerRepositoryRead, type GhRunner } from './tracker-client.js';
import type { PublicationMember, PublicationRecord } from './stack-publication-record.js';
export { validateStackPayload, type StackPayloadValidation } from './stack-publication-payload-validation.js';
import { executeRemoteGit, type RemoteGitOperationDependencies } from './remote-git-operations.js';
import { pushedTipIntentRef, pushedTipRef, recordPushedTip, type PushLeaseGitRunner } from './push-lease.js';
import { writeHaltMarker } from './halt-marker.js';
import type { ConductorEvent } from '../types/events.js';

/**
 * A publication record with members freezes the local stack.  This deliberately
 * reads the durable record rather than child state: a feature can have durable
 * children long before it is published, while a torn-down record is no longer
 * an active publication and must not block its normal cleanup paths.
 */
export async function publishedStackRefusal(
  root: string,
  slug: string,
  dependencies: PublicationRecordDependencies = {},
): Promise<boolean> {
  const publication = await activePublicationRecord(root, slug, dependencies);
  return publication !== undefined && publication.record.members.length > 0;
}

/**
 * The post-ship proof for a published stack.  A shipped record remains the
 * ship/reap gate; this proof is deliberately narrower and protects only later
 * child-branch cleanup.  GitHub's merge commit is the squash commit in this
 * repository, so requiring it to be an ancestor of origin/main proves that
 * every reviewed member reached the shipped tree.
 */
export type MemberReachabilityResult =
  | { readonly kind: 'reachable' }
  | { readonly kind: 'unreachable'; readonly member: PublicationMember }
  | { readonly kind: 'indeterminate' };

export interface MemberReachabilityDependencies {
  readonly git?: GitRunner;
  readonly gh?: GhRunner;
  /** Canonical owner/repository name used for member-number GitHub reads. */
  readonly repository?: string;
}

type MemberMergeObservation = { readonly state?: unknown; readonly mergeCommit?: { readonly oid?: unknown } };

/**
 * Prove every recorded member is merged and its GitHub merge commit is on
 * origin/main.  A malformed or unavailable observation never becomes an
 * unreachable verdict: callers retry it without deleting any child state.
 */
export async function verifyMemberReachability(
  root: string,
  record: PublicationRecord,
  dependencies: MemberReachabilityDependencies = {},
): Promise<MemberReachabilityResult> {
  const gh = dependencies.gh;
  const repository = dependencies.repository;
  if (!gh || !repository) return { kind: 'indeterminate' };
  const git = dependencies.git ?? makeGitRunner(root);

  for (const member of record.members) {
    let observation: MemberMergeObservation;
    try {
      const stdout = await runTrackerRepositoryRead(
        gh, root, 'pull-request.read', repository, { kind: 'pull-request', number: member.pr },
        ['pr', 'view', String(member.pr), '-R', repository, '--json', 'state,mergeCommit'],
      );
      const parsed: unknown = JSON.parse(stdout);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { kind: 'indeterminate' };
      observation = parsed as MemberMergeObservation;
    } catch {
      return { kind: 'indeterminate' };
    }

    if (observation.state !== 'OPEN' && observation.state !== 'CLOSED' && observation.state !== 'MERGED') {
      return { kind: 'indeterminate' };
    }
    if (observation.state !== 'MERGED') return { kind: 'unreachable', member };
    const mergeCommit = observation.mergeCommit?.oid;
    if (typeof mergeCommit !== 'string' || mergeCommit.length === 0) return { kind: 'indeterminate' };

    try {
      const ancestry = await git(['merge-base', '--is-ancestor', mergeCommit, 'origin/main']);
      if (ancestry.exitCode === 1) return { kind: 'unreachable', member };
      if (ancestry.exitCode !== 0) return { kind: 'indeterminate' };
    } catch {
      return { kind: 'indeterminate' };
    }
  }

  return { kind: 'reachable' };
}

/**
 * Persist the receipt after its unreachable-member event was emitted.  The
 * event precedes this CAS, so an interrupted sweep is at-least-once; later
 * successful sweeps suppress duplicate reports from the durable receipt.
 */
export async function recordUnreachableMemberReport(
  root: string,
  publication: StoredPublicationRecord,
  dependencies: PublicationRecordDependencies = {},
): Promise<'recorded' | 'already-reported' | 'not-recorded'> {
  if (publication.record.unreachableReported === true) return 'already-reported';
  const write = await writePublicationRecord(root, publication.slug, publication, {
    ...publication.record,
    unreachableReported: true,
    tornDown: true,
  }, dependencies);
  return write.kind === 'updated' ? 'recorded' : 'not-recorded';
}

/** A stack operation payload is never trusted merely because it passed argv decoding. */
/** Persist the operator-owned divergence stop and mirror it on the event spine. */
export async function haltStackTipDiverged(
  root: string,
  members: readonly { readonly pr: number; readonly position?: number }[],
  events?: { emit(event: Extract<ConductorEvent, { type: 'stack_tip_diverged' }>): Promise<void> },
  detail?: string,
): Promise<void> {
  const prs = members.map((member) => member.pr);
  const positions = members.flatMap((member) => member.position === undefined ? [] : [member.position]);
  const subject = positions.length > 0 ? `positions: ${positions.join(', ')}` : `PRs: ${prs.join(', ')}`;
  await writeHaltMarker(root, `${detail ?? 'published stack tip diverged'} for ${subject}\n`, 'stack-tip-diverged');
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
  /** Production FINISH persists a confirmed observation as an operator halt. */
  readonly onDiverged?: (members: readonly PublicationMember[], detail: string) => Promise<void>;
}

function hasDurableChildState(cursor: ActiveChildResolution): boolean {
  return cursor.kind === 'active' || cursor.kind === 'repair-pending';
}

export async function readSealedPositions(
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

/** The sealed closure proof includes the edge from the last child to the leaf. */
export async function verifyChildChainToLeaf(
  root: string,
  children: readonly StackPublicationChild[],
  leafBranch: string,
  dependencies: { readonly git?: GitRunner } = {},
): Promise<ChildChainVerification> {
  const interior = await verifyChildChain(root, children, dependencies);
  if (interior.kind !== 'valid') return interior;
  const last = children.at(-1);
  if (!last) return { kind: 'unreadable' };
  const git = dependencies.git ?? makeGitRunner(root);
  try {
    const contains = await git(['merge-base', '--is-ancestor', last.closure, `refs/heads/${leafBranch}`]);
    return contains.exitCode === 0 ? { kind: 'valid' } : { kind: 'broken', position: last.position };
  } catch {
    return { kind: 'unreadable' };
  }
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
 * A transport can succeed just before its pushed-tip receipt is recorded.
 * Adopt that durable intent only when the remote still names the exact
 * intended SHA; any unreadable or contested intent leaves the caller unable
 * to prove the remote's identity.
 */
async function adoptCompletedPushIntent(
  root: string,
  slug: string,
  branch: string,
  remoteTip: string | undefined,
  git: GitRunner,
): Promise<boolean> {
  if (remoteTip === undefined) return true;
  let intentObject: string | undefined;
  try {
    const intentRef = await git(['rev-parse', '--verify', '--quiet', pushedTipIntentRef(slug, branch)]);
    intentObject = intentRef.exitCode === 0 ? intentRef.stdout.trim() || undefined : undefined;
    if (intentObject === undefined) return true;
    const contents = await git(['cat-file', '-p', intentObject]);
    if (contents.exitCode !== 0) return false;
    const parsed: unknown = JSON.parse(contents.stdout);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || typeof (parsed as { new?: unknown }).new !== 'string'
      || ((parsed as { expected?: unknown }).expected !== undefined
        && typeof (parsed as { expected?: unknown }).expected !== 'string')) return false;
    const intent = parsed as { readonly new: string; readonly expected?: string };
    if (intent.new !== remoteTip) return true;
    const pushLeaseGit: PushLeaseGitRunner = async (args, input) => {
      const result = await git([...args], input === undefined ? undefined : { input });
      return { stdout: result.stdout, exitCode: result.exitCode };
    };
    return recordPushedTip({
      cwd: root,
      prepared: { slug, branch, expected: intent.expected, new: intent.new, intentObject },
      git: pushLeaseGit,
    });
  } catch {
    return false;
  }
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
  try {
    remote = await git(['ls-remote', '--heads', 'origin', destination]);
  } catch {
    return { kind: 'read-failed', position: child.position };
  }
  if (remote.exitCode !== 0) return { kind: 'read-failed', position: child.position };
  const remoteTip = lsRemoteTip(remote.stdout, destination);
  if (!await adoptCompletedPushIntent(root, slug, child.branch, remoteTip, git)) {
    return { kind: 'read-failed', position: child.position };
  }
  let recordedTip: string | undefined;
  try {
    const recorded = await git(['rev-parse', '--verify', '--quiet', pushedTipRef(slug, child.branch)]);
    recordedTip = recorded.exitCode === 0 ? recorded.stdout.trim() : undefined;
  } catch {
    return { kind: 'read-failed', position: child.position };
  }
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
      ? result.error === 'published stack tip mismatch'
        ? { kind: 'diverged', position: child.position }
        : { kind: 'read-failed', position: child.position }
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
  slug: string,
  repository: string,
  gh: GhRunner,
  members: readonly PublicationMember[],
  record: PublicationRecord,
  git: GitRunner,
  requireDraft: boolean,
): Promise<'healthy' | 'diverged' | 'indeterminate'> {
  for (const [index, member] of members.entries()) {
    if (member.lastSeen !== undefined) return 'diverged';
    try {
      const stdout = await runTrackerRepositoryRead(
        gh, root, 'pull-request.read', repository, { kind: 'pull-request', number: member.pr },
        ['pr', 'view', String(member.pr), '-R', repository, '--json', 'state,isDraft,baseRefName,headRefOid'],
      );
      const parsed: unknown = JSON.parse(stdout);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'indeterminate';
      const state = (parsed as { state?: unknown }).state;
      if (state !== 'OPEN') return state === 'CLOSED' || state === 'MERGED' ? 'diverged' : 'indeterminate';
      const isDraft = (parsed as { isDraft?: unknown }).isDraft;
      if (typeof isDraft !== 'boolean') return 'indeterminate';
      if (requireDraft && !isDraft) return 'diverged';
      const base = (parsed as { baseRefName?: unknown }).baseRefName;
      const head = (parsed as { headRefOid?: unknown }).headRefOid;
      // The first child is rooted at the journaled pre-stack base; every
      // later member is rooted at its immediate predecessor. These identity
      // checks fence every recorded draft before assembly can mutate it.
      const expectedBase = index === 0 ? record.retarget?.from : members[index - 1]!.branch;
      if (typeof head !== 'string') return 'indeterminate';
      if (expectedBase !== undefined && (typeof base !== 'string' || base !== expectedBase)) return 'diverged';
      const pushed = await git(['rev-parse', '--verify', '--quiet', pushedTipRef(slug, member.branch)]);
      if (pushed.exitCode !== 0) return 'indeterminate';
      if (pushed.stdout.trim() !== head) return 'diverged';
    } catch {
      return 'indeterminate';
    }
  }
  return 'healthy';
}

async function observeVerifiedStack(
  root: string,
  slug: string,
  repository: string,
  gh: GhRunner,
  record: PublicationRecord,
  git: GitRunner,
): Promise<'valid' | 'diverged' | 'indeterminate'> {
  try {
    const stdout = await runTrackerRepositoryRead(
      gh, root, 'repository.read', repository, { kind: 'repository' },
      ['api', `repos/${repository}/stacks?pull_request=${record.members[0]!.pr}`],
    );
    const parsed: unknown = JSON.parse(stdout);
    const stack = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!stack || typeof stack !== 'object' || Array.isArray(stack)) return 'indeterminate';
    const rawMembers = (stack as { pull_requests?: unknown; pullRequests?: unknown }).pull_requests
      ?? (stack as { pullRequests?: unknown }).pullRequests;
    if (!Array.isArray(rawMembers) || rawMembers.length !== record.members.length) return 'diverged';
    for (const [index, expected] of record.members.entries()) {
      const value = rawMembers[index];
      if (!value || typeof value !== 'object' || Array.isArray(value)) return 'indeterminate';
      const member = value as { number?: unknown; head?: { sha?: unknown }; headRefOid?: unknown; head_sha?: unknown };
      const head = typeof member.head?.sha === 'string' ? member.head.sha
        : typeof member.headRefOid === 'string' ? member.headRefOid
          : typeof member.head_sha === 'string' ? member.head_sha : undefined;
      if (member.number !== expected.pr) return 'diverged';
      if (typeof head !== 'string' || head.length === 0) return 'indeterminate';
      const pushed = await git(['rev-parse', '--verify', '--quiet', pushedTipRef(slug, expected.branch)]);
      if (pushed.exitCode !== 0) return 'indeterminate';
      if (pushed.stdout.trim() !== head) return 'diverged';
    }
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
  const members = await observeMembers(
    root, slug, repository, gh, stored.record.members, stored.record, git, stored.record.stack?.verified !== true,
  );
  if (members !== 'healthy') {
    if (members === 'diverged') await dependencies.onDiverged?.(stored.record.members, 'published stack member diverged');
    return members;
  }
  if (stored.record.stack?.verified !== true) return 'unassembled';
  const observed = await observeVerifiedStack(root, slug, repository, gh, stored.record, git);
  if (observed === 'diverged') await dependencies.onDiverged?.(stored.record.members, 'published stack membership or tip diverged');
  return observed;
}
