import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { KICKBACK_BUDGET_GATES, type KickbackBudgetDispatch } from './kickback-budget-command.js';
import { appendCloseoutEvent, appendKickbackBudgetAuthorizationEvent, readKickbackBudgetAuthorizationEvents } from './closeout-events.js';
import { EventPersister } from './event-persister.js';
import { AuditTrailWriter } from './audit-trail.js';
import { ConductorEventEmitter } from './conductor-event-emitter.js';
import { applyKickbackBudgetAdjustment, discardPendingKickbackBudgetAdjustment, isUnreadableKickbackGate, isUnreadableKickbackLedger, readKickbackLedger, stageKickbackBudgetAdjustment, unreadableKickbackGates, type KickbackBudgetAdjustment, type KickbackGateEntry, type KickbackLedger } from './kickback-ledger.js';
import { kickbackBudgetView, renderKickbackBudgetView, withPendingGrowth, type KickbackPlanGrowthView } from './kickback-budget-view.js';
import { createOwnedPark, releaseOwnedPark, resolveMainRepoRoot } from './park-marker.js';
import { isAcceptableOperatorRationale, resolveCliFeatureWorktree, resolveMachineOperatorIdentity } from './cli-operator-authority.js';
import { HALT_CLASS_MARKER } from './halt-marker.js';
import { RECOVERABLE_CAP_HALT_CLASS_BY_GATE } from './halt-classification.js';
import { readKickbackHaltGeneration } from './daemon-rekick.js';
import { loadConfig } from './config.js';
import { kickbackBudgetFallbackLimit, readPlanGrowthBudget, resolveRemediationLapAllowance, type RemediationLapAllowance } from './remediation-caps.js';
import { readState } from './state.js';
import { childStateExists, parseChildId, type ChildId } from './child-context.js';
import { resolveActiveChildForCurrentFeature } from './child-cursor.js';
import { resolveExecutionChild } from './routing/execution-child.js';
import { applyCascadeAdjustment, readCascadeCounts } from './restack/cascade-cap.js';
import { resolveCascadeAllowanceForWorktree, type RestackCascadeAllowance } from './restack/cascade-allowance.js';
import type { HarnessConfig } from '../types/config.js';
import type { ConductorEvent } from '../types/events.js';

const GATES = new Set<string>(KICKBACK_BUDGET_GATES);
const WHOLE_FEATURE_GATES = new Set(['prd_audit', 'architecture_review_as_built', 'manual_test']);

function childCursorRefusal(cursor: Awaited<ReturnType<typeof resolveActiveChildForCurrentFeature>>): string {
  return cursor.kind === 'topology-unavailable' ? `${cursor.kind}: ${cursor.cause}` : cursor.kind;
}

function defaultsToExecutionChild(gate: string | undefined): boolean {
  return gate !== undefined && !WHOLE_FEATURE_GATES.has(gate) && gate === 'build_review';
}

async function executionChildFor(worktree: string): Promise<ChildId | undefined> {
  const cursor = await resolveActiveChildForCurrentFeature(worktree);
  if (cursor.kind !== 'active' && cursor.kind !== 'repair-pending') return undefined;
  const execution = resolveExecutionChild(cursor, 'kickback-budget');
  return 'target' in execution ? execution.target.child : undefined;
}
interface BudgetDefaults {
  limits: Record<string, number>;
  allowances: Partial<Record<string, RemediationLapAllowance>>;
  restackAllowance: RestackCascadeAllowance;
}

async function defaultsFor(worktree: string): Promise<BudgetDefaults> {
  const loaded = await loadConfig(worktree);
  const config = loaded.ok ? loaded.config : {} as HarnessConfig;
  const state = await readState(join(worktree, '.pipeline', 'conduct-state.json'));
  const tier = state.ok ? state.value.complexity_tier : undefined;
  const restackAllowance = await resolveCascadeAllowanceForWorktree(worktree);
  const allowances = Object.fromEntries(
    ['prd_audit', 'architecture_review_as_built'].map((gate) => [
      gate,
      resolveRemediationLapAllowance(gate as 'prd_audit' | 'architecture_review_as_built', config, tier),
    ]),
  ) as Partial<Record<string, RemediationLapAllowance>>;
  return {
    allowances,
    restackAllowance,
    limits: Object.fromEntries(
    [...GATES].map((gate) => [
      gate, gate === 'restack' ? restackAllowance.limit : kickbackBudgetFallbackLimit(gate, config, tier),
    ]),
    ),
  };
}

