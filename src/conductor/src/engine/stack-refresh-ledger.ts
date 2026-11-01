import { parseChildId, type ChildId } from './child-context.js';
import { makeGitRunner, type GitRunner } from './rebase.js';
import { parseCommitSha, parseRefName, type CommitSha, type RefName } from './restack/restack-types.js';
import { parseRoundId, type RoundId } from './routing/route-types.js';
import type { RouteKind } from '../types/routing.js';

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
  readonly git?: GitRunner;
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

export function refreshLedgerRefFor(slug: string): RefName {
  const ref = parseRefName(`refs/conductor/${slug}/refresh`);
  if (!ref) throw new Error(`invalid refresh ledger ref for ${slug}`);
  return ref;
}

/** Read the durable ledger without caching its ref or content. */
export async function readRefreshLedger(
  worktree: string,
  slug: string,
  dependencies: RefreshLedgerDependencies = {},
): Promise<ReadRefreshLedgerResult> {
  const git = dependencies.git ?? makeGitRunner(worktree);
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
  const git = dependencies.git ?? makeGitRunner(worktree);
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
