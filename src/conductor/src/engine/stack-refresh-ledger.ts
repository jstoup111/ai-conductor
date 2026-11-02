import { parseChildId, type ChildId } from './child-context.js';
import { makeLocalGitRunner, type LocalGitRunner } from './local-git-runner.js';
import { parseCommitSha, type CommitSha, type RefName } from './restack/restack-types.js';
import { rangePatchId } from './rewrite-map.js';
import { refreshLedgerRefFor } from './routing/routing-refs.js';
import { parseRoundId, type RoundId } from './routing/route-types.js';
import type { RouteKind } from '../types/routing.js';

export { refreshLedgerRefFor } from './routing/routing-refs.js';

const routeKinds = new Set<RouteKind>(['audit', 'revalidate', 'operator']);

export interface RefreshLedgerMember {
  readonly position: ChildId;
  readonly publishedTip: CommitSha;
  readonly recordedTip: CommitSha;
  readonly pr: number;
}

export interface RefreshLedgerRound {
  readonly roundId: RoundId;
  readonly kind: RouteKind;
  readonly host: ChildId;
  readonly marker: string;
}

export interface RefreshLedgerAboveOwed {
  readonly pr: number;
  readonly marker: string;
  readonly hostPr: number;
  readonly newTip: CommitSha;
}

/** Durable evidence of the exact tips a routed round is allowed to refresh. */
export interface RefreshLedger {
  readonly version: 1;
  readonly members: Readonly<Record<string, RefreshLedgerMember>>;
  readonly rounds: readonly RefreshLedgerRound[];
  readonly aboveOwed: readonly RefreshLedgerAboveOwed[];
  readonly posted: readonly string[];
}

export interface StoredRefreshLedger {
  readonly kind: 'ledger';
  readonly slug: string;
  readonly ref: RefName;
  readonly blob: CommitSha;
  readonly ledger: RefreshLedger;
}

export type RefreshLedgerDiagnostic =
  | 'invalid-json'
  | 'malformed-ledger'
  | 'unknown-version'
  | 'invalid-blob'
  | 'git-read-failed';

export type ReadRefreshLedgerResult =
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly ref: RefName; readonly diagnostic: RefreshLedgerDiagnostic; readonly blob?: CommitSha }
  | StoredRefreshLedger;

export interface RefreshLedgerMove {
  readonly position: ChildId;
  readonly branch: string;
  readonly pr: number;
  /** The receipt observed before this restack records its replacement tip. */
  readonly pushedTip: CommitSha;
  readonly recordedTip: CommitSha;
}

export interface RefreshLedgerMergeInput {
  readonly moves: readonly RefreshLedgerMove[];
  readonly round: RefreshLedgerRound;
}

export interface RefreshLedgerDependencies {
  readonly git?: LocalGitRunner;
}

const publishedStackRefreshAuthorization: unique symbol = Symbol('publishedStackRefreshAuthorization');

/**
 * A capability minted only by the FINISH refresh effect.  Keeping the brand
 * private prevents ordinary remote writers from opting into a history rewrite.
 */
export type PublishedStackRefreshAuthorization = {
  readonly slug: string;
  readonly [publishedStackRefreshAuthorization]: true;
};

/** Construct the narrow capability that permits FINISH to apply this ledger. */
export function authorizePublishedStackRefresh(slug: string): PublishedStackRefreshAuthorization {
  return { slug, [publishedStackRefreshAuthorization]: true };
}

export type RefreshLedgerUpdateLinesResult =
  | {
    readonly kind: 'lines';
    readonly ledger: RefreshLedger;
    /** The exact blob that the caller must retain until its transaction applies. */
    readonly blob: CommitSha;
    /** Absent only when the ledger transaction creates its ref. */
    readonly previous?: CommitSha;
    readonly lines: readonly string[];
  }
  | { readonly kind: 'unreadable'; readonly ref: RefName; readonly diagnostic: RefreshLedgerDiagnostic };

export type RefreshPendingState = 'push-pending' | 'comments-owed' | 'settled';

/** A routed round's host comment, including children rebased without own changes. */
export interface RoutedHostCommentTarget {
  readonly kind: 'host';
  readonly pr: number;
  readonly roundId: RoundId;
  readonly rebaseOnly: readonly number[];
}

/** A child above the routed host whose own patch changed during the replay. */
export interface RoutedMemberAboveCommentTarget {
  readonly kind: 'member-above';
  readonly pr: number;
  readonly hostPr: number;
  readonly newTip: CommitSha;
}

export type RoutedCommentTarget = RoutedHostCommentTarget | RoutedMemberAboveCommentTarget;