/** Resolve the shared plan-growth accounting view without consulting halt prose. */
async function planGrowthViewFor(worktree: string, ledger: KickbackLedger): Promise<KickbackPlanGrowthView> {
  const config = await loadConfig(worktree);
  const budget = await readPlanGrowthBudget(worktree, config.ok ? config.config : {} as HarnessConfig, { persist: false });
  return withPendingGrowth({
    ...budget.growth,
    cap: budget.authoredSource === 'unresolved' && budget.capSource === 'config-derived' ? null : budget.cap,
    capSource: budget.capSource,
    authoredSource: budget.authoredSource,
  }, ledger.pendingRepair);
}

export interface KickbackBudgetCliDeps {
  cwd?: string;
  isInteractive?: () => boolean;
  resolveOperator?: () => string | undefined | Promise<string | undefined>;
  print?: (message: string) => void;
  resolveMainRoot?: (cwd: string) => Promise<string>;
  appendEvent?: typeof appendCloseoutEvent;
}

/**
 * The operator CLI is outside a running conductor, so it appends the durable
 * cross-process record and immediately projects that same event through its
 * declared sinks. CloseoutEventTail recognizes the canonical projection and
 * will not replay it later.
 */
async function appendAuthorizationEvent(
  worktree: string,
  event: Extract<ConductorEvent, { type: 'kickback_budget_adjustment_authorized' }>,
  appendEvent?: typeof appendCloseoutEvent,
): Promise<void> {
  if (appendEvent) appendEvent(worktree, event);
  else await appendKickbackBudgetAuthorizationEvent(worktree, event);
  const events = new ConductorEventEmitter();
  const persister = new EventPersister(join(worktree, '.pipeline', 'events.jsonl'), events);
  const audit = new AuditTrailWriter(worktree, { throwOnWriteFailure: true });
  persister.start();
  audit.subscribe(events);
  await events.emit(event);
  persister.stop();
}

async function reconcilePendingAdjustments(worktree: string, slug: string, child?: ChildId): Promise<void> {
  const ledger = await readKickbackLedger(worktree, child);
  // An unreadable ledger is reported by each caller's own unreadable branch, in
  // its own words; reconciliation simply has nothing it may safely act on.
  if (isUnreadableKickbackLedger(ledger)) return;
  let eventText = '';
  try { eventText = await readKickbackBudgetAuthorizationEvents(worktree); }
  catch { throw new Error('authorization event ledger is unreadable'); }
  const { limits: defaults, restackAllowance } = await defaultsFor(worktree);
  for (const [gate, entry] of Object.entries(ledger.gates)) {
    const pending = entry.pendingAdjustment;
    if (!pending || isUnreadableKickbackGate(ledger, gate)) continue;
    const records = eventText.split('\n').filter(Boolean).map((line) => {
      try { return JSON.parse(line) as { adjustmentId?: unknown }; }
      catch { throw new Error('authorization event ledger is unreadable'); }
    });
    const recorded = records.some((event) => event.adjustmentId === pending.id);
    if (!recorded) await discardPendingKickbackBudgetAdjustment(worktree, gate, pending.id, child);
    else {
      if (gate === 'restack') await applyRestackCascadeAdjustment(worktree, slug, pending, entry, restackAllowance.limit);
      await applyKickbackBudgetAdjustment(worktree, gate, pending, gate === 'restack' ? pending.beforeLimit : (defaults[gate] ?? 1), child);
    }
  }
}

function restackOriginatingChild(entry: KickbackGateEntry | undefined): ChildId | undefined {
  const evidence = entry?.capEvidence;
  if (evidence?.gate !== 'restack' || evidence.allowance !== 'restacks') return undefined;
  const matched = /^restack cascade cap for originating child (\d+)$/.exec(evidence.latestReason);
  return matched ? parseChildId(matched[1]) : undefined;
}

