import { parseChildId, type ChildId } from '../child-context.js';
import { childBranchFor, leafBranchFor } from '../feature-branch-identity.js';
import { makeGitRunner, type GitRunner } from '../rebase.js';
import { isHaltRecordOnlyDescendant } from '../restack/restack-recovery.js';
import { syncRestackedWorktree } from '../restack/restack-sync.js';
import { parseCommitSha, type CommitSha } from '../restack/restack-types.js';
import { closureRefFor, rejectedPinRefFor } from './routing-refs.js';
import { readRepairMarker, readRouteRecord, transitionHost, writeRoutingTransaction, type RouteRecordStoreDependencies } from './route-record-store.js';
import { remediationReroutedEvent, withOutboxEvent } from './routing-events.js';
import { validatedReroute, type RouteRecord, type RoundId } from './route-types.js';

/**
 * Engine-owned terminal result requested from a routed BUILD provider.  It is
 * intentionally closed: a provider cannot smuggle an unrecognised outcome
 * into the movement path.
 */
const PREREQUISITE_CLAIM_CONTRACT = {
  completed: 'completed',
  blocked: 'blocked-by-prerequisite',
  optionalFields: ['paths', 'symbols'] as const,
} as const;

export const PREREQUISITE_CLAIM_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['outcome'],
      properties: { outcome: { const: PREREQUISITE_CLAIM_CONTRACT.completed } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['outcome', 'child'],
      properties: {
        outcome: { const: PREREQUISITE_CLAIM_CONTRACT.blocked },
        child: { type: 'integer', minimum: 1 },
        paths: { type: 'array', items: { type: 'string', minLength: 1 } },
        symbols: { type: 'array', items: { type: 'string', minLength: 1 } },
      },
    },
  ],
} as const;

export interface PrerequisiteClaim {
  readonly outcome: 'blocked-by-prerequisite';
  readonly child: ChildId;
  readonly paths?: readonly string[];
  readonly symbols?: readonly string[];
}

export type ParsedBuilderClaim =
  | { readonly kind: 'none' }
  | { readonly kind: 'claim'; readonly claim: PrerequisiteClaim }
  | { readonly kind: 'malformed' };

function stringList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.length === 0)) return undefined;
  return value;
}

/** Parse the provider's terminal payload without accepting partially valid claims. */
export function parseBuilderClaim(result: unknown): ParsedBuilderClaim {
  if (result === undefined || result === null) return { kind: 'none' };
  if (typeof result !== 'object' || Array.isArray(result)) return { kind: 'malformed' };
  const value = result as Record<string, unknown>;
  if (value.outcome === PREREQUISITE_CLAIM_CONTRACT.completed && Object.keys(value).length === 1) return { kind: 'none' };
  if (value.outcome !== PREREQUISITE_CLAIM_CONTRACT.blocked) return { kind: 'malformed' };
  if (!Object.keys(value).every((key) => key === 'outcome' || key === 'child' || PREREQUISITE_CLAIM_CONTRACT.optionalFields.includes(key as 'paths' | 'symbols'))) return { kind: 'malformed' };
  const child = typeof value.child === 'number' && Number.isInteger(value.child)
    ? parseChildId(value.child)
    : undefined;
  if (!child) return { kind: 'malformed' };
  const paths = value.paths === undefined ? undefined : stringList(value.paths);
  const symbols = value.symbols === undefined ? undefined : stringList(value.symbols);
  if ((value.paths !== undefined && paths === undefined) || (value.symbols !== undefined && symbols === undefined)) return { kind: 'malformed' };
  return { kind: 'claim', claim: { outcome: 'blocked-by-prerequisite', child, ...(paths === undefined ? {} : { paths }), ...(symbols === undefined ? {} : { symbols }) } };
}

export type VerifyPrerequisiteClaimResult =
  | { readonly kind: 'verified'; readonly destination: ChildId; readonly ref: string }
  | { readonly kind: 'unverified'; readonly detail: string }
  | { readonly kind: 'refused-not-above'; readonly detail: string };

export interface VerifyPrerequisiteClaimInput {
  readonly claim: PrerequisiteClaim;
  readonly host: ChildId;
  readonly slug: string;
  readonly git?: GitRunner;
  readonly worktree?: string;
  /** Inputs from the admitted work order that must exist at the destination. */
  readonly prerequisitePaths?: readonly string[];
}