/**
 * A changed member can carry more than one routed host.  Its durable receipt
 * must retain that host rather than collapsing distinct routed explanations
 * for the same refreshed tip.
 */
export function routedMemberAboveCommentMarker(input: Pick<RoutedMemberAboveCommentTarget, 'pr' | 'hostPr' | 'newTip'>): string {
  return `<!-- conductor:routed-refresh:${input.newTip}:${input.hostPr}:${input.pr} -->`;
}

export interface RoutedCommentTargetsInput {
  readonly worktree: string;
  readonly slug: string;
  readonly baseBranch: string;
  /** Local plumbing only; comment calculation has no rebase-workflow dependency. */
  readonly git?: LocalGitRunner;
}

export type RoutedCommentTargetsResult =
  | { readonly kind: 'targets'; readonly targets: readonly RoutedCommentTarget[] }
  /** A required local Git comparison could not establish comment targets safely. */
  | { readonly kind: 'retryable' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function parseMember(value: unknown): RefreshLedgerMember | undefined {
  if (!isRecord(value)) return undefined;
  const position = parseChildId(value.position as number);
  const publishedTip = typeof value.publishedTip === 'string' ? parseCommitSha(value.publishedTip) : undefined;
  const recordedTip = typeof value.recordedTip === 'string' ? parseCommitSha(value.recordedTip) : undefined;
  if (!position || !publishedTip || !recordedTip || !positiveInteger(value.pr)) return undefined;
  return { position, publishedTip, recordedTip, pr: value.pr };
}

function parseRound(value: unknown): RefreshLedgerRound | undefined {
  if (!isRecord(value)) return undefined;
  const roundId = typeof value.roundId === 'string' ? parseRoundId(value.roundId) : undefined;
  const host = parseChildId(value.host as number);
  const kind = typeof value.kind === 'string' && routeKinds.has(value.kind as RouteKind) ? value.kind as RouteKind : undefined;
  if (!roundId || !host || !kind || !nonEmptyString(value.marker)) return undefined;
  return { roundId, kind, host, marker: value.marker };
}

function parseAboveOwed(value: unknown): RefreshLedgerAboveOwed | undefined {
  if (!isRecord(value) || !positiveInteger(value.pr) || !positiveInteger(value.hostPr) || !nonEmptyString(value.marker)) return undefined;
  const newTip = typeof value.newTip === 'string' ? parseCommitSha(value.newTip) : undefined;
  return newTip ? { pr: value.pr, marker: value.marker, hostPr: value.hostPr, newTip } : undefined;
}

/** Parse only ledger data whose future replay is safe to trust. */
export function parseRefreshLedger(serialized: string): { readonly ledger: RefreshLedger } | { readonly diagnostic: RefreshLedgerDiagnostic } {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return { diagnostic: 'invalid-json' };
  }
  if (!isRecord(value)) return { diagnostic: 'malformed-ledger' };
  if (value.version !== 1) return { diagnostic: 'unknown-version' };
  if (!isRecord(value.members) || !Array.isArray(value.rounds) || !Array.isArray(value.aboveOwed) || !Array.isArray(value.posted)) {
    return { diagnostic: 'malformed-ledger' };
  }

  const members: Record<string, RefreshLedgerMember> = {};
  for (const [branch, rawMember] of Object.entries(value.members)) {
    const member = parseMember(rawMember);
    if (!nonEmptyString(branch) || !member) return { diagnostic: 'malformed-ledger' };
    members[branch] = member;
  }
  const rounds = value.rounds.map(parseRound);
  const aboveOwed = value.aboveOwed.map(parseAboveOwed);
  if (rounds.some((round) => round === undefined) || aboveOwed.some((entry) => entry === undefined)
    || !value.posted.every(nonEmptyString)) return { diagnostic: 'malformed-ledger' };
  const markers = [...rounds.map((round) => round!.marker), ...aboveOwed.map((entry) => entry!.marker)];
  if (new Set(rounds.map((round) => round!.roundId)).size !== rounds.length
    || new Set(markers).size !== markers.length
    || new Set(value.posted).size !== value.posted.length
    || value.posted.some((marker) => !markers.includes(marker))) return { diagnostic: 'malformed-ledger' };
  return {
    ledger: {
      version: 1,
      members,
      rounds: rounds as RefreshLedgerRound[],
      aboveOwed: aboveOwed as RefreshLedgerAboveOwed[],
      posted: [...value.posted],
    },
  };
}

