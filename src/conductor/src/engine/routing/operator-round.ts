import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { ConductorEventEmitter } from '../../ui/events.js';
import { CHILD_REGION_STEPS, type ChildId } from '../child-context.js';
import { switchToChild } from '../child-lifecycle.js';
import { createRoutedConductStateStore } from '../conduct-state-store.js';
import { childBranchFor, parseFeatureBranch } from '../feature-branch-identity.js';
import { loadConfig } from '../config.js';
import { verdictPathFor } from '../gate-verdicts.js';
import { makeGitRunner, type GitRunner } from '../rebase.js';
import { loadSliceTopology, type SliceTopology } from '../slice-topology.js';
import { publishedStackRefusal } from '../stack-publication.js';
import { readRestackJournal } from '../restack/restack-journal.js';
import { isHaltRecordOnlyDescendant } from '../restack/restack-recovery.js';
import { syncRestackedWorktree } from '../restack/restack-sync.js';
import { parseCommitSha, type CommitSha } from '../restack/restack-types.js';
import { writeGitHooksAndWire } from '../worktree-prepare.js';
import { routedRoundOpen } from './round-admission.js';
import { admitRound } from './round-admission.js';
import { pinHostEntry, restageHostRegion } from './host-region-entry.js';
import { grantRoutedRepairCredit } from './round-receipt.js';
import { createRouteRecord, readRepairMarker, readRevalidationQueue, readRouteRecord, routingFenceOpen, transitionHost, writeRoutingTransaction } from './route-record-store.js';
import { closureRefFor, redRefFor, rejectedPinRefFor } from './routing-refs.js';
import { parseRoundId, routingSettingOn, type CarriedOperatorChild, type OperatorRouteSection, type RoundId, type RouteRecord } from './route-types.js';
import { operatorRoundEvent, withOutboxEvent } from './routing-events.js';
import type { ConductState, StateMutation } from '../../types/state.js';

export interface CheckOperatorTipsInput {
  readonly worktree: string;
  readonly slug: string;
  readonly record: RouteRecord;
  readonly git?: GitRunner;
}

export type CheckOperatorTipsResult =
  | { readonly kind: 'clear' }
  | { readonly kind: 'moved'; readonly branches: ReadonlyArray<{ readonly branch: string; readonly recorded: CommitSha; readonly current: string }> }
  | { readonly kind: 'unavailable'; readonly detail: string };

export interface CheckDeclareOperatorRoundInput {
  readonly worktree: string;
  readonly slug: string;
  readonly roundId: RoundId;
  readonly host: ChildId;
  readonly git?: GitRunner;
}

export type CheckDeclareOperatorRoundResult =
  | { readonly kind: 'accepted'; readonly stored: import('./route-record-store.js').StoredRouteRecord; readonly tip: CommitSha }
  | { readonly kind: 'refused'; readonly detail: string };

export interface DeclareOperatorRoundInput extends CheckDeclareOperatorRoundInput {
  readonly checked: Extract<CheckDeclareOperatorRoundResult, { readonly kind: 'accepted' }>;
  readonly at?: string;
}

export type DeclareOperatorRoundResult =
  | { readonly kind: 'declared' }
  | { readonly kind: 'refused'; readonly detail: string };

export interface CheckAbandonOperatorRoundInput {
  readonly worktree: string;
  readonly slug: string;
  readonly roundId: RoundId;
  readonly host: ChildId;
  readonly git?: GitRunner;
}

export type CheckAbandonOperatorRoundResult =
  | { readonly kind: 'accepted'; readonly stored: import('./route-record-store.js').StoredRouteRecord }
  | { readonly kind: 'refused'; readonly detail: string };

/** The single durable reason-line contract for every operator-owned HALT. */
export function formatOperatorHaltReason(reason: string, roundId: RoundId): string {
  return `Operator-Halt: ${reason} ${roundId}`;
}

/** Parse only a complete operator reason line, never a free-form explanation. */
export function parseOperatorHaltReason(line: string): { readonly reason: string; readonly roundId: RoundId } | undefined {
  const match = /^Operator-Halt: ([a-z0-9-]+) (r[1-9][0-9]*)$/.exec(line.trim());
  const roundId = match === null ? undefined : parseRoundId(match[2]!);
  return match === null || roundId === undefined ? undefined : { reason: match[1]!, roundId };
}

/**
 * Detect branch changes that the pre-commit hook could not observe.  Exit
 * restacks are deliberately outside this boundary: the active host has moved
 * on to `built`/`restacked` before they rewrite its descendants.
 */
