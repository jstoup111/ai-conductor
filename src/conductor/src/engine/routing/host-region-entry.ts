import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ConductorEventEmitter } from '../../ui/events.js';
import { resolveFeaturePlanPath } from '../artifacts.js';
import { checkStepCompletion, type CompletionContext } from '../artifacts.js';
import { writeFrozenBlocks } from '../remediation-append.js';
import { admitRoutedObligation, restageExistingRemediationTaskStatuses } from '../repair-restage.js';
import { seedTaskStatus } from '../task-seed.js';
import { parseCommitSha, type CommitSha } from '../restack/restack-types.js';
import { createRoutedConductStateStore } from '../conduct-state-store.js';
import type { ChildId } from '../child-context.js';
import { childBranchFor, leafBranchFor } from '../feature-branch-identity.js';
import { makeGitRunner, type GitRunner } from '../rebase.js';
import { switchToChild, type ChildLifecycleTarget } from '../child-lifecycle.js';
import type { StateMutation } from '../conduct-state-store.js';
import { readRestackJournal } from '../restack/restack-journal.js';
import { grantRoutedRepairCredit } from './round-receipt.js';
import { resolveGitRef } from './git-ref-resolver.js';
import { readRevalidationQueue, readRouteRecord, routingFenceOpen, transitionHost, writeRoutingTransaction } from './route-record-store.js';
import { closureRefFor } from './routing-refs.js';
import { redRefFor } from './routing-refs.js';
import { parseRoutedAcceptanceRunContract, parseRoutedRedRecord, type RoutedAcceptanceRunContract } from './red-record.js';
import { assertNever, type RouteRecord, type RoutedObligation, type RoundId } from './route-types.js';
import type { ConductState } from '../../types/state.js';

export type EnterHostRegionResult =
  | { readonly kind: 'entered'; readonly pinnedBase: CommitSha }
  | { readonly kind: 'resume'; readonly pinnedBase: CommitSha }
  /** The audit route has no runnable host-local BUILD work. */
  | { readonly kind: 'derived-already-complete'; readonly detail: string }
  | { readonly kind: 'halted'; readonly detail: string }
  | { readonly kind: 'refused'; readonly detail: string };

export interface EnterHostRegionInput {
  readonly worktree: string;
  readonly slug: string;
  readonly roundId: RoundId;
  readonly host: ChildId;
  readonly emitter: ConductorEventEmitter;
  /** The conductor-resolved plan path; direct callers may use feature resolution. */
  readonly planPath?: string;
  /** Freshness/configuration context for the host-local BUILD completion check. */
  readonly completionContext?: CompletionContext;
  /** Injectable completion boundary for the host-entry no-op decision. */
  readonly checkCompletion?: typeof checkStepCompletion;
  readonly git?: GitRunner;
}

export interface VerifyGreenAcceptanceInput {
  readonly worktree: string;
  readonly slug: string;
  readonly roundId: RoundId;
  readonly host: ChildId;
  readonly exec: (command: string, cwd: string) => Promise<unknown>;
  readonly git?: GitRunner;
}

export type VerifyGreenAcceptanceResult =
  | { readonly kind: 'verified'; readonly headSha: string }
  | { readonly kind: 'refused'; readonly reason: string };

const VERIFY_GREEN_RECORD = 'acceptance-verify-green.json';

async function redMarkerDigestRefusal(
  marker: string | undefined,
  ref: string,
  refExitCode: number,
  refSha: string,
  git: GitRunner,
  host: ChildId,
): Promise<string | undefined> {
  if (marker === undefined || refExitCode === 1) return undefined;
  const parsed = JSON.parse(marker) as Record<string, unknown>;
  if (!Array.isArray(parsed.failingTests) || typeof parsed.intentRationale !== 'string') return undefined;
  const blob = await git(['cat-file', '-p', refSha.trim()]);
  const digest = createHash('sha256').update(marker, 'utf8').digest('hex');
  return blob.exitCode === 0 && parseRoutedRedRecord(blob.stdout)?.digest === digest
    ? undefined
    : `child ${host} RED marker digest differs from ${ref}`;
}