/** Read the durable ledger without caching its ref or content. */
export async function readRefreshLedger(
  worktree: string,
  slug: string,
  dependencies: RefreshLedgerDependencies = {},
): Promise<ReadRefreshLedgerResult> {
  const git = dependencies.git ?? makeLocalGitRunner(worktree);
  const ref = refreshLedgerRefFor(slug);
  try {
    const resolved = await git(['rev-parse', '-q', '--verify', ref]);
    if (resolved.exitCode === 1) return { kind: 'absent' };
    const blob = resolved.exitCode === 0 ? parseCommitSha(resolved.stdout.trim()) : undefined;
    if (!blob) return { kind: 'unreadable', ref, diagnostic: 'invalid-blob' };
    const content = await git(['cat-file', '-p', blob]);
    if (content.exitCode !== 0) return { kind: 'unreadable', ref, blob, diagnostic: 'git-read-failed' };
    const parsed = parseRefreshLedger(content.stdout);
    return 'ledger' in parsed
      ? { kind: 'ledger', slug, ref, blob, ledger: parsed.ledger }
      : { kind: 'unreadable', ref, blob, diagnostic: parsed.diagnostic };
  } catch {
    return { kind: 'unreadable', ref, diagnostic: 'git-read-failed' };
  }
}

/**
 * Retain the previous published tip until FINISH records a new receipt. This
 * makes repeated routed rounds compare their combined rewrite to the last
 * published diff, rather than only their most recent replay.
 */
export function mergeRefreshLedger(previous: RefreshLedger | undefined, input: RefreshLedgerMergeInput): RefreshLedger {
  const members: Record<string, RefreshLedgerMember> = { ...(previous?.members ?? {}) };
  for (const move of input.moves) {
    const prior = members[move.branch];
    members[move.branch] = {
      position: move.position,
      pr: move.pr,
      publishedTip: prior === undefined || prior.recordedTip === move.pushedTip ? move.pushedTip : prior.publishedTip,
      recordedTip: move.recordedTip,
    };
  }
  const rounds = previous?.rounds ?? [];
  const withoutRound = rounds.filter((round) => round.roundId !== input.round.roundId);
  return {
    version: 1,
    members,
    rounds: [...withoutRound, input.round],
    aboveOwed: previous?.aboveOwed ?? [],
    posted: previous?.posted ?? [],
  };
}

/** Build the CAS line later journaled with the restack's applied transaction. */
export async function refreshLedgerUpdateLines(
  worktree: string,
  slug: string,
  input: RefreshLedgerMergeInput,
  dependencies: RefreshLedgerDependencies = {},
): Promise<RefreshLedgerUpdateLinesResult> {
  const git = dependencies.git ?? makeLocalGitRunner(worktree);
  const current = await readRefreshLedger(worktree, slug, { git });
  const ref = refreshLedgerRefFor(slug);
  if (current.kind === 'unreadable') return current;
  const ledger = mergeRefreshLedger(current.kind === 'ledger' ? current.ledger : undefined, input);
  const hashed = await git(['hash-object', '-w', '--stdin'], { input: JSON.stringify(ledger) });
  const blob = hashed.exitCode === 0 ? parseCommitSha(hashed.stdout.trim()) : undefined;
  if (!blob) return { kind: 'unreadable', ref, diagnostic: 'git-read-failed' };
  return {
    kind: 'lines',
    ledger,
    blob,
    ...(current.kind === 'ledger' ? { previous: current.blob } : {}),
    lines: [current.kind === 'ledger'
      ? `update ${ref} ${blob} ${current.blob}`
      : `create ${ref} ${blob}`],
  };
}

/** The state of a readable ledger once its current pushed receipts are known. */
export function refreshPendingState(
  ledger: RefreshLedger,
  pushedTips: Readonly<Record<string, CommitSha | undefined>>,
): RefreshPendingState {
  if (Object.entries(ledger.members).some(([branch, member]) => pushedTips[branch] !== member.recordedTip)) return 'push-pending';
  const posted = new Set(ledger.posted);
  return ledger.rounds.some((round) => !posted.has(round.marker)) || ledger.aboveOwed.some((entry) => !posted.has(entry.marker))
    ? 'comments-owed'
    : 'settled';
}

/**
 * Select the comments owed by routed rounds without confusing a clean replay
 * (new commit ids, same own diff) with a child's changed resolution.  Every
 * comparison is all-or-nothing: a failed Git operation returns retryable and
 * exposes no partial target list that a caller could post.
 */