export async function checkOperatorTips(input: CheckOperatorTipsInput): Promise<CheckOperatorTipsResult> {
  if (input.record.kind !== 'operator' || input.record.operator === undefined) return { kind: 'clear' };
  const active = Object.entries(input.record.hosts).find(([, state]) => state === 'admitted' || state === 'repairing');
  if (active === undefined) return { kind: 'clear' };

  const git = input.git ?? makeGitRunner(input.worktree);
  const expected = new Map<string, { readonly recorded: CommitSha; readonly permitHaltRecords: boolean }>();
  for (const [branch, recorded] of Object.entries(input.record.operator.otherTips)) {
    expected.set(branch, { recorded, permitHaltRecords: true });
  }
  for (const carried of input.record.operator.carried) {
    const branch = childBranchFor(input.slug, carried.child);
    if (!branch.ok) return { kind: 'unavailable', detail: `cannot resolve carried child ${carried.child} branch` };
    // A carried child is an explicit work item, so even a halt-only extension
    // is not allowed to change its recorded carried tip.
    expected.set(branch.branch, { recorded: carried.tip, permitHaltRecords: false });
  }

  const moved: Array<{ branch: string; recorded: CommitSha; current: string }> = [];
  for (const [branch, expectation] of [...expected.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    let current: CommitSha | undefined;
    try {
      const resolved = await git(['rev-parse', '-q', '--verify', `refs/heads/${branch}`]);
      if (resolved.exitCode === 1) {
        moved.push({ branch, recorded: expectation.recorded, current: '<missing>' });
        continue;
      }
      current = resolved.exitCode === 0 ? parseCommitSha(resolved.stdout.trim()) : undefined;
    } catch {
      current = undefined;
    }
    if (current === undefined) return { kind: 'unavailable', detail: `cannot resolve recorded branch ${branch}` };
    if (current === expectation.recorded) continue;
    if (expectation.permitHaltRecords) {
      try {
        const descendant = await git(['merge-base', '--is-ancestor', expectation.recorded, current]);
        if (descendant.exitCode === 0 && await isHaltRecordOnlyDescendant(git, expectation.recorded, current, input.slug)) continue;
      } catch {
        return { kind: 'unavailable', detail: `cannot compare recorded branch ${branch}` };
      }
    }
    moved.push({ branch, recorded: expectation.recorded, current });
  }
  return moved.length === 0 ? { kind: 'clear' } : { kind: 'moved', branches: moved };
}

/**
 * Proves that an operator landing still owns a real change before its durable
 * declaration.  The caller holds the feature lease across this check and the
 * following record transaction.
 */
export async function checkDeclareOperatorRound(
  input: CheckDeclareOperatorRoundInput,
): Promise<CheckDeclareOperatorRoundResult> {
  const git = input.git ?? makeGitRunner(input.worktree);
  const stored = await readRouteRecord(input.worktree, input.slug, input.roundId, { git });
  if (stored.kind !== 'record' || stored.record.kind !== 'operator') {
    return { kind: 'refused', detail: `operator round ${input.roundId} is unavailable for declaration` };
  }
  if (stored.record.operator?.origin !== 'land') {
    return { kind: 'refused', detail: `operator round ${input.roundId} has origin ${stored.record.operator?.origin}; --done only declares land rounds` };
  }
  if (stored.record.operator.declaration !== undefined) {
    return { kind: 'refused', detail: `operator round ${input.roundId} is already declared` };
  }
  if (stored.record.hosts[input.host] !== 'repairing') {
    return { kind: 'refused', detail: `operator round ${input.roundId} host ${input.host} is not repairing` };
  }
  const marker = await readRepairMarker(input.worktree, input.slug, { git });
  if (marker.kind !== 'marker' || marker.marker.roundId !== input.roundId || marker.marker.host !== input.host) {
    return { kind: 'refused', detail: `operator round ${input.roundId} repair marker is unavailable for declaration` };
  }
  const branch = childBranchFor(input.slug, input.host);
  if (!branch.ok) return { kind: 'refused', detail: branch.reason };
  try {
    const current = await git(['symbolic-ref', '--short', 'HEAD']);
    if (current.exitCode !== 0 || current.stdout.trim() !== branch.branch) {
      return { kind: 'refused', detail: `declaration must run on ${branch.branch}` };
    }
    const status = await git(['status', '--porcelain']);
    if (status.exitCode !== 0 || status.stdout.trim() !== '') {
      return { kind: 'refused', detail: 'the dirty worktree must be committed or stashed before declaring the landing' };
    }
  } catch {
    return { kind: 'refused', detail: `cannot inspect ${branch.branch} before declaration` };
  }

  const journal = await readRestackJournal(input.worktree, input.slug, { git });
  if (!routingFenceOpen(journal)) return { kind: 'refused', detail: 'the restack journal is not terminal' };
  const closure = await closureAt(git, input.slug, input.host);
  const tip = await resolveCommitRef(git, `refs/heads/${branch.branch}`);
  if (closure === undefined || tip === undefined) {
    return { kind: 'refused', detail: `cannot resolve ${branch.branch} and its closure before declaration` };
  }
  try {
    const commits = await git(['rev-list', `${closure}..${tip}`]);
    if (commits.exitCode !== 0 || commits.stdout.trim() === '' || await isHaltRecordOnlyDescendant(git, closure, tip, input.slug)) {
      // ai-conductor:session-command-context=operator-only
      return { kind: 'refused', detail: 'the empty landing has no reviewer change; make one or run ai-conductor stack land --abandon' };
      // /ai-conductor:session-command-context
    }
  } catch {
    return { kind: 'refused', detail: `cannot inspect landing commits on ${branch.branch}` };
  }
  const tips = await checkOperatorTips({ worktree: input.worktree, slug: input.slug, record: stored.record, git });
  if (tips.kind === 'unavailable') return { kind: 'refused', detail: tips.detail };
  if (tips.kind === 'moved') {
    const details = tips.branches.map(({ branch: name, recorded, current }) => `${name} (recorded ${recorded}, current ${current})`).join(', ');
    return { kind: 'refused', detail: `operator round branch moved: ${details}` };
  }
  return { kind: 'accepted', stored, tip };
}

/** Records the declaration and durable work order after its preconditions pass. */
export async function declareOperatorRound(input: DeclareOperatorRoundInput): Promise<DeclareOperatorRoundResult> {
  const allocation = input.checked.stored.record.allocation[input.host];
  const operator = input.checked.stored.record.operator;
  if (allocation === undefined || operator === undefined) return { kind: 'refused', detail: `operator round ${input.roundId} has no host allocation` };
  const record: RouteRecord = withOutboxEvent({
    ...input.checked.stored.record,
    allocation: { ...input.checked.stored.record.allocation, [input.host]: { ...allocation, retryHint: operator.reason } },
    operator: { ...operator, declaration: { tip: input.checked.tip, at: input.at ?? new Date().toISOString() } },
  }, operatorRoundEvent(input.checked.stored.record.roundId, operator, input.host, 'declared'));
  const wrote = await writeRoutingTransaction(input.worktree, input.slug, [
    { kind: 'update-record', previous: input.checked.stored, record },
  ], { git: input.git });
  return wrote.kind === 'updated'
    ? { kind: 'declared' }
    : { kind: 'refused', detail: `cannot declare operator round: ${wrote.kind}` };
}

/**
 * Proves only the abandoned round's own authority.  Unlike declaration, this
 * deliberately does not inspect siblings, carried children, or their tips:
 * abandoning is the safe escape route when another stack surface is broken.
 */
export async function checkAbandonOperatorRound(
  input: CheckAbandonOperatorRoundInput,
): Promise<CheckAbandonOperatorRoundResult> {
  const git = input.git ?? makeGitRunner(input.worktree);
  const stored = await readRouteRecord(input.worktree, input.slug, input.roundId, { git });
  if (stored.kind !== 'record' || stored.record.kind !== 'operator' || stored.record.operator?.origin !== 'land' || stored.record.phase !== 'open') {
    return { kind: 'refused', detail: `operator round ${input.roundId} is unavailable for abandon` };
  }
  const state = stored.record.hosts[input.host];
  if (state === 'built' || state === 'restacked' || state === 'done') {
    return { kind: 'refused', detail: `operator round ${input.roundId} host ${input.host} has begun its exit restack` };
  }
  if (state !== 'admitted' && state !== 'repairing' && state !== 'abandoning') {
    return { kind: 'refused', detail: `operator round ${input.roundId} host ${input.host} is not abandonable` };
  }
  const marker = await readRepairMarker(input.worktree, input.slug, { git });
  if (marker.kind !== 'marker' || marker.marker.roundId !== input.roundId || marker.marker.host !== input.host) {
    return { kind: 'refused', detail: `operator round ${input.roundId} repair marker is unavailable for abandon` };
  }
  const branch = childBranchFor(input.slug, input.host);
  if (!branch.ok) return { kind: 'refused', detail: branch.reason };
  try {
    const current = await git(['symbolic-ref', '--short', 'HEAD']);
    if (current.exitCode !== 0 || current.stdout.trim() !== branch.branch) {
      return { kind: 'refused', detail: `abandon must run on ${branch.branch}` };
    }
    const untracked = await git(['ls-files', '--others', '--exclude-standard']);
    if (untracked.exitCode !== 0 || untracked.stdout.trim() !== '') {
      return { kind: 'refused', detail: 'the dirty worktree must be committed or stashed before abandoning the landing' };
    }
    if (state !== 'abandoning') {
      if (await worktreeDirty(git)) return { kind: 'refused', detail: 'the dirty worktree must be committed or stashed before abandoning the landing' };
    } else {
      const abandon = stored.record.operator.abandon;
      if (abandon === undefined) return { kind: 'refused', detail: `operator round ${input.roundId} has no abandon recovery state` };
      const cleanAt = async (tip: CommitSha) => {
        const [unstaged, staged] = await Promise.all([
          git(['diff', '--quiet', tip]),
          git(['diff', '--cached', '--quiet', tip]),
        ]);
        return unstaged.exitCode === 0 && staged.exitCode === 0;
      };
      if (!await cleanAt(abandon.rejectedTip) && !await cleanAt(abandon.resetTip)) {
        return { kind: 'refused', detail: 'the dirty worktree must match the recorded abandon tips before recovery' };
      }
    }
  } catch {
    return { kind: 'refused', detail: `cannot inspect ${branch.branch} before abandon` };
  }
  return { kind: 'accepted', stored };
}

export interface CheckOpenOperatorRoundInput {
  readonly worktree: string;
  readonly slug: string;
  readonly child: ChildId;
  readonly carry: readonly ChildId[];
  readonly reason: string;
}

export type OpenOperatorRoundRefusalKind =
  | 'published-stack'
  | 'leaf-target'
  | 'unknown-position'
  | 'target-open'
  | 'topology-unavailable'
  | 'not-stacked'
  | 'routing-off'
  | 'round-open'
  | 'queue-non-empty'
  | 'journal-open'
  | 'dirty-worktree'
  | 'reason-missing'
  | 'verify-green-contract-missing'
  | 'uncarried-commits'
  | 'carried-below-host';

export type OpenOperatorRoundRefusal = {
  readonly kind: OpenOperatorRoundRefusalKind;
  readonly text: string;
};

export type CheckOpenOperatorRoundResult =
  | {
      readonly kind: 'accepted';
      readonly topology: Extract<SliceTopology, { readonly kind: 'sliced' }>;
      readonly host: ChildId;
      readonly closure: CommitSha;
      readonly carried: readonly CarriedOperatorChild[];
    }
  | { readonly kind: 'refused'; readonly refusal: OpenOperatorRoundRefusal };

/** Read seams let the CLI keep all mutation after this predicate returns accepted. */
export interface CheckOpenOperatorRoundDependencies {
  readonly git?: GitRunner;
  readonly loadSliceTopology?: typeof loadSliceTopology;
  readonly publishedStackRefusal?: typeof publishedStackRefusal;
  readonly routedRoundOpen?: typeof routedRoundOpen;
  readonly routingFenceOpen?: typeof routingFenceOpen;
  readonly readRepairMarker?: typeof readRepairMarker;
  readonly readRevalidationQueue?: typeof readRevalidationQueue;
  readonly readRestackJournal?: typeof readRestackJournal;
  readonly loadConfig?: typeof loadConfig;
  readonly access?: typeof access;
}

function command(slug: string, child: ChildId, carry: readonly ChildId[] = []): string {
  const carried = [...new Set(carry)].sort((left, right) => left - right)
    .map((position) => ` --carry ${position}`).join('');
  // ai-conductor:session-command-context=operator-only
  return `ai-conductor stack land --slug ${slug} --child ${child}${carried} --reason "<why>"`;
  // /ai-conductor:session-command-context
}

function refuse(kind: OpenOperatorRoundRefusalKind, text: string): CheckOpenOperatorRoundResult {
  return { kind: 'refused', refusal: { kind, text } };
}

async function closureAt(
  git: GitRunner,
  slug: string,
  child: ChildId,
): Promise<CommitSha | undefined> {
  try {
    const result = await git(['rev-parse', '-q', '--verify', closureRefFor(slug, child)]);
    return result.exitCode === 0 ? parseCommitSha(result.stdout.trim()) : undefined;
  } catch {
    return undefined;
  }
}

async function childRawCommitTip(
  git: GitRunner,
  slug: string,
  child: ChildId,
  closure: CommitSha,
): Promise<CommitSha | undefined> {
  const branch = childBranchFor(slug, child);
  if (!branch.ok) return closure;
  try {
    const commits = await git(['rev-list', `${closure}..refs/heads/${branch.branch}`]);
    if (commits.exitCode !== 0) return closure;
    for (const commit of commits.stdout.split('\n').filter(Boolean)) {
      const changed = await git(['diff-tree', '--no-commit-id', '--name-only', '-r', commit]);
      if (changed.exitCode !== 0) return closure;
      const paths = changed.stdout.split('\n').filter(Boolean);
      if (paths.length === 0 || !paths.every((path) => path === `.docs/halted/${slug}.md`)) {
        const tip = await git(['rev-parse', '-q', '--verify', `refs/heads/${branch.branch}`]);
        return tip.exitCode === 0 ? parseCommitSha(tip.stdout.trim()) ?? closure : closure;
      }
    }
    return undefined;
  } catch {
    return closure;
  }
}

async function worktreeDirty(git: GitRunner): Promise<boolean> {
  try {
    const status = await git(['status', '--porcelain']);
    return status.exitCode !== 0 || status.stdout.trim() !== '';
  } catch {
    return true;
  }
}

async function hasVerifyGreenContract(
  worktree: string,
  slug: string,
  child: ChildId,
  git: GitRunner,
  checkAccess: typeof access,
): Promise<boolean> {
  try {
    const red = await git(['rev-parse', '-q', '--verify', redRefFor(slug, child)]);
    if (red.exitCode === 0) return true;
  } catch {
    return false;
  }
  try {
    await checkAccess(join(worktree, '.pipeline', 'children', String(child), 'acceptance-specs-run.json'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Rejects an unsafe landing before the CLI parks, leases, or creates a route.
 * Every branch is read-only so a refusal preserves the feature exactly as found.
 */
export async function checkOpenOperatorRound(
  input: CheckOpenOperatorRoundInput,
  dependencies: CheckOpenOperatorRoundDependencies = {},
): Promise<CheckOpenOperatorRoundResult> {
  const git = dependencies.git ?? makeGitRunner(input.worktree);
  const readTopology = dependencies.loadSliceTopology ?? loadSliceTopology;
  const readPublished = dependencies.publishedStackRefusal ?? publishedStackRefusal;
  const roundOpen = dependencies.routedRoundOpen ?? routedRoundOpen;
  const fenceOpen = dependencies.routingFenceOpen ?? routingFenceOpen;
  const readMarker = dependencies.readRepairMarker ?? readRepairMarker;
  const readQueue = dependencies.readRevalidationQueue ?? readRevalidationQueue;
  const readJournal = dependencies.readRestackJournal ?? readRestackJournal;
  const readConfig = dependencies.loadConfig ?? loadConfig;
  const checkAccess = dependencies.access ?? access;

  if (input.reason.trim() === '') {
    return refuse('reason-missing', `A non-empty reason is required; retry ${command(input.slug, input.child, input.carry)}.`);
  }

  const topology = await readTopology(input.worktree, input.slug, { git });
  if (topology.kind === 'unavailable') {
    return refuse('topology-unavailable', `Cannot read the sealed stack topology (${topology.cause}; #3365); resolve it, then retry ${command(input.slug, input.child, input.carry)}.`);
  }
  if (topology.kind !== 'sliced' || topology.positions.length < 2) {
    return refuse('not-stacked', `Feature ${input.slug} is not a stacked feature; use ordinary BUILD workflow instead of ${command(input.slug, input.child, input.carry)}.`);
  }

  const config = await readConfig(input.worktree);
  if (!routingSettingOn(config.ok ? config.config : undefined)) {
    return refuse('routing-off', `Routing is disabled by stacked_prs.route_whole_feature_fixes; enable it, then retry ${command(input.slug, input.child, input.carry)}.`);
  }
  if (await readPublished(input.worktree, input.slug, { git })) {
    return refuse('published-stack', `This stack is published and frozen by #3268; resolve publication first, then retry ${command(input.slug, input.child, input.carry)}.`);
  }

  const positions = topology.positions as readonly ChildId[];
  if (!positions.includes(input.child)) {
    return refuse('unknown-position', `Child ${input.child} is not a declared position (declared: ${positions.join(', ')}); choose one, then retry ${command(input.slug, input.child, input.carry)}.`);
  }
  const leaf = positions.at(-1)!;
  if (input.child === leaf) {
    return refuse('leaf-target', `Child ${input.child} is the leaf and cannot be a landing host; choose a closed child, then retry ${command(input.slug, input.child, input.carry)}.`);
  }

  const closure = await closureAt(git, input.slug, input.child);
  if (closure === undefined) {
    return refuse('target-open', `Child ${input.child} has no closure ref and is already open; work on it directly instead of ${command(input.slug, input.child, input.carry)}.`);
  }

  const carriedPositions = [...new Set(input.carry)];
  const carriedBelow = carriedPositions.find((child) => positions.indexOf(child) <= positions.indexOf(input.child));
  if (carriedBelow !== undefined) {
    // ai-conductor:session-command-context=operator-only
    return refuse('carried-below-host', `Child ${carriedBelow} is at or below host ${input.child}; land from the lowest affected child with ai-conductor stack land --child ${carriedBelow} --carry ${input.child} --reason "<why>".`);
    // /ai-conductor:session-command-context
  }

  const carried: CarriedOperatorChild[] = [];
  for (const child of positions.slice(0, -1)) {
    if (child === input.child) continue;
    const childClosure = await closureAt(git, input.slug, child);
    const tip = childClosure === undefined ? undefined : await childRawCommitTip(git, input.slug, child, childClosure);
    if (tip === undefined) continue;
    if (!carriedPositions.includes(child)) {
      return refuse('uncarried-commits', `child ${child} has commits past its closure; carry it with ${command(input.slug, input.child, [child])}.`);
    }
    carried.push({ child, tip });
  }

  const marker = await readMarker(input.worktree, input.slug, { git });
  if (marker.kind === 'marker') {
    return refuse('round-open', `Routing round ${marker.marker.roundId} is already open; finish or abandon it, then retry ${command(input.slug, input.child, input.carry)}.`);
  }
  const open = await roundOpen(input.worktree, input.slug, { git });
  const queue = await readQueue(input.worktree, input.slug, { git });
  if (queue.kind === 'queue' && queue.queue.entries.length > 0) {
    return refuse('queue-non-empty', `The revalidation queue has child ${queue.queue.entries[0]!.child} open; drain it, then retry ${command(input.slug, input.child, input.carry)}.`);
  }
  if (open) {
    return refuse('round-open', `A routing round is already open; finish or abandon it, then retry ${command(input.slug, input.child, input.carry)}.`);
  }
  const journal = await readJournal(input.worktree, input.slug, { git });
  if (!fenceOpen(journal)) {
    return refuse('journal-open', `The restack journal is open; recover it, then retry ${command(input.slug, input.child, input.carry)}.`);
  }
  if (await worktreeDirty(git)) {
    return refuse('dirty-worktree', `The worktree has uncommitted changes; commit or stash them, then retry ${command(input.slug, input.child, input.carry)}.`);
  }

  const ownsCriteria = Object.values(topology.storyOwnership).includes(input.child);
  if (ownsCriteria && !await hasVerifyGreenContract(input.worktree, input.slug, input.child, git, checkAccess)) {
    return refuse('verify-green-contract-missing', `Child ${input.child} has no verify-green contract; restore red/c${input.child} or acceptance evidence, then retry ${command(input.slug, input.child, input.carry)}.`);
  }
  return { kind: 'accepted', topology, host: input.child, closure, carried };
}

export interface OpenOperatorRoundInput {
  readonly worktree: string;
  readonly slug: string;
  readonly roundId: RoundId;
  readonly host: ChildId;
  readonly reason: string;
  readonly operator: string;
  readonly carried: readonly CarriedOperatorChild[];
  readonly park?: { readonly token: string };
  readonly emitter: ConductorEventEmitter;
  readonly git?: GitRunner;
}

export type OpenOperatorRoundResult =
  | { readonly kind: 'opened'; readonly pinnedBase: CommitSha }
  | { readonly kind: 'refused'; readonly detail: string };

async function readPriorRegion(
  worktree: string,
  host: ChildId,
): Promise<OperatorRouteSection['priorRegion'] | undefined> {
  const state = await createRoutedConductStateStore(worktree, host).read();
  if (!state.ok) return undefined;
  const verdicts: Record<string, string> = {};
  for (const step of CHILD_REGION_STEPS) {
    try {
      verdicts[step] = await readFile(verdictPathFor(worktree, step, host), 'utf8');
    } catch {
      // A gate without a verdict is a normal completed-state shape. Only files
      // that exist are part of the byte-preserving abandon snapshot.
    }
  }
  return { statuses: Object.fromEntries(CHILD_REGION_STEPS.map((step) => [step, state.value[step]])) as OperatorRouteSection['priorRegion']['statuses'], verdicts };
}

async function readOtherFeatureTips(
  git: GitRunner,
  slug: string,
  host: ChildId,
): Promise<Record<string, CommitSha> | undefined> {
  const hostBranch = childBranchFor(slug, host);
  if (!hostBranch.ok) return undefined;
  try {
    const listed = await git(['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads/feat']);
    if (listed.exitCode !== 0) return undefined;
    const tips: Record<string, CommitSha> = {};
    for (const line of listed.stdout.split('\n').filter(Boolean)) {
      const [branch, rawTip] = line.split(' ');
      const tip = rawTip === undefined ? undefined : parseCommitSha(rawTip);
      if (!branch || !tip || branch === hostBranch.branch) continue;
      const identity = parseFeatureBranch(branch);
      if ((identity.kind === 'leaf' || identity.kind === 'child') && identity.slug === slug) {
        tips[branch] = tip;
      }
    }
    return Object.keys(tips).length === 0 ? undefined : tips;
  } catch {
    return undefined;
  }
}

async function switchToOperatorHost(
  input: OpenOperatorRoundInput,
  branch: string,
  git: GitRunner,
): Promise<{ readonly kind: 'switched' } | { readonly kind: 'refused'; readonly detail: string }> {
  try {
    const current = await git(['symbolic-ref', '--short', 'HEAD']);
    if (current.exitCode !== 0) return { kind: 'refused', detail: 'cannot determine current branch before operator host switch' };
    if (current.stdout.trim() === branch) return { kind: 'switched' };
  } catch {
    return { kind: 'refused', detail: 'cannot determine current branch before operator host switch' };
  }
  const switched = await switchToChild(input.worktree, { child: input.host, position: input.host, branch }, input.emitter, undefined, { git });
  return switched.kind === 'completed'
    ? { kind: 'switched' }
    : { kind: 'refused', detail: 'reason' in switched ? switched.reason : `cannot switch to operator host ${branch}` };
}

/**
 * Opens (or resumes) an operator-owned landing after its caller has completed
 * the read-only admission predicate. Durable writes deliberately advance in
 * the same order as the operator contract, so a crash resumes from the first
 * absent state instead of opening a second round.
 */
export async function openOperatorRound(input: OpenOperatorRoundInput): Promise<OpenOperatorRoundResult> {
  const git = input.git ?? makeGitRunner(input.worktree);
  let loaded = await readRouteRecord(input.worktree, input.slug, input.roundId, { git });
  if (loaded.kind === 'absent') {
    // Both values belong to the prepared record and must be observed before
    // the first mutation, preserving the precise state abandon will restore.
    const priorRegion = await readPriorRegion(input.worktree, input.host);
    const otherTips = await readOtherFeatureTips(git, input.slug, input.host);
    if (priorRegion === undefined || otherTips === undefined) {
      return { kind: 'refused', detail: `cannot prepare operator round ${input.roundId}: host state or feature tips are unavailable` };
    }
    const created = await createRouteRecord(input.worktree, input.slug, {
      roundId: input.roundId,
      sealedAuthored: 0,
      kind: 'operator',
      items: [],
      allocation: { [input.host]: { remTaskIds: [], blockBodies: [] } },
      operator: {
        origin: 'land',
        reason: input.reason,
        operator: input.operator,
        entryStep: 'acceptance_specs',
        ...(input.park === undefined ? {} : { park: input.park }),
        carried: input.carried,
        otherTips,
        priorRegion,
      },
    }, { git });
    if (created.kind !== 'created') return { kind: 'refused', detail: `cannot create prepared operator round: ${created.kind}` };
    loaded = await readRouteRecord(input.worktree, input.slug, input.roundId, { git });
  }
  if (loaded.kind !== 'record') return { kind: 'refused', detail: `operator round ${input.roundId} is unavailable` };
  let stored = loaded;
  if (stored.record.kind !== 'operator' || stored.record.operator?.origin !== 'land' || stored.record.hosts[input.host] === undefined) {
    return { kind: 'refused', detail: `operator round ${input.roundId} does not match landing host ${input.host}` };
  }

  if (stored.record.phase === 'prepared') {
    try {
      await writeGitHooksAndWire(input.worktree);
    } catch (error) {
      return { kind: 'refused', detail: `cannot wire operator commit hooks: ${error instanceof Error ? error.message : String(error)}` };
    }
    const admitted = await admitRound(input.worktree, input.slug, stored.record, input.host, { git });
    if (admitted.kind !== 'admitted') return { kind: 'refused', detail: `cannot admit operator round after marker transaction: ${admitted.detail}` };
    loaded = await readRouteRecord(input.worktree, input.slug, input.roundId, { git });
    if (loaded.kind !== 'record') return { kind: 'refused', detail: `operator round ${input.roundId} is unavailable after marker transaction` };
    stored = loaded;
  }

  const hostState = stored.record.hosts[input.host];
  if (hostState !== 'admitted' && hostState !== 'repairing') {
    return { kind: 'refused', detail: `operator round ${input.roundId} host ${input.host} is not admitted` };
  }
  const pinned = await pinHostEntry(input.worktree, input.slug, stored, input.host, git);
  if (pinned.kind === 'refused') return pinned;
  stored = pinned.stored;
  const switched = await switchToOperatorHost(input, pinned.target.branch, git);
  if (switched.kind === 'refused') return switched;

  if (stored.record.hosts[input.host] === 'admitted') {
    const restaged = await restageHostRegion(input.worktree, input.slug, input.host, stored.record, git);
    if (restaged.kind === 'refused') return restaged;
    const repairing = transitionHost(stored, input.host, 'repairing', { credit: true });
    if (repairing.kind !== 'updated') return { kind: 'refused', detail: `operator round ${input.roundId} host ${input.host} cannot enter repairing` };
    const wrote = await writeRoutingTransaction(input.worktree, input.slug, [
      { kind: 'update-record', previous: stored, record: repairing.record },
    ], { git });
    if (wrote.kind !== 'updated') return { kind: 'refused', detail: `cannot enter operator host repairing: ${wrote.kind}` };
  }
  const credit = await grantRoutedRepairCredit({ projectRoot: input.worktree, child: input.host, roundId: input.roundId });
  if (credit.kind === 'refused') return { kind: 'refused', detail: `cannot grant operator repair credit: ${credit.detail}` };
  return { kind: 'opened', pinnedBase: pinned.pinnedBase };
}

export interface AbandonOperatorRoundInput {
  readonly worktree: string;
  readonly slug: string;
  readonly roundId: RoundId;
  readonly host: ChildId;
  readonly git?: GitRunner;
}

export type AbandonOperatorRoundResult =
  | { readonly kind: 'abandoned' }
  | { readonly kind: 'refused'; readonly detail: string };

async function resolveCommitRef(
  git: GitRunner,
  ref: string,
): Promise<CommitSha | undefined> {
  try {
    const result = await git(['rev-parse', '-q', '--verify', ref]);
    return result.exitCode === 0 ? parseCommitSha(result.stdout.trim()) : undefined;
  } catch {
    return undefined;
  }
}

async function restoreOperatorPriorRegion(
  worktree: string,
  host: ChildId,
  priorRegion: OperatorRouteSection['priorRegion'],
): Promise<{ readonly kind: 'restored' } | { readonly kind: 'refused'; readonly detail: string }> {
  const state = createRoutedConductStateStore(worktree, host);
  const current = await state.read();
  if (!current.ok) return { kind: 'refused', detail: `cannot read abandoned host ${host} region state: ${current.error.message}` };
  const mutations = CHILD_REGION_STEPS
    .filter((step) => current.value[step] !== priorRegion.statuses[step])
    .map((step) => ({
      field: step,
      expected: current.value[step],
      next: priorRegion.statuses[step],
      intent: `restore abandoned operator host ${host} ${step}`,
    } as StateMutation<ConductState>));
  if (mutations.length > 0) {
    const restored = await state.applyBatch({
      name: `restore abandoned operator host ${host} region`,
      mutations,
    });
    if ('message' in restored) return { kind: 'refused', detail: `cannot restore abandoned host ${host} region: ${restored.message}` };
  }

  try {
    for (const step of CHILD_REGION_STEPS) {
      const path = verdictPathFor(worktree, step, host);
      const bytes = priorRegion.verdicts[step];
      if (bytes === undefined) {
        await rm(path, { force: true });
      } else {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, bytes);
      }
    }
  } catch (error) {
    return { kind: 'refused', detail: `cannot restore abandoned host ${host} verdicts: ${error instanceof Error ? error.message : String(error)}` };
  }
  return { kind: 'restored' };
}

async function onOperatorHostBranch(
  git: GitRunner,
  slug: string,
  host: ChildId,
): Promise<boolean> {
  const branch = childBranchFor(slug, host);
  if (!branch.ok) return false;
  try {
    const current = await git(['symbolic-ref', '--short', 'HEAD']);
    return current.exitCode === 0 && current.stdout.trim() === branch.branch;
  } catch {
    return false;
  }
}

/**
 * Reverts an operator landing without advancing the round to the leaf. The
 * return-to-leaf recovery is deliberately a later owner; this function only
 * completes the durable host reset, worktree synchronization, prior-region
 * restoration, and marker removal stages.
 */
export async function abandonOperatorRound(
  input: AbandonOperatorRoundInput,
): Promise<AbandonOperatorRoundResult> {
  const git = input.git ?? makeGitRunner(input.worktree);
  let stored = await readRouteRecord(input.worktree, input.slug, input.roundId, { git });
  if (stored.kind !== 'record' || stored.record.kind !== 'operator' || stored.record.operator === undefined) {
    return { kind: 'refused', detail: `operator round ${input.roundId} is unavailable for abandon` };
  }
  if (stored.record.hosts[input.host] === 'abandoned') return { kind: 'abandoned' };

  const branch = childBranchFor(input.slug, input.host);
  if (!branch.ok) return { kind: 'refused', detail: branch.reason };
  const hostRef = `refs/heads/${branch.branch}`;
  if (stored.record.hosts[input.host] === 'admitted' || stored.record.hosts[input.host] === 'repairing') {
    const [rejectedTip, resetTip] = await Promise.all([
      resolveCommitRef(git, hostRef),
      resolveCommitRef(git, closureRefFor(input.slug, input.host)),
    ]);
    if (rejectedTip === undefined || resetTip === undefined) {
      return { kind: 'refused', detail: `cannot resolve host ${input.host} rejected or closure tip for abandon` };
    }
    const abandoning = transitionHost(stored, input.host, 'abandoning', { credit: false });
    if (abandoning.kind !== 'updated') return { kind: 'refused', detail: `operator host ${input.host} cannot enter abandoning` };
    const record: RouteRecord = {
      ...abandoning.record,
      operator: {
        ...abandoning.record.operator!,
        abandon: { rejectedTip, resetTip, stage: 'moved' },
      },
    };
    const wrote = await writeRoutingTransaction(input.worktree, input.slug, [
      { kind: 'create-pin', ref: rejectedPinRefFor(input.slug, input.roundId, input.host), new: rejectedTip },
      { kind: 'update-branch', ref: hostRef, old: rejectedTip, new: resetTip },
      { kind: 'update-record', previous: stored, record },
    ], { git });
    if (wrote.kind !== 'updated') return { kind: 'refused', detail: `cannot record abandoned host reset: ${wrote.kind}` };
    stored = await readRouteRecord(input.worktree, input.slug, input.roundId, { git });
    if (stored.kind !== 'record') return { kind: 'refused', detail: `operator round ${input.roundId} is unavailable after host reset` };
  }

  const abandon = stored.record.operator?.abandon;
  if (stored.record.hosts[input.host] !== 'abandoning' || abandon === undefined) {
    return { kind: 'refused', detail: `operator host ${input.host} is not abandonable` };
  }
  if (abandon.stage === 'moved') {
    if (!await onOperatorHostBranch(git, input.slug, input.host)) {
      return { kind: 'refused', detail: `cannot synchronize abandoned host ${input.host} while not on ${branch.branch}` };
    }
    try {
      await syncRestackedWorktree(input.worktree, abandon.rejectedTip, abandon.resetTip, { git });
    } catch (error) {
      return { kind: 'refused', detail: `cannot synchronize abandoned host ${input.host}: ${error instanceof Error ? error.message : String(error)}` };
    }
    const restored = await restoreOperatorPriorRegion(input.worktree, input.host, stored.record.operator!.priorRegion);
    if (restored.kind === 'refused') return restored;
    const record: RouteRecord = {
      ...stored.record,
      operator: { ...stored.record.operator!, abandon: { ...abandon, stage: 'synced' } },
    };
    const wrote = await writeRoutingTransaction(input.worktree, input.slug, [
      { kind: 'update-record', previous: stored, record },
    ], { git });
    if (wrote.kind !== 'updated') return { kind: 'refused', detail: `cannot record abandoned host sync: ${wrote.kind}` };
    stored = await readRouteRecord(input.worktree, input.slug, input.roundId, { git });
    if (stored.kind !== 'record') return { kind: 'refused', detail: `operator round ${input.roundId} is unavailable after host sync` };
  }

  const marker = await readRepairMarker(input.worktree, input.slug, { git });
  if (marker.kind !== 'marker' || marker.marker.roundId !== input.roundId) {
    return { kind: 'refused', detail: `operator round ${input.roundId} repair marker is unavailable for abandon` };
  }
  const abandoned = transitionHost(stored, input.host, 'abandoned', { credit: false });
  if (abandoned.kind !== 'updated') return { kind: 'refused', detail: `operator host ${input.host} cannot enter abandoned` };
  const record = withOutboxEvent(
    abandoned.record,
    operatorRoundEvent(abandoned.record.roundId, abandoned.record.operator!, input.host, 'abandoned'),
  );
  const wrote = await writeRoutingTransaction(input.worktree, input.slug, [
    { kind: 'update-record', previous: stored, record },
    { kind: 'delete-marker', old: marker.blob },
  ], { git });
  return wrote.kind === 'updated'
    ? { kind: 'abandoned' }
    : { kind: 'refused', detail: `cannot finalize operator abandon: ${wrote.kind}` };
}
