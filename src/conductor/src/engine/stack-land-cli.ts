import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import type { StackLandDispatch, StackLandDoneDispatch, StackLandOpenDispatch } from '../cli.js';
import { ConductorEventEmitter } from '../ui/events.js';
import { parseChildId, type ChildId } from './child-context.js';
import { resolveCliFeatureWorktree, resolveMachineOperatorIdentity } from './cli-operator-authority.js';
import { acquireFeatureDispatchLease, type FeatureDispatchLeaseAcquireResult } from './feature-dispatch-lease.js';
import { HALT_CLASS_MARKER, HALT_MARKER } from './halt-marker.js';
import { createOwnedPark, releaseOwnedPark, resolveMainRepoRoot, type OwnedParkCreationResult } from './park-marker.js';
import { clearHaltAtomically } from './rewind.js';
import {
  checkDeclareOperatorRound,
  checkOpenOperatorRound,
  declareOperatorRound,
  openOperatorRound,
  parseOperatorHaltReason,
  checkOperatorTips,
  type CheckOpenOperatorRoundResult,
  type CheckDeclareOperatorRoundResult,
  type DeclareOperatorRoundResult,
  type OpenOperatorRoundResult,
} from './routing/operator-round.js';
import { nextRoundId, readRepairMarker, readRouteRecord } from './routing/route-record-store.js';
import type { CarriedOperatorChild, RoundId } from './routing/route-types.js';

export interface StackLandCliDeps {
  readonly cwd?: string;
  readonly print?: (message: string) => void;
  readonly resolveMainRoot?: (cwd: string) => Promise<string>;
  readonly resolveWorktree?: (slug: string) => Promise<string | undefined>;
  readonly checkOpen?: typeof checkOpenOperatorRound;
  readonly acquireLease?: typeof acquireFeatureDispatchLease;
  readonly createPark?: typeof createOwnedPark;
  readonly resolveOperator?: (root: string) => Promise<string | undefined>;
  readonly nextRound?: typeof nextRoundId;
  readonly openRound?: typeof openOperatorRound;
  readonly readRepairMarker?: typeof readRepairMarker;
  readonly readRouteRecord?: typeof readRouteRecord;
  readonly clearHalt?: (worktree: string) => Promise<void>;
  readonly checkDeclare?: typeof checkDeclareOperatorRound;
  readonly declareRound?: typeof declareOperatorRound;
  readonly releasePark?: typeof releaseOwnedPark;
  readonly clearMatchingHalt?: (worktree: string, roundId: RoundId) => Promise<'cleared' | 'absent' | 'unrelated'>;
  readonly emitter?: ConductorEventEmitter;
}

function leaseRefusal(result: Exclude<FeatureDispatchLeaseAcquireResult, { readonly kind: 'acquired' }>): string {
  switch (result.kind) {
    case 'live-owner':
      return `feature dispatch lease is held by ${result.owner.purpose} (pid ${result.owner.pid})`;
    case 'unreadable-owner':
      return `feature dispatch lease owner is unreadable at ${result.leasePath}`;
    case 'recovery-in-progress':
      return `feature dispatch lease recovery is in progress at ${result.leasePath}`;
    case 'unavailable':
      return result.message;
  }
}