export async function routedCommentTargets(input: RoutedCommentTargetsInput): Promise<RoutedCommentTargetsResult> {
  const git = input.git ?? makeLocalGitRunner(input.worktree);

  try {
    const stored = await readRefreshLedger(input.worktree, input.slug, { git });
    if (stored.kind !== 'ledger') return { kind: 'retryable' };
    const members = Object.entries(stored.ledger.members)
      .map(([branch, member]) => ({ branch, ...member }))
      .sort((left, right) => left.position - right.position);
    const hostTargets: RoutedHostCommentTarget[] = [];
    const discoveredAboveTargets: RoutedMemberAboveCommentTarget[] = [];
    for (const round of stored.ledger.rounds) {
      const hostIndex = members.findIndex((member) => member.position === round.host);
      if (hostIndex < 0) return { kind: 'retryable' };
      const host = members[hostIndex]!;
      // A retained round alone does not make a comment owed: its host must
      // have a new published-stack receipt to describe.
      if (host.publishedTip === host.recordedTip) continue;
      const rebaseOnly: number[] = [];
      const memberTargets: RoutedMemberAboveCommentTarget[] = [];

      for (const [memberIndex, member] of members.slice(hostIndex + 1).entries()) {
        // A child whose receipt has not moved was not replayed by this refresh.
        if (member.publishedTip === member.recordedTip) continue;
        const parent = member.position === 1
          ? undefined
          : members[hostIndex + memberIndex];
        if (member.position !== 1 && parent === undefined) throw new Error(`missing parent for stack position ${member.position}`);
        const [oldParent, newParent] = member.position === 1
          ? await Promise.all([
            mergeBase(git, input.baseBranch, member.publishedTip),
            mergeBase(git, input.baseBranch, member.recordedTip),
          ])
          : [parent!.publishedTip, parent!.recordedTip];
        const [publishedPatch, recordedPatch] = await Promise.all([
          rangePatchId(git, oldParent, member.publishedTip),
          rangePatchId(git, newParent, member.recordedTip),
        ]);
        if (publishedPatch === recordedPatch) {
          rebaseOnly.push(member.pr);
        } else {
          memberTargets.push({ kind: 'member-above', pr: member.pr, hostPr: host.pr, newTip: member.recordedTip });
        }
      }

      hostTargets.push({ kind: 'host', pr: host.pr, roundId: round.roundId, rebaseOnly });
      discoveredAboveTargets.push(...memberTargets);
    }
    const owedMarkers = new Set(stored.ledger.aboveOwed.map((entry) => entry.marker));
    const newAboveOwed = discoveredAboveTargets
      .map((target) => ({
        pr: target.pr,
        hostPr: target.hostPr,
        newTip: target.newTip,
        marker: routedMemberAboveCommentMarker(target),
      } satisfies RefreshLedgerAboveOwed))
      .filter((entry) => {
        if (owedMarkers.has(entry.marker)) return false;
        owedMarkers.add(entry.marker);
        return true;
      });
    if (newAboveOwed.length > 0 && !await appendAboveOwed(git, stored, newAboveOwed)) return { kind: 'retryable' };
    // Above-host receipts are immutable comment obligations.  A later restack
    // may change a member's recorded tip, but it must not orphan an earlier
    // receipt that was durably journaled before posting was interrupted.
    const posted = new Set(stored.ledger.posted);
    const aboveTargets = [...stored.ledger.aboveOwed, ...newAboveOwed]
      .filter((entry) => !posted.has(entry.marker))
      .map(({ pr, hostPr, newTip }) => ({ kind: 'member-above', pr, hostPr, newTip }) satisfies RoutedMemberAboveCommentTarget);
    return { kind: 'targets', targets: [...hostTargets, ...aboveTargets] };
  } catch {
    return { kind: 'retryable' };
  }
}

async function mergeBase(git: LocalGitRunner, baseBranch: string, tip: CommitSha): Promise<string> {
  const result = await git(['merge-base', baseBranch, tip]);
  const mergeBase = result.exitCode === 0 ? result.stdout.trim() : '';
  if (!mergeBase) throw new Error(`could not find merge base for ${baseBranch} and ${tip}`);
  return mergeBase;
}

/** CAS newly discovered above-host receipts so a later comment retry reuses them. */
async function appendAboveOwed(
  git: LocalGitRunner,
  stored: StoredRefreshLedger,
  entries: readonly RefreshLedgerAboveOwed[],
): Promise<boolean> {
  const updated: RefreshLedger = { ...stored.ledger, aboveOwed: [...stored.ledger.aboveOwed, ...entries] };
  const hashed = await git(['hash-object', '-w', '--stdin'], { input: JSON.stringify(updated) });
  const blob = hashed.exitCode === 0 ? parseCommitSha(hashed.stdout.trim()) : undefined;
  if (!blob) return false;
  const applied = await git(['update-ref', stored.ref, blob, stored.blob]);
  return applied.exitCode === 0;
}