async function existingRef(git: GitRunner, ref: string): Promise<boolean> {
  try { return (await git(['rev-parse', '-q', '--verify', ref])).exitCode === 0; } catch { return false; }
}

async function hasPaths(git: GitRunner, ref: string, paths: readonly string[]): Promise<boolean> {
  for (const path of paths) {
    try {
      const result = await git(['ls-tree', '-r', '--name-only', ref, '--', path]);
      if (result.exitCode !== 0 || !result.stdout.split('\n').map((line) => line.trim()).includes(path)) return false;
    } catch { return false; }
  }
  return true;
}

async function hasSymbols(git: GitRunner, ref: string, symbols: readonly string[]): Promise<boolean> {
  for (const symbol of symbols) {
    // Git performs the tree lookup, so this cannot accidentally inspect the
    // checked-out host after a reroute has changed it.
    try {
      const result = await git(['grep', '-E', `(^|[[:space:]])export([[:space:]]|.*[[:space:]])(${symbol})([[:space:](=:]|$)`, ref, '--']);
      if (result.exitCode !== 0) return false;
    } catch { return false; }
  }
  return true;
}

/**
 * Validate a requested upward destination against the immutable closed tree.
 * A missing closed ref denotes the leaf branch; no ref is moved by verification.
 */
export async function verifyPrerequisiteClaim(input: VerifyPrerequisiteClaimInput): Promise<VerifyPrerequisiteClaimResult> {
  if (input.claim.child <= input.host) {
    return { kind: 'refused-not-above', detail: `claimed child ${input.claim.child} is not above host ${input.host}` };
  }
  const git = input.git ?? makeGitRunner(input.worktree ?? process.cwd());
  const closed = `refs/conductor/${input.slug}/closed/c${input.claim.child}`;
  const ref = await existingRef(git, closed) ? closed : `refs/heads/${leafBranchFor(input.slug)}`;
  if (!await existingRef(git, ref)) return { kind: 'unverified', detail: `claimed destination ${input.claim.child} is unavailable` };
  const paths = [...(input.claim.paths ?? []), ...(input.prerequisitePaths ?? [])];
  if (!await hasPaths(git, ref, paths)) return { kind: 'unverified', detail: `claimed destination ${input.claim.child} lacks prerequisite paths` };
  if (!await hasSymbols(git, ref, input.claim.symbols ?? [])) return { kind: 'unverified', detail: `claimed destination ${input.claim.child} lacks prerequisite symbols` };
  return { kind: 'verified', destination: input.claim.child, ref };
}

export type RerouteRoundResult =
  | { readonly kind: 'rerouted'; readonly record: RouteRecord }
  | { readonly kind: 'refused'; readonly detail: string };

export interface RerouteRoundInput extends RouteRecordStoreDependencies {
  readonly worktree: string;
  readonly slug: string;
  readonly roundId: RoundId;
  readonly from: ChildId;
  readonly to: ChildId;
  /** The verifier's concrete missing-symbol/path evidence. */
  readonly evidence: readonly string[];
}

async function shaAt(git: GitRunner, ref: string): Promise<CommitSha | undefined> {
  try {
    const result = await git(['rev-parse', '-q', '--verify', ref]);
    return result.exitCode === 0 ? parseCommitSha(result.stdout.trim()) : undefined;
  } catch { return undefined; }
}

function branchRef(slug: string, child: ChildId): string | undefined {
  const branch = childBranchFor(slug, child);
  return branch.ok ? `refs/heads/${branch.branch}` : undefined;
}

function rerenderForChild(body: string, child: ChildId): string {
  return body.replace(/^\*\*Child:\*\*\s*\d+\s*$/m, `**Child:** ${child}`);
}

async function hasOnlyRoundOrHaltCommits(
  git: GitRunner,
  base: CommitSha,
  tip: CommitSha,
  roundId: RoundId,
  slug: string,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly commit?: string }> {
  if (await isHaltRecordOnlyDescendant(git, base, tip, slug)) return { ok: true };
  try {
    const commits = await git(['rev-list', `${base}..${tip}`]);
    if (commits.exitCode !== 0) return { ok: false };
    for (const commit of commits.stdout.split('\n').filter(Boolean)) {
      const message = await git(['show', '-s', '--format=%B', commit]);
      if (message.exitCode !== 0) return { ok: false, commit };
      if (!new RegExp(`^Round:\\s*${roundId}\\s*$`, 'mi').test(message.stdout)) {
        const parsed = parseCommitSha(commit);
        const parent = await shaAt(git, `${commit}^`);
        if (!parsed || !parent || !await isHaltRecordOnlyDescendant(git, parent, parsed, slug)) return { ok: false, commit };
      }
    }
    return { ok: true };
  } catch { return { ok: false }; }
}