async function applyRestackCascadeAdjustment(
  worktree: string,
  slug: string,
  adjustment: KickbackBudgetAdjustment,
  entry: KickbackGateEntry,
  defaultLimit: number,
): Promise<void> {
  const originatingChild = restackOriginatingChild(entry);
  if (originatingChild === undefined) throw new Error('restack cap evidence does not name an originating child');
  const changed = await applyCascadeAdjustment(worktree, slug, {
    id: adjustment.id,
    child: originatingChild,
    beforeConsumed: adjustment.beforeConsumed,
    afterConsumed: adjustment.afterConsumed,
    beforeLimit: adjustment.beforeLimit,
    afterLimit: adjustment.afterLimit,
  }, defaultLimit);
  if (changed.kind === 'stale') throw new Error('cascade counts changed concurrently; no resume authorization was installed');
  if (changed.kind === 'unreadable') throw new Error(changed.detail);
}

/** Dispatch read-only inspect or an interactive, halted-feature-only mutation. */
export async function dispatchKickbackBudgetCommand(command: KickbackBudgetDispatch, deps: KickbackBudgetCliDeps = {}): Promise<number> {
  const print = deps.print ?? console.log;
  const root = await (deps.resolveMainRoot ?? resolveMainRepoRoot)(deps.cwd ?? process.cwd());
  // D3: one shared named-worktree resolution, not a per-command copy.
  const worktree = await resolveCliFeatureWorktree(command.feature, { cwd: deps.cwd, resolveMainRoot: deps.resolveMainRoot });
  if (!worktree) { print(`kickback-budget: feature '${command.feature}' is unavailable.`); return 1; }
  const reconcile = async (child?: ChildId): Promise<number | undefined> => {
    try { await reconcilePendingAdjustments(worktree, command.feature, child); return undefined; }
    catch (error) { print(`kickback-budget: refused — ${error instanceof Error ? error.message : String(error)}`); return 1; }
  };
  if (command.action === 'inspect') {
    const cursor = await resolveActiveChildForCurrentFeature(worktree);
    if (cursor.kind !== 'no-child' && cursor.kind !== 'active' && cursor.kind !== 'repair-pending') {
      print(`kickback-budget: active child resolution refused (${childCursorRefusal(cursor)}).`);
      return 1;
    }
    // `inspect` has no gate selector, so retain its established region view;
    // the resolver makes that view the routed host when a repair is active.
    const selectedChild = command.child ?? (await executionChildFor(worktree))?.toString();
    const child = selectedChild === undefined ? undefined : parseChildId(selectedChild);
    if (selectedChild !== undefined && child === undefined) {
      print(`kickback-budget: invalid child id "${selectedChild}".`);
      return 1;
    }
    if (child !== undefined && !(await childStateExists(worktree, child))) {
      print(`kickback-budget: child ${child} has no child state.`);
      return 1;
    }
    // D5: reconciliation is a COMMAND-ENTRY obligation, not a mutation-path
    // one. The sealed crash windows say "the operator re-runs any
    // kickback-budget command", and `inspect` is the command an operator
    // reaches for first after a crash — a pending record left unreconciled
    // here would render a budget the ledger does not actually hold.
    const refused = await reconcile(child);
    if (refused !== undefined) return refused;
    if (child !== undefined) {
      const refusedFlat = await reconcile(undefined);
      if (refusedFlat !== undefined) return refusedFlat;
    }
    const flatLedger = await readKickbackLedger(worktree);
    const childLedger = child === undefined ? flatLedger : await readKickbackLedger(worktree, child);
    if (isUnreadableKickbackLedger(flatLedger) || isUnreadableKickbackLedger(childLedger)) { print('kickback-budget: ledger is unreadable.'); return 1; }
    const ledgerFor = (gate: string) => WHOLE_FEATURE_GATES.has(gate) ? flatLedger : childLedger;
    const { limits: defaults, allowances } = await defaultsFor(worktree);
    // Resolve plan growth from the same authored-task cap as remediation. A
    // read-only inspect deliberately does not reconcile or persist it.
    const planGrowth = await planGrowthViewFor(worktree, flatLedger);
    // adr-2026-08-31 decision 3: one malformed gate is reported as unavailable;
    // its healthy siblings still render their authoritative values.
    const unavailable = child === undefined
      ? unreadableKickbackGates(flatLedger).filter((gate) => GATES.has(gate))
      : [
          ...unreadableKickbackGates(flatLedger).filter((gate) => GATES.has(gate) && WHOLE_FEATURE_GATES.has(gate)),
          ...unreadableKickbackGates(childLedger).filter((gate) => GATES.has(gate) && !WHOLE_FEATURE_GATES.has(gate)),
        ];
    // `restack` is a per-originating-child pseudo-gate backed by the cascade
    // ref.  A feature without a durable child state has no such budget, and
    // must retain the established N=1 inspect rendering.
    const readable = [...GATES].filter((gate) =>
      !unavailable.includes(gate) && (gate !== 'restack' || child !== undefined),
    );
    const liveHaltGeneration = await readKickbackHaltGeneration(worktree);
    const pendingLaps = (gate: string) =>
      gate === 'prd_audit' || gate === 'architecture_review_as_built'
        ? flatLedger.pendingRepair?.charges[gate]?.laps ?? 0
        : 0;
    const views = readable.map((gate) => kickbackBudgetView(
      ledgerFor(gate).gates[gate], gate, defaults[gate], planGrowth, liveHaltGeneration, pendingLaps(gate), allowances[gate],
    ));
    const human = [
        ...views.map((view) => renderKickbackBudgetView(
          ledgerFor(view.gate).gates[view.gate], view.gate, defaults[view.gate], planGrowth, liveHaltGeneration,
          undefined, pendingLaps(view.gate), allowances[view.gate],
        )),
        ...unavailable.map((gate) => `${gate}: budget unavailable (durable entry failed validation)`),
      ].join('\n\n');
    print(command.format === 'json'
      ? JSON.stringify({ feature: command.feature, ...(child === undefined ? {} : { child }), gates: views, ...(unavailable.length > 0 ? { unavailableGates: unavailable } : {}) })
      : `${child === undefined ? '' : `Child: ${child}\n\n`}${human}`);
    return unavailable.length > 0 ? 1 : 0;
  }
  if (!deps.isInteractive?.() && deps.isInteractive !== undefined || (deps.isInteractive === undefined && !process.stdin.isTTY)) {
    print('kickback-budget: mutations require an interactive local operator terminal.'); return 2;
  }
  if (!command.gate || !GATES.has(command.gate) || !command.rationale?.trim() || !isAcceptableOperatorRationale(command.rationale)) { print('kickback-budget: invalid gate or rationale.'); return 2; }
  const defaultChild = command.child === undefined && defaultsToExecutionChild(command.gate)
    ? await executionChildFor(worktree)
    : undefined;
  const child = command.child === undefined ? defaultChild : parseChildId(command.child);
  if (command.child !== undefined && child === undefined) {
    print(`kickback-budget: invalid child id "${command.child}".`);
    return 1;
  }
  // Restack recovery is deliberately ref-backed: the originating child's
  // worktree may have been recreated after its cascade cap halted the stack.
  // All other gates retain their child-state boundary.
  if (command.gate === 'restack' && child === undefined) {
    print('kickback-budget: --gate restack requires --child.');
    return 1;
  }
  if (child !== undefined && command.gate !== 'restack' && !(await childStateExists(worktree, child))) {
    print(`kickback-budget: child ${child} has no child state.`);
    return 1;
  }
  const gate = command.gate;
  const action: KickbackBudgetAdjustment['kind'] = command.action === 'raise' ? 'raise' : 'reset';
  const rationale = command.rationale.trim();
  const restackChild = gate === 'restack' ? child! : undefined;
  // Remediation and manual-test allowances are feature-wide.  A routed host
  // is an execution overlay, never an accounting namespace; even an explicit
  // `--child` must leave the authoritative adjustment in the flat ledger.
  let ledgerChild = WHOLE_FEATURE_GATES.has(gate) ? undefined : child;
  if (restackChild !== undefined) {
    const activeCursor = await resolveActiveChildForCurrentFeature(worktree);
    if (activeCursor.kind !== 'active' && activeCursor.kind !== 'repair-pending') {
      print(`kickback-budget: active child resolution refused (${childCursorRefusal(activeCursor)}).`);
      return 1;
    }
    // Restack cap evidence belongs to the cursor range (normally the leaf);
    // --child names only the originating child in the durable cascade ref.
    // A routed host is an execution overlay and must not move this ledger.
    ledgerChild = activeCursor.child;
  }
  // Mutations reconcile only after D3's argument/authority refusals, which must
  // leave the park and the ledger untouched.
  const refused = await reconcile(ledgerChild);
  if (refused !== undefined) return refused;
  const cascadeState = restackChild === undefined ? undefined : await readCascadeCounts(worktree, command.feature);
  if (cascadeState?.kind === 'unreadable') {
    print(`kickback-budget: refused — ${cascadeState.detail}`);
    return 1;
  }
  if (restackChild !== undefined && cascadeState !== undefined &&
      !(String(restackChild) in cascadeState.counts.counts) && !(String(restackChild) in (cascadeState.counts.limits ?? {}))) {
    print(`kickback-budget: refused — child ${restackChild} has no cascade state.`);
    return 1;
  }
  // The recovery-eligible class is per gate: the cumulative build_review cap
  // writes `needs-human` (D1), while the two remediation-append cap terminals
  // write `kickback-cap` (adr-2026-08-25 D4, preserved by D1's amendment). Read
  // the raw sidecar — `readHaltClass` folds every class outside the daemon's
  // scheduling union to `unclassified`, which would refuse both of them.
  // Resetting a lap counter cannot recover exhausted plan-growth allowance.
  // This is deliberately outside the shared staging refusal: the same durable
  // evidence authorizes raise, and it must be rejected before taking a park.
  if (command.action === 'reset') {
    const ledger = await readKickbackLedger(worktree, ledgerChild);
    if (!isUnreadableKickbackLedger(ledger) && ledger.gates[gate]?.capEvidence?.allowance === 'growth') {
      print('kickback-budget: refused — plan-growth evidence requires `raise` recovery.');
      return 1;
    }
  }
  let ownedPark: Awaited<ReturnType<typeof createOwnedPark>>;
  try {
    ownedPark = await createOwnedPark(root, command.feature);
  } catch {
    print(`kickback-budget: could not park '${command.feature}'.`);
    return 1;
  }
  const ownedParkToken = ownedPark.created ? ownedPark.token : undefined;
  const parked = !ownedPark.created;
  let staged = false;
  let committed = false;
  let liveHaltGeneration = '';
  try {
    const { limits: defaults, restackAllowance } = await defaultsFor(worktree);
    const remediation = gate !== 'build_review' && gate !== 'restack';
    // D3: machine-scoped identity through the approved user-config → GitHub
    // chain. `GITHUB_ACTOR` is an environment variable any pipeline process can
    // set, so it can never be the authority for an operator authorization.
    const operator = (await (deps.resolveOperator?.() ?? resolveMachineOperatorIdentity(root)));
    if (!operator?.trim()) { print('kickback-budget: no approved operator identity is available.'); return 1; }
    // The eligibility read and adjustment arithmetic happen while the ledger
    // lease is held, after this command owns its temporary park.
    const adjustment = await stageKickbackBudgetAdjustment(worktree, gate, (entry, ledger) => {
      if (!entry.capEvidence) throw new Error('no current cap evidence for that gate');
      const allowance = entry.capEvidence.allowance ?? 'laps';
      const growth = allowance === 'growth';
      const currentLimit = gate === 'restack'
        ? (cascadeState!.counts.limits?.[String(restackChild!)] ?? restackAllowance.limit)
        : growth
        ? (ledger.effectiveGrowthCap ?? entry.capEvidence.limit)
        : remediation ? (entry.effectiveLapCap ?? entry.capEvidence.limit) : (entry.effectiveLimit ?? defaults[gate]);
      const currentConsumed = gate === 'restack'
        ? (cascadeState!.counts.counts[String(restackChild!)] ?? 0)
        : growth ? (ledger.growth?.added ?? 0) : remediation ? (entry.laps ?? 0) : entry.cumulative;
      return {
        id: randomUUID(), kind: action, beforeConsumed: currentConsumed,
        afterConsumed: action === 'reset' ? 0 : currentConsumed,
        beforeLimit: currentLimit, afterLimit: action === 'raise' ? currentLimit + command.by! : currentLimit,
        operator, rationale, timestamp: new Date().toISOString(), haltGeneration: entry.capEvidence.haltGeneration, allowance,
      };
    }, async () => {
      let haltBody: string;
      try { haltBody = await readFile(join(worktree, '.pipeline', 'HALT'), 'utf8'); } catch { throw new Error('feature is not currently halted'); }
      const liveHaltClass = (await readFile(join(worktree, HALT_CLASS_MARKER), 'utf8')).trim();
      if (liveHaltClass !== RECOVERABLE_CAP_HALT_CLASS_BY_GATE[gate]) throw new Error('live halt is not eligible for recovery');
      const current = await readKickbackLedger(worktree, ledgerChild);
      if (isUnreadableKickbackLedger(current)) throw new Error('kickback ledger is unreadable');
      if (gate === 'restack' && restackOriginatingChild(current.gates[gate]) !== restackChild) {
        throw new Error('restack cap evidence names a different originating child');
      }
      liveHaltGeneration = current.gates[gate]?.capEvidence?.haltGeneration ?? '';
      if (!liveHaltGeneration || !haltBody.includes(`Kickback halt generation: ${liveHaltGeneration}`)) {
        throw new Error('live halt no longer matches current cap evidence');
      }
    }, ledgerChild);
    staged = true;
    const event: Extract<ConductorEvent, { type: 'kickback_budget_adjustment_authorized' }> = {
      type: 'kickback_budget_adjustment_authorized', adjustmentId: adjustment.id, gate, kind: adjustment.kind,
      feature: command.feature, operator: adjustment.operator, rationale: adjustment.rationale,
      beforeConsumed: adjustment.beforeConsumed, afterConsumed: adjustment.afterConsumed,
      beforeLimit: adjustment.beforeLimit, afterLimit: adjustment.afterLimit, ts: adjustment.timestamp,
      allowance: adjustment.allowance,
    };
    await appendAuthorizationEvent(worktree, event, deps.appendEvent);
    if (restackChild !== undefined) {
      const stagedLedger = await readKickbackLedger(worktree, ledgerChild);
      if (isUnreadableKickbackLedger(stagedLedger)) throw new Error('kickback ledger is unreadable');
      const stagedEntry = stagedLedger.gates[gate];
      if (!stagedEntry) throw new Error('current cap evidence is missing or no longer matches the live halt');
      await applyRestackCascadeAdjustment(worktree, command.feature, adjustment, stagedEntry, restackAllowance.limit);
    }
    const applied = await applyKickbackBudgetAdjustment(
      worktree,
      gate,
      adjustment,
      gate === 'restack' ? adjustment.beforeLimit : defaults[gate],
      ledgerChild,
    );
    committed = true;
    const flatLedger = await readKickbackLedger(worktree);
    const planGrowth = await planGrowthViewFor(worktree, flatLedger);
    print(`${renderKickbackBudgetView(applied, gate, defaults[gate], planGrowth)}${parked ? '\nFeature remains parked; unpark it when ready.' : ''}`);
    return 0;
  } catch (error) {
    print(`kickback-budget: refused — ${error instanceof Error ? error.message : String(error)}`); return 1;
  } finally {
    // Pre-stage refusals have left no durable change and release the temporary
    // park. Once staged, retain it until the adjustment is fully observable.
    if (ownedParkToken !== undefined && (!staged || committed)) {
      await releaseOwnedPark(root, command.feature, ownedParkToken);
    } else if (ownedParkToken !== undefined) {
      print(`kickback-budget: adjustment is staged but incomplete; feature remains parked. Reconcile or unpark '${command.feature}' explicitly after recovery.`);
    }
  }
}