async function durableRedContract(
  git: GitRunner,
  slug: string,
  host: ChildId,
): Promise<RoutedAcceptanceRunContract | undefined> {
  const ref = redRefFor(slug, host);
  const resolved = await git(['rev-parse', '-q', '--verify', ref]);
  if (resolved.exitCode !== 0) return undefined;
  const blob = await git(['cat-file', '-p', resolved.stdout.trim()]);
  return blob.exitCode === 0 ? parseRoutedRedRecord(blob.stdout)?.contract : undefined;
}

/**
 * Re-runs an already-closed routed child's recorded acceptance contract.  It
 * intentionally does not create or heal RED evidence: a routed repair proves
 * its own current green result, while the retained RED marker is only an
 * optional integrity comparison with the close-time ref.
 */
export async function verifyGreenAcceptance(input: VerifyGreenAcceptanceInput): Promise<VerifyGreenAcceptanceResult> {
  const git = input.git ?? makeGitRunner(input.worktree);
  const childDir = join(input.worktree, '.pipeline', 'children', String(input.host));
  const recordPath = join(childDir, VERIFY_GREEN_RECORD);
  let contract: RoutedAcceptanceRunContract | undefined;
  try {
    contract = parseRoutedAcceptanceRunContract(JSON.parse(await readFile(join(childDir, 'acceptance-specs-run.json'), 'utf8')));
  } catch {
    // The worktree overlay is disposable; the close-time red ref retains the
    // executable pair needed after recreation.
  }
  if (contract === undefined) {
    try { contract = await durableRedContract(git, input.slug, input.host); } catch {
      return { kind: 'refused', reason: `child ${input.host} acceptance run contract is missing or invalid` };
    }
  }
  if (contract === undefined) {
    // A disposition-only child closed with no acceptance run: every criterion
    // is proven below this layer, so there is nothing to re-run.  Only the
    // close-time digest can vouch for the marker, so it must match exactly.
    const verified = await dispositionOnlyVerified(childDir, git, input.slug, input.host);
    if (verified) return recordVerifiedGreen(git, childDir, recordPath, input);
    return { kind: 'refused', reason: `child ${input.host} acceptance run contract is missing command or cwd` };
  }
  let observed: Record<string, unknown>;
  try {
    const value = await input.exec(contract.command, resolve(input.worktree, contract.cwd));
    observed = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch (error) {
    return { kind: 'refused', reason: `child ${input.host} verify-green execution failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  const executed = observed.executed;
  const passed = observed.passed;
  const failed = observed.failed;
  const skipped = observed.skipped;
  const errors = observed.errors;
  if (!(typeof executed === 'number' && executed >= 1 && typeof passed === 'number' && passed === executed &&
    failed === 0 && skipped === 0 && errors === 0)) {
    return { kind: 'refused', reason: `child ${input.host} verify-green requires every spec to pass (executed >= 1, failed/skipped/errors == 0)` };
  }
  let marker: string | undefined;
  try { marker = await readFile(join(childDir, 'acceptance-specs-red.json'), 'utf8'); } catch { /* legacy marker is optional */ }
  try {
    const ref = redRefFor(input.slug, input.host);
    const refResult = await git(['rev-parse', '-q', '--verify', ref]);
    if (refResult.exitCode !== 0 && refResult.exitCode !== 1) {
      return { kind: 'refused', reason: `cannot resolve ${ref}` };
    }
    const refusal = await redMarkerDigestRefusal(marker, ref, refResult.exitCode, refResult.stdout, git, input.host);
    if (refusal !== undefined) return { kind: 'refused', reason: refusal };
  } catch {
    return { kind: 'refused', reason: `child ${input.host} RED marker or ref is invalid` };
  }
  return recordVerifiedGreen(git, childDir, recordPath, input);
}

async function dispositionOnlyVerified(childDir: string, git: GitRunner, slug: string, host: ChildId): Promise<boolean> {
  try {
    const marker = await readFile(join(childDir, 'acceptance-specs-red.json'), 'utf8');
    if ((JSON.parse(marker) as Record<string, unknown>).outcome !== 'disposition-only') return false;
    const ref = await git(['rev-parse', '-q', '--verify', redRefFor(slug, host)]);
    if (ref.exitCode !== 0) return false;
    const blob = await git(['cat-file', '-p', ref.stdout.trim()]);
    const digest = createHash('sha256').update(marker, 'utf8').digest('hex');
    return blob.exitCode === 0 && parseRoutedRedRecord(blob.stdout)?.digest === digest;
  } catch {
    return false;
  }
}

async function recordVerifiedGreen(
  git: GitRunner,
  childDir: string,
  recordPath: string,
  input: VerifyGreenAcceptanceInput,
): Promise<VerifyGreenAcceptanceResult> {
  const resolvedHead = await resolveGitRef(git, 'HEAD');
  if (typeof resolvedHead !== 'string') return { kind: 'refused', reason: `cannot resolve child ${input.host} host tip for verify-green` };
  const head = resolvedHead;
  await mkdir(childDir, { recursive: true });
  await writeFile(recordPath, JSON.stringify({ roundId: input.roundId, host: input.host, headSha: head, done: true }) + '\n');
  return { kind: 'verified', headSha: head };
}

function terminalJournal(journal: Awaited<ReturnType<typeof readRestackJournal>>): boolean {
  return routingFenceOpen(journal);
}

async function hostTarget(
  git: GitRunner,
  slug: string,
  host: ChildId,
): Promise<{ readonly target: ChildLifecycleTarget; readonly pinnedBase: CommitSha; readonly tree: CommitSha } | { readonly detail: string }> {
  let closure: CommitSha | undefined;
  try {
    const result = await git(['rev-parse', '-q', '--verify', closureRefFor(slug, host)]);
    if (result.exitCode === 0) {
      closure = parseCommitSha(result.stdout.trim());
      if (!closure) return { detail: `cannot parse host ${host} closure` };
    } else if (result.exitCode !== 1) {
      return { detail: `cannot resolve host ${host} closure` };
    }
  } catch {
    return { detail: `cannot resolve host ${host} closure` };
  }
  const isLeaf = closure === undefined;
  const resolvedBase = closure ?? await resolveGitRef(git, `refs/heads/${leafBranchFor(slug)}`);
  if (typeof resolvedBase !== 'string') return { detail: `cannot resolve host ${host} closure or leaf tip` };
  const pinnedBase = resolvedBase;
  const resolvedTree = await resolveGitRef(git, `${pinnedBase}^{tree}`);
  if (typeof resolvedTree !== 'string') return { detail: `cannot resolve tree for host ${host} base ${pinnedBase}` };
  const tree = resolvedTree;
  if (isLeaf) return { target: { child: host, position: host, branch: leafBranchFor(slug) }, pinnedBase, tree };
  const branch = childBranchFor(slug, host);
  if (!branch.ok) return { detail: branch.reason };
  return { target: { child: host, position: host, branch: branch.branch }, pinnedBase, tree };
}

async function verifyOrSwitch(
  input: EnterHostRegionInput,
  target: ChildLifecycleTarget,
  git: GitRunner,
): Promise<{ readonly kind: 'completed' } | { readonly kind: 'refused'; readonly detail: string }> {
  try {
    const current = await git(['symbolic-ref', '--short', 'HEAD']);
    if (current.exitCode !== 0) return { kind: 'refused', detail: 'cannot determine current branch before host switch' };
    if (current.stdout.trim() === target.branch) return { kind: 'completed' };
  } catch {
    return { kind: 'refused', detail: 'cannot determine current branch before host switch' };
  }
  const switched = await switchToChild(input.worktree, target, input.emitter, undefined, { git });
  return switched.kind === 'completed'
    ? switched
    : { kind: 'refused', detail: 'reason' in switched ? switched.reason : `cannot switch to host branch ${target.branch}` };
}

async function restageHostRegion(
  worktree: string,
  slug: string,
  host: ChildId,
  record: RouteRecord,
  git: GitRunner,
): Promise<{ readonly kind: 'restaged' } | { readonly kind: 'refused'; readonly detail: string }> {
  switch (record.kind) {
    case 'audit': {
      const state = createRoutedConductStateStore(worktree, host);
      const current = await state.read();
      if (!current.ok) return { kind: 'refused', detail: `cannot read host ${host} region state: ${current.error.message}` };
      const result = await state.applyBatch({
        name: `restage routed host ${host} region`,
        mutations: (['acceptance_specs', 'build', 'test_suite', 'build_review'] as const).map((step) => ({
          field: step,
          expected: current.value[step],
          next: 'pending',
          intent: `restage routed host ${host} ${step}`,
        } as StateMutation<ConductState>)),
      });
      return 'message' in result
        ? { kind: 'refused', detail: `cannot restage host ${host} region: ${result.message}` }
        : { kind: 'restaged' };
    }
    case 'revalidate': {
      const queue = await readRevalidationQueue(worktree, slug, { git });
      const entry = queue.kind === 'queue' ? queue.queue.entries.find((candidate) => candidate.child === host) : undefined;
      if (!entry) return { kind: 'refused', detail: `revalidate host ${host} has no queued entry` };
      const state = createRoutedConductStateStore(worktree, host);
      const current = await state.read();
      if (!current.ok) return { kind: 'refused', detail: `cannot read host ${host} region state: ${current.error.message}` };
      const mutations = entry.gates
        .filter((step) => current.value[step] !== 'pending')
        .map((step) => ({ field: step, expected: current.value[step], next: 'pending', intent: `restage revalidate host ${host} ${step}` } as StateMutation<ConductState>));
      if (mutations.length === 0) return { kind: 'restaged' };
      const result = await state.applyBatch({ name: `restage revalidate host ${host} region`, mutations });
      return 'message' in result ? { kind: 'refused', detail: `cannot restage revalidate host ${host}: ${result.message}` } : { kind: 'restaged' };
    }
    case 'operator': {
      const operator = record.operator;
      if (operator === undefined) return { kind: 'refused', detail: `operator host ${host} has no operator context` };
      const state = createRoutedConductStateStore(worktree, host);
      const current = await state.read();
      if (!current.ok) return { kind: 'refused', detail: `cannot read host ${host} region state: ${current.error.message}` };
      const orderedSteps = ['acceptance_specs', 'build', 'test_suite', 'build_review'] as const;
      const restageSteps = operator.origin === 'land'
        ? (['acceptance_specs', 'test_suite', 'build_review'] as const)
        : orderedSteps.slice(orderedSteps.indexOf(operator.entryStep));
      const mutations = restageSteps
        .filter((step) => current.value[step] !== 'pending')
        .map((step) => ({ field: step, expected: current.value[step], next: 'pending', intent: `restage operator host ${host} ${step}` } as StateMutation<ConductState>));
      if (mutations.length === 0) return { kind: 'restaged' };
      const result = await state.applyBatch({ name: `restage operator host ${host} region`, mutations });
      return 'message' in result ? { kind: 'refused', detail: `cannot restage operator host ${host}: ${result.message}` } : { kind: 'restaged' };
    }
  }
  return assertNever(record.kind);
}

async function bindHostObligations(
  input: EnterHostRegionInput,
  record: RouteRecord,
  planPath: string,
  branch: string,
  head: CommitSha,
): Promise<{ readonly kind: 'bound'; readonly record: RouteRecord } | { readonly kind: 'refused'; readonly detail: string }> {
  if (record.entry === undefined || record.entry.host !== input.host) {
    return { kind: 'refused', detail: `routing host ${input.host} entry is missing its durable tree baseline` };
  }
  const bindings = new Map<string, RoutedObligation>();
  for (const item of record.items) {
    if (item.host !== input.host || item.existingTask !== true) continue;
    const admitted = await admitRoutedObligation({
      projectRoot: input.worktree,
      planPath,
      roundId: record.roundId,
      findingId: item.findingId,
      taskIds: item.taskIds,
      branch,
      head,
      tree: record.entry.tree,
    });
    if (admitted.kind === 'failed') return { kind: 'refused', detail: admitted.detail };
    const admittedHead = parseCommitSha(admitted.obligation.baseline.head);
    const admittedTree = parseCommitSha(admitted.obligation.baseline.tree);
    if (admitted.obligation.baseline.branch === undefined || !admittedHead || !admittedTree) {
      return { kind: 'refused', detail: `routed obligation ${admitted.obligation.id} has an invalid host boundary` };
    }
    bindings.set(item.findingId, {
      branch: admitted.obligation.baseline.branch,
      head: admittedHead,
      tree: admittedTree,
    });
    if (item.restage !== false) {
      const restaged = await restageExistingRemediationTaskStatuses(input.worktree, planPath, new Set(item.taskIds));
      if (restaged.kind === 'failed') return { kind: 'refused', detail: restaged.detail };
    }
  }
  return {
    kind: 'bound',
    record: {
      ...record,
      items: record.items.map((item) => {
        const obligation = bindings.get(item.findingId);
        return obligation === undefined || item.existingTask !== true ? item : { ...item, obligation };
      }),
    },
  };
}

async function reconcileHostObligations(
  input: EnterHostRegionInput,
  record: RouteRecord,
  planPath: string,
): Promise<{ readonly kind: 'reconciled' } | { readonly kind: 'refused'; readonly detail: string }> {
  for (const item of record.items) {
    if (item.host !== input.host || item.existingTask !== true) continue;
    if (item.obligation === undefined) {
      return { kind: 'refused', detail: `routing item ${item.findingId} is missing its host obligation binding` };
    }
    const admitted = await admitRoutedObligation({
      projectRoot: input.worktree,
      planPath,
      roundId: record.roundId,
      findingId: item.findingId,
      taskIds: item.taskIds,
      ...item.obligation,
    });
    if (admitted.kind === 'failed') return { kind: 'refused', detail: admitted.detail };
  }
  return { kind: 'reconciled' };
}

/**
 * Pins and enters the selected routed host exactly once before its BUILD
 * region can run.  Frozen blocks are committed before the host becomes
 * repairing, so a resume cannot dispatch an unseeded, uncommitted repair.
 */
export async function enterHostRegion(input: EnterHostRegionInput): Promise<EnterHostRegionResult> {
  const git = input.git ?? makeGitRunner(input.worktree);
  const journal = await readRestackJournal(input.worktree, input.slug, { git });
  if (!terminalJournal(journal)) {
    return { kind: 'refused', detail: journal.kind === 'unreadable' ? 'restack journal is unreadable' : 'restack journal is non-terminal' };
  }

  let stored = await readRouteRecord(input.worktree, input.slug, input.roundId, { git });
  if (stored.kind !== 'record') return { kind: 'refused', detail: `routing record ${input.roundId} is unavailable` };
  const hostState = stored.record.hosts[input.host];
  if (hostState !== 'admitted' && hostState !== 'repairing') {
    return { kind: 'refused', detail: `routing round ${input.roundId} host ${input.host} is not admitted` };
  }

  const resolved = await hostTarget(git, input.slug, input.host);
  if ('detail' in resolved) return { kind: 'refused', detail: resolved.detail };
  let pinnedBase = stored.record.entry?.host === input.host ? stored.record.entry.pinnedBase : undefined;
  if (stored.record.entry?.host !== input.host) {
    let revalidation: { readonly queueBlob: CommitSha; readonly generation: number; readonly closureSha: CommitSha } | undefined;
    const queue = await readRevalidationQueue(input.worktree, input.slug, { git });
    const queued = queue.kind === 'queue' ? queue.queue.entries.find((candidate) => candidate.child === input.host) : undefined;
    switch (stored.record.kind) {
      case 'revalidate':
        if (!queued || queue.kind !== 'queue') {
          return { kind: 'refused', detail: `revalidate host ${input.host} has no queued entry to pin` };
        }
        revalidation = { queueBlob: queue.blob, generation: queue.queue.generation, closureSha: queued.closureSha };
        break;
      case 'audit':
        if (queued && queue.kind === 'queue') {
          revalidation = { queueBlob: queue.blob, generation: queue.queue.generation, closureSha: queued.closureSha };
        }
        break;
      case 'operator':
        break;
      default:
        return assertNever(stored.record.kind);
    }
    const next = {
      ...stored.record,
      entry: { host: input.host, pinnedBase: resolved.pinnedBase, tree: resolved.tree, ...(revalidation === undefined ? {} : { revalidation }) },
    };
    const wrote = await writeRoutingTransaction(input.worktree, input.slug, [
      { kind: 'update-record', previous: stored, record: next },
    ], { git });
    if (wrote.kind !== 'updated') return { kind: 'refused', detail: `cannot pin routing host entry: ${wrote.kind}` };
    pinnedBase = resolved.pinnedBase;
    stored = await readRouteRecord(input.worktree, input.slug, input.roundId, { git });
    if (stored.kind !== 'record') return { kind: 'refused', detail: `routing record ${input.roundId} is unavailable after pin` };
  }

  const switched = await verifyOrSwitch(input, resolved.target, git);
  if (switched.kind === 'refused') return switched;
  const planPath = input.planPath ?? await resolveFeaturePlanPath(input.worktree, input.slug);
  if (!planPath) return { kind: 'refused', detail: `cannot resolve routed host plan for ${input.slug}` };
  if (stored.record.hosts[input.host] === 'repairing') {
    const reconciled = await reconcileHostObligations(input, stored.record, planPath);
    if (reconciled.kind === 'refused') return reconciled;
    try {
      await seedTaskStatus(input.worktree, planPath, undefined, {
        childBase: { slug: input.slug, child: input.host },
      });
    } catch (error) {
      return { kind: 'refused', detail: `cannot reconcile routed task status: ${error instanceof Error ? error.message : String(error)}` };
    }
    const credit = await grantRoutedRepairCredit({
      projectRoot: input.worktree,
      child: input.host,
      roundId: input.roundId,
    });
    return credit.kind === 'refused'
      ? { kind: 'refused', detail: `cannot reconcile routed repair credit: ${credit.detail}` }
      : { kind: 'resume', pinnedBase: pinnedBase! };
  }

  const restaged = await restageHostRegion(input.worktree, input.slug, input.host, stored.record, git);
  if (restaged.kind === 'refused') return restaged;

  const resolvedEntryHead = await resolveGitRef(git, 'HEAD');
  if (typeof resolvedEntryHead !== 'string') return { kind: 'refused', detail: `cannot resolve host ${input.host} tip at region entry` };
  const entryHead = resolvedEntryHead;
  const allocation = stored.record.allocation[input.host];
  if (!allocation) return { kind: 'refused', detail: `routing round ${input.roundId} has no frozen allocation for host ${input.host}` };
  const appended = await writeFrozenBlocks({
    worktree: input.worktree,
    planPath,
    roundId: input.roundId,
    host: input.host,
    allocation,
    slug: input.slug,
    git,
  });
  if (appended.kind === 'halted') return appended;
  if (appended.kind === 'refused') return appended;

  const bound = await bindHostObligations(input, stored.record, planPath, resolved.target.branch, entryHead);
  if (bound.kind === 'refused') return bound;

  try {
    await seedTaskStatus(input.worktree, planPath, undefined, {
      childBase: { slug: input.slug, child: input.host },
    });
  } catch (error) {
    return { kind: 'refused', detail: `cannot seed routed task status: ${error instanceof Error ? error.message : String(error)}` };
  }

  // An audit route can arrive after every task it projected to this host has
  // already acquired current evidence.  Check at the host boundary, after
  // frozen blocks and existing-task restages are visible, so a pending frozen
  // task still dispatches and an N=1 route keeps its established planner-side
  // guard.  Do not transition to repairing: no provider may run for a
  // derived no-op round.
  switch (stored.record.kind) {
    case 'audit': {
      const completion = await (input.checkCompletion ?? checkStepCompletion)(input.worktree, 'build', {
        ...input.completionContext,
        projectRoot: input.worktree,
        planPath,
        featureDesc: input.slug,
        activeChild: input.host,
      });
      if (completion.done) {
        return {
          kind: 'derived-already-complete',
          detail:
            `routing audit round ${input.roundId} host ${input.host} has no dispatchable BUILD work; ` +
            'every routed task is already evidence-complete',
        };
      }
      break;
    }
    case 'revalidate':
    case 'operator':
      break;
    default:
      return assertNever(stored.record.kind);
  }
  stored = await readRouteRecord(input.worktree, input.slug, input.roundId, { git });
  if (stored.kind !== 'record') return { kind: 'refused', detail: `routing record ${input.roundId} is unavailable before repairing transition` };
  const recordWithBindings = { ...stored, record: bound.record };
  const repairing = transitionHost(recordWithBindings, input.host, 'repairing', { credit: true });
  if (repairing.kind !== 'updated') return { kind: 'refused', detail: `routing round ${input.roundId} host ${input.host} cannot enter repairing` };
  const transitioned = await writeRoutingTransaction(input.worktree, input.slug, [
    { kind: 'update-record', previous: stored, record: repairing.record },
  ], { git });
  if (transitioned.kind !== 'updated') return { kind: 'refused', detail: `cannot enter repairing: ${transitioned.kind}` };
  const credit = await grantRoutedRepairCredit({
    projectRoot: input.worktree,
    child: input.host,
    roundId: input.roundId,
  });
  if (credit.kind === 'refused') return { kind: 'refused', detail: `cannot grant routed repair credit: ${credit.detail}` };
  return { kind: 'entered', pinnedBase: pinnedBase! };
}