/**
 * Atomically preserve a rejected host tip, restore its immutable closure and
 * advance the routing marker.  Tree synchronization deliberately happens in
 * `completeRerouteSync`: a crash between the two leaves a replayable record.
 */
export async function rerouteRound(input: RerouteRoundInput): Promise<RerouteRoundResult> {
  const git = input.git ?? makeGitRunner(input.worktree);
  const [stored, marker] = await Promise.all([
    readRouteRecord(input.worktree, input.slug, input.roundId, { git }),
    readRepairMarker(input.worktree, input.slug, { git }),
  ]);
  if (stored.kind !== 'record' || marker.kind !== 'marker') return { kind: 'refused', detail: `routing round ${input.roundId} is unavailable` };
  if (marker.marker.roundId !== input.roundId || marker.marker.host !== input.from) return { kind: 'refused', detail: `routing round ${input.roundId} marker changed before reroute` };
  if (input.to <= input.from) return { kind: 'refused', detail: `routing round ${input.roundId} destination is not above host ${input.from}` };
  if (stored.record.hosts[input.from] !== 'repairing' || (stored.record.hosts[input.to] !== undefined && stored.record.hosts[input.to] !== 'pending')) {
    return { kind: 'refused', detail: `routing round ${input.roundId} destination is not pending` };
  }
  const sourceBranch = branchRef(input.slug, input.from);
  const resetTip = await shaAt(git, closureRefFor(input.slug, input.from));
  if (!sourceBranch || !resetTip) return { kind: 'refused', detail: `routing round ${input.roundId} source closure is unavailable` };
  const rejectedTip = await shaAt(git, sourceBranch);
  if (!rejectedTip) return { kind: 'refused', detail: `routing round ${input.roundId} source branch is unavailable` };
  const descendants = await hasOnlyRoundOrHaltCommits(git, resetTip, rejectedTip, input.roundId, input.slug);
  if (!descendants.ok) return { kind: 'refused', detail: `routing round ${input.roundId} refuses non-round commit${descendants.commit ? ` ${descendants.commit}` : ''}` };

  const destinationBranch = branchRef(input.slug, input.to) ?? `refs/heads/${leafBranchFor(input.slug)}`;
  const destinationHead = await shaAt(git, closureRefFor(input.slug, input.to)) ?? await shaAt(git, destinationBranch);
  if (!destinationHead) return { kind: 'refused', detail: `routing round ${input.roundId} destination closure is unavailable` };
  const moved = stored.record.allocation[input.from];
  if (!moved) return { kind: 'refused', detail: `routing round ${input.roundId} host ${input.from} has no allocation` };
  const destination = stored.record.allocation[input.to] ?? { remTaskIds: [], blockBodies: [] };
  const nextAllocation = {
    ...stored.record.allocation,
    [input.from]: { ...moved, remTaskIds: [], blockBodies: [] },
    [input.to]: {
      ...destination,
      remTaskIds: [...destination.remTaskIds, ...moved.remTaskIds],
      blockBodies: [...destination.blockBodies, ...moved.blockBodies.map((body) => rerenderForChild(body, input.to))],
    },
  };
  const transitioned = transitionHost(stored, input.from, 'reroute-moved', { credit: false });
  if (transitioned.kind !== 'updated') return { kind: 'refused', detail: `routing round ${input.roundId} cannot enter reroute-moved` };
  const hosts = Object.fromEntries(
    Object.entries({ ...transitioned.record.hosts, ...(transitioned.record.hosts[input.to] === undefined ? { [input.to]: 'pending' as const } : {}) })
      .sort(([left], [right]) => Number(left) - Number(right)),
  ) as RouteRecord['hosts'];
  const currentHostIndex = Object.keys(hosts).map(Number).indexOf(Number(input.to));
  if (currentHostIndex < 0) return { kind: 'refused', detail: `routing round ${input.roundId} destination is unavailable` };
  const rejectedRef = rejectedPinRefFor(input.slug, input.roundId, Number(input.from));
  let next: RouteRecord = {
    ...transitioned.record,
    hosts,
    allocation: nextAllocation,
    currentHostIndex,
    entry: undefined,
    items: transitioned.record.items.map((item) => item.host !== input.from ? item : {
      ...item, host: input.to,
      obligation: item.obligation === undefined ? undefined : { ...item.obligation, branch: destinationBranch, head: destinationHead },
    }),
    fallback: [...(transitioned.record.fallback ?? []), { from: input.from, to: input.to, evidence: input.evidence, branch: sourceBranch, head: rejectedTip }],
    reroute: { sourceBranch, rejectedTip, resetTip, destination: input.to },
  };
  next = withOutboxEvent(next, remediationReroutedEvent(input.roundId, input.from, input.to, rejectedRef));
  const wrote = await writeRoutingTransaction(input.worktree, input.slug, [
    { kind: 'create-pin', ref: rejectedRef, new: rejectedTip },
    { kind: 'update-branch', ref: sourceBranch, old: rejectedTip, new: resetTip },
    { kind: 'replace-marker', previous: marker, marker: { roundId: input.roundId, host: input.to } },
    { kind: 'update-record', previous: stored, record: next },
  ], { git });
  return wrote.kind === 'updated'
    ? { kind: 'rerouted', record: next }
    : { kind: 'refused', detail: `routing round ${input.roundId} reroute compare-and-swap failed: ${wrote.kind}` };
}