async function clearUnlandedClosedChildCommitsHalt(worktree: string): Promise<void> {
  const halt = join(worktree, HALT_MARKER);
  let body: string;
  try {
    body = await readFile(halt, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (!body.startsWith('unlanded-closed-child-commits:')) return;
  await unlink(halt);
  await unlink(join(worktree, HALT_CLASS_MARKER)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

function parsedChildren(command: StackLandOpenDispatch): { readonly host: ChildId; readonly carry: readonly ChildId[] } | undefined {
  const host = parseChildId(command.child);
  const carry = command.carry.map(parseChildId);
  if (host === undefined || carry.some((child) => child === undefined)) return undefined;
  return { host, carry: carry as readonly ChildId[] };
}

function refused(print: (message: string) => void, detail: string): number {
  print(`stack land: refused — ${detail}`);
  return 1;
}

interface OpenAdmission {
  readonly host: ChildId;
  readonly carried: readonly CarriedOperatorChild[];
  readonly roundId?: RoundId;
}

/**
 * A marker may be the durable middle of this exact command's prior attempt.
 * Only that exact operator record is resumable; every other open round remains
 * the predicate's immutable refusal.
 */
async function resumableAdmission(
  worktree: string,
  slug: string,
  host: ChildId,
  carry: readonly ChildId[],
  reason: string,
  readMarker: typeof readRepairMarker,
  readRecord: typeof readRouteRecord,
): Promise<OpenAdmission | undefined> {
  const marker = await readMarker(worktree, slug);
  if (marker.kind !== 'marker' || marker.marker.host !== host) return undefined;
  const stored = await readRecord(worktree, slug, marker.marker.roundId);
  if (stored.kind !== 'record' || stored.record.kind !== 'operator' || stored.record.operator?.origin !== 'land') return undefined;
  const operator = stored.record.operator;
  if (operator.reason !== reason.trim()) return undefined;
  const requested = [...new Set(carry)].sort((left, right) => left - right);
  const recorded = operator.carried.map((entry) => entry.child).sort((left, right) => left - right);
  if (requested.length !== recorded.length || requested.some((child, index) => child !== recorded[index])) return undefined;
  return { host, carried: operator.carried, roundId: marker.marker.roundId };
}

async function clearMatchingOperatorHalt(worktree: string, roundId: RoundId): Promise<'cleared' | 'absent' | 'unrelated'> {
  let body: string;
  try {
    body = await readFile(join(worktree, HALT_MARKER), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'absent';
    throw error;
  }
  const match = body.split(/\r?\n/).map(parseOperatorHaltReason).find((reason) => reason?.roundId === roundId &&
    (reason.reason === 'operator-round-undeclared' || reason.reason === 'operator-round-branch-moved'));
  if (match === undefined) return 'unrelated';
  await clearHaltAtomically(worktree);
  return 'cleared';
}

async function clearResolvedBranchMovedHalt(worktree: string, slug: string, roundId: RoundId): Promise<void> {
  let body: string;
  try {
    body = await readFile(join(worktree, HALT_MARKER), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const matches = body.split(/\r?\n/).map(parseOperatorHaltReason)
    .some((reason) => reason?.roundId === roundId && reason.reason === 'operator-round-branch-moved');
  if (!matches) return;
  const stored = await readRouteRecord(worktree, slug, roundId);
  if (stored.kind !== 'record') return;
  const tips = await checkOperatorTips({ worktree, slug, record: stored.record });
  if (tips.kind === 'clear') await clearHaltAtomically(worktree);
}

async function readRoundFromMarker(worktree: string, slug: string): Promise<{ readonly roundId: RoundId; readonly host: ChildId } | undefined> {
  const marker = await readRepairMarker(worktree, slug);
  return marker.kind === 'marker' ? marker.marker : undefined;
}

async function dispatchStackLandDoneCommand(command: StackLandDoneDispatch, deps: StackLandCliDeps): Promise<number> {
  const print = deps.print ?? ((message: string) => process.stderr.write(`${message}\n`));
  const cwd = deps.cwd ?? process.cwd();
  const root = await (deps.resolveMainRoot ?? resolveMainRepoRoot)(cwd);
  const worktree = await (deps.resolveWorktree ?? ((slug) => resolveCliFeatureWorktree(slug, { cwd, resolveMainRoot: deps.resolveMainRoot })))(command.slug);
  if (worktree === undefined) return refused(print, `feature '${command.slug}' is unavailable.`);
  const marker = await readRoundFromMarker(worktree, command.slug);
  if (marker === undefined) return refused(print, 'no open operator landing is available to declare.');
  const acquired = await (deps.acquireLease ?? acquireFeatureDispatchLease)(root, command.slug, 'stack land --done');
  if (acquired.kind !== 'acquired') return refused(print, leaseRefusal(acquired));
  try {
    const checked: CheckDeclareOperatorRoundResult = await (deps.checkDeclare ?? checkDeclareOperatorRound)({
      worktree, slug: command.slug, roundId: marker.roundId, host: marker.host,
    });
    if (checked.kind === 'refused') return refused(print, checked.detail);
    const declared: DeclareOperatorRoundResult = await (deps.declareRound ?? declareOperatorRound)({
      worktree, slug: command.slug, roundId: marker.roundId, host: marker.host, checked,
    });
    if (declared.kind === 'refused') return refused(print, declared.detail);
    const cleared = await (deps.clearMatchingHalt ?? clearMatchingOperatorHalt)(worktree, marker.roundId);
    if (cleared === 'unrelated') print('stack land: declaration succeeded, but an unrelated needs-human HALT remains.');
    if (checked.stored.record.operator?.park !== undefined) {
      await (deps.releasePark ?? releaseOwnedPark)(root, command.slug, checked.stored.record.operator.park.token);
    }
    print(`stack land: declared ${marker.roundId} on child ${marker.host}. Next: daemon dispatch re-validates child ${marker.host} from acceptance_specs.`);
    return 0;
  } catch (error) {
    return refused(print, error instanceof Error ? error.message : String(error));
  } finally {
    const released = await acquired.lease.release();
    if (!released.ok) print(`stack land: refused — ${released.message}`);
  }
}

/**
 * Open an operator-owned landing. The read-only admission predicate runs
 * before a lease or park exists so ordinary refusals leave no operator state.
 */
export async function dispatchStackLandCommand(command: StackLandDispatch, deps: StackLandCliDeps = {}): Promise<number> {
  if (command.kind === 'stack-land-done') return dispatchStackLandDoneCommand(command, deps);
  const print = deps.print ?? ((message: string) => process.stderr.write(`${message}\n`));
  const parsed = parsedChildren(command);
  if (parsed === undefined) return refused(print, 'invalid child or --carry value.');
  if (!command.reason.trim()) return refused(print, 'a non-empty --reason is required.');

  const cwd = deps.cwd ?? process.cwd();
  const root = await (deps.resolveMainRoot ?? resolveMainRepoRoot)(cwd);
  const worktree = await (deps.resolveWorktree ?? ((slug) => resolveCliFeatureWorktree(slug, {
    cwd,
    resolveMainRoot: deps.resolveMainRoot,
  })))(command.slug);
  if (worktree === undefined) return refused(print, `feature '${command.slug}' is unavailable.`);

  const check = deps.checkOpen ?? checkOpenOperatorRound;
  const checked: CheckOpenOperatorRoundResult = await check({
    worktree, slug: command.slug, child: parsed.host, carry: parsed.carry, reason: command.reason,
  });
  let admission: OpenAdmission;
  if (checked.kind === 'accepted') {
    admission = { host: checked.host, carried: checked.carried };
  } else if (checked.refusal.kind === 'round-open') {
    const resumed = await resumableAdmission(
      worktree,
      command.slug,
      parsed.host,
      parsed.carry,
      command.reason,
      deps.readRepairMarker ?? readRepairMarker,
      deps.readRouteRecord ?? readRouteRecord,
    );
    if (resumed === undefined) return refused(print, checked.refusal.text);
    admission = resumed;
  } else {
    return refused(print, checked.refusal.text);
  }

  // Authority is checked before taking either durable coordination primitive.
  const operator = await (deps.resolveOperator ?? resolveMachineOperatorIdentity)(root);
  if (!operator?.trim()) return refused(print, 'no approved operator identity is available.');

  const acquired = await (deps.acquireLease ?? acquireFeatureDispatchLease)(root, command.slug, 'stack land');
  if (acquired.kind !== 'acquired') return refused(print, leaseRefusal(acquired));

  try {
    const roundId = admission.roundId ?? await (deps.nextRound ?? nextRoundId)(worktree, command.slug);
    if (typeof roundId !== 'string') return refused(print, roundId === 'round-limit' ? 'routing round limit is reached.' : 'cannot allocate a routing round.');

    const park: OwnedParkCreationResult = await (deps.createPark ?? createOwnedPark)(root, command.slug);

    const result: OpenOperatorRoundResult = await (deps.openRound ?? openOperatorRound)({
      worktree,
      slug: command.slug,
      roundId,
      host: admission.host,
      reason: command.reason.trim(),
      operator: operator.trim(),
      carried: admission.carried,
      ...(park.created ? { park: { token: park.token } } : {}),
      emitter: deps.emitter ?? new ConductorEventEmitter(),
    });
    if (result.kind === 'refused') return refused(print, result.detail);

    await (deps.clearHalt ?? clearUnlandedClosedChildCommitsHalt)(worktree);
    await clearResolvedBranchMovedHalt(worktree, command.slug, roundId);
    print(`stack land: opened ${roundId} on child ${admission.host}.`);
    return 0;
  } catch (error) {
    return refused(print, error instanceof Error ? error.message : String(error));
  } finally {
    // An owned park stays through both a completed landing and a recoverable
    // partial opening. Task 11 alone releases its recorded capability at --done.
    const released = await acquired.lease.release();
    if (!released.ok) print(`stack land: refused — ${released.message}`);
  }
}