export type CompleteRerouteSyncResult = { readonly kind: 'completed'; readonly record: RouteRecord } | { readonly kind: 'refused'; readonly detail: string };

/** Finish the crash-recoverable half of a completed reroute transaction. */
export async function completeRerouteSync(
  input: Pick<RerouteRoundInput, 'worktree' | 'slug' | 'roundId' | 'git'>,
): Promise<CompleteRerouteSyncResult> {
  const git = input.git ?? makeGitRunner(input.worktree);
  const [stored, marker] = await Promise.all([
    readRouteRecord(input.worktree, input.slug, input.roundId, { git }),
    readRepairMarker(input.worktree, input.slug, { git }),
  ]);
  if (stored.kind !== 'record') return { kind: 'refused', detail: `routing round ${input.roundId} is unavailable` };
  const reroute = stored.record.reroute;
  const endpoints = validatedReroute(stored.record);
  if (!reroute) return { kind: 'completed', record: stored.record };
  if (!endpoints) return { kind: 'refused', detail: `routing round ${input.roundId} reroute record is inconsistent` };
  if (stored.record.hosts[endpoints.destination] !== 'admitted') {
    try { await syncRestackedWorktree(input.worktree, reroute.rejectedTip, reroute.resetTip, { git }); }
    catch (error) { return { kind: 'refused', detail: `routing round ${input.roundId} worktree sync failed: ${error instanceof Error ? error.message : String(error)}` }; }
  }
  if (marker.kind !== 'marker' || marker.marker.roundId !== input.roundId || marker.marker.host !== endpoints.destination) {
    return { kind: 'refused', detail: `routing round ${input.roundId} marker changed before reroute sync` };
  }
  if (stored.record.hosts[endpoints.destination] === 'admitted') return { kind: 'completed', record: stored.record };
  const sourceTransition = transitionHost(stored, endpoints.source, 'rerouted', { credit: false });
  if (sourceTransition.kind !== 'updated') return { kind: 'refused', detail: `routing round ${input.roundId} source cannot complete reroute` };
  const afterSource = { ...stored, record: sourceTransition.record };
  const destinationTransition = transitionHost(afterSource, endpoints.destination, 'admitted', { credit: false });
  if (destinationTransition.kind !== 'updated') return { kind: 'refused', detail: `routing round ${input.roundId} destination cannot be admitted` };
  const next = { ...destinationTransition.record, reroute: undefined };
  const wrote = await writeRoutingTransaction(input.worktree, input.slug, [
    { kind: 'update-record', previous: stored, record: next },
  ], { git });
  return wrote.kind === 'updated'
    ? { kind: 'completed', record: next }
    : { kind: 'refused', detail: `routing round ${input.roundId} sync compare-and-swap failed: ${wrote.kind}` };
}
