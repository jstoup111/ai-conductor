import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { KickbackBudgetDispatch } from '../cli.js';
import { appendCloseoutEvent } from './closeout-events.js';
import { AuditTrailWriter } from './audit-trail.js';
import { EventPersister } from './event-persister.js';
import { dispatchDaemonPark } from './daemon-park-cli.js';
import { applyKickbackBudgetAdjustment, discardPendingKickbackBudgetAdjustment, isUnreadableKickbackGate, isUnreadableKickbackLedger, readKickbackLedger, stageKickbackBudgetAdjustment, unreadableKickbackGates, type KickbackBudgetAdjustment } from './kickback-ledger.js';
import { kickbackBudgetView, renderKickbackBudgetView } from './kickback-budget-view.js';
import { resolveMainRepoRoot, isOperatorParked } from './park-marker.js';
import { isAcceptableOperatorRationale, resolveCliFeatureWorktree, resolveMachineOperatorIdentity } from './cli-operator-authority.js';
import { HALT_CLASS_MARKER } from './halt-marker.js';
import { RECOVERABLE_CAP_HALT_CLASS_BY_GATE } from './halt-classification.js';
import { loadConfig } from './config.js';
import { ConductorEventEmitter } from '../ui/events.js';
import type { ConductorEvent } from '../types/events.js';

const GATES = new Set(['build_review', 'prd_audit', 'architecture_review_as_built']);
const DEFAULTS: Record<string, number> = { build_review: 5, prd_audit: 1, architecture_review_as_built: 1 };

async function defaultsFor(worktree: string): Promise<Record<string, number>> {
  const loaded = await loadConfig(worktree);
  const config = loaded.ok ? loaded.config as {
    prd_audit?: { max_remediation_laps?: number };
    architecture_review_as_built?: { max_remediation_laps?: number };
  } : {};
  return {
    ...DEFAULTS,
    prd_audit: config.prd_audit?.max_remediation_laps ?? DEFAULTS.prd_audit,
    architecture_review_as_built: config.architecture_review_as_built?.max_remediation_laps ?? DEFAULTS.architecture_review_as_built,
  };
}

export interface KickbackBudgetCliDeps {
  cwd?: string;
  isInteractive?: () => boolean;
  resolveOperator?: () => string | undefined | Promise<string | undefined>;
  print?: (message: string) => void;
  resolveMainRoot?: (cwd: string) => Promise<string>;
  appendEvent?: typeof appendCloseoutEvent;
}

async function reconcilePendingAdjustments(worktree: string): Promise<void> {
  const ledger = await readKickbackLedger(worktree);
  // An unreadable ledger is reported by each caller's own unreadable branch, in
  // its own words; reconciliation simply has nothing it may safely act on.
  if (isUnreadableKickbackLedger(ledger)) return;
  let eventText = '';
  try { eventText = await readFile(join(worktree, '.pipeline', 'pipeline-events.jsonl'), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('authorization event ledger is unreadable'); }
  const defaults = await defaultsFor(worktree);
  for (const [gate, entry] of Object.entries(ledger.gates)) {
    const pending = entry.pendingAdjustment;
    if (!pending || isUnreadableKickbackGate(ledger, gate)) continue;
    const records = eventText.split('\n').filter(Boolean).map((line) => {
      try { return JSON.parse(line) as { adjustmentId?: unknown }; }
      catch { throw new Error('authorization event ledger is unreadable'); }
    });
    const recorded = records.some((event) => event.adjustmentId === pending.id);
    if (!recorded) await discardPendingKickbackBudgetAdjustment(worktree, gate, pending.id);
    else await applyKickbackBudgetAdjustment(worktree, gate, pending, defaults[gate] ?? 1);
  }
}

/**
 * A budget command runs outside a live conductor, so it has no in-memory
 * feature scope to deliver its authorization.  Persist and audit the typed
 * occurrence through the ordinary feature event consumers before returning.
 */
async function recordAuthorizationEvent(
  worktree: string,
  event: Extract<ConductorEvent, { type: 'kickback_budget_adjustment_authorized' }>,
): Promise<void> {
  const events = new ConductorEventEmitter();
  const persister = new EventPersister(join(worktree, '.pipeline', 'events.jsonl'), events);
  const audit = new AuditTrailWriter(worktree, { throwOnWriteFailure: true });
  persister.start();
  audit.subscribe(events);
  try {
    await events.emit(event);
  } finally {
    persister.stop();
  }
}

/** Dispatch read-only inspect or an interactive, halted-feature-only mutation. */
export async function dispatchKickbackBudgetCommand(command: KickbackBudgetDispatch, deps: KickbackBudgetCliDeps = {}): Promise<number> {
  const print = deps.print ?? console.log;
  const root = await (deps.resolveMainRoot ?? resolveMainRepoRoot)(deps.cwd ?? process.cwd());
  // D3: one shared named-worktree resolution, not a per-command copy.
  const worktree = await resolveCliFeatureWorktree(command.feature, { cwd: deps.cwd, resolveMainRoot: deps.resolveMainRoot });
  if (!worktree) { print(`kickback-budget: feature '${command.feature}' is unavailable.`); return 1; }
  const reconcile = async (): Promise<number | undefined> => {
    try { await reconcilePendingAdjustments(worktree); return undefined; }
    catch (error) { print(`kickback-budget: refused — ${error instanceof Error ? error.message : String(error)}`); return 1; }
  };
  if (command.action === 'inspect') {
    // D5: reconciliation is a COMMAND-ENTRY obligation, not a mutation-path
    // one. The sealed crash windows say "the operator re-runs any
    // kickback-budget command", and `inspect` is the command an operator
    // reaches for first after a crash — a pending record left unreconciled
    // here would render a budget the ledger does not actually hold.
    const refused = await reconcile();
    if (refused !== undefined) return refused;
    const ledger = await readKickbackLedger(worktree);
    if (isUnreadableKickbackLedger(ledger)) { print('kickback-budget: ledger is unreadable.'); return 1; }
    const defaults = await defaultsFor(worktree);
    // adr-2026-08-31 decision 3: one malformed gate is reported as unavailable;
    // its healthy siblings still render their authoritative values.
    const unavailable = unreadableKickbackGates(ledger).filter((gate) => GATES.has(gate));
    const readable = [...GATES].filter((gate) => !unavailable.includes(gate));
    const views = readable.map((gate) => kickbackBudgetView(ledger.gates[gate], gate, defaults[gate]));
    print(command.format === 'json'
      ? JSON.stringify({ feature: command.feature, gates: views, ...(unavailable.length > 0 ? { unavailableGates: unavailable } : {}) })
      : [
        ...views.map((view) => renderKickbackBudgetView(ledger.gates[view.gate], view.gate, defaults[view.gate])),
        ...unavailable.map((gate) => `${gate}: budget unavailable (durable entry failed validation)`),
      ].join('\n\n'));
    return unavailable.length > 0 ? 1 : 0;
  }
  if (!deps.isInteractive?.() && deps.isInteractive !== undefined || (deps.isInteractive === undefined && !process.stdin.isTTY)) {
    print('kickback-budget: mutations require an interactive local operator terminal.'); return 2;
  }
  if (!command.gate || !GATES.has(command.gate) || !command.rationale?.trim() || !isAcceptableOperatorRationale(command.rationale)) { print('kickback-budget: invalid gate or rationale.'); return 2; }
  // Mutations reconcile only after D3's argument/authority refusals, which must
  // leave the park and the ledger untouched.
  const refused = await reconcile();
  if (refused !== undefined) return refused;
  const ledger = await readKickbackLedger(worktree);
  if (isUnreadableKickbackGate(ledger, command.gate)) { print('kickback-budget: ledger is unreadable.'); return 1; }
  const entry = ledger.gates[command.gate];
  if (!entry?.capEvidence) { print('kickback-budget: no current cap evidence for that gate.'); return 1; }
  try { await readFile(join(worktree, '.pipeline', 'HALT'), 'utf8'); } catch { print('kickback-budget: feature is not currently halted.'); return 1; }
  // The recovery-eligible class is per gate: the cumulative build_review cap
  // writes `needs-human` (D1), while the two remediation-append cap terminals
  // write `kickback-cap` (adr-2026-08-25 D4, preserved by D1's amendment). Read
  // the raw sidecar — `readHaltClass` folds every class outside the daemon's
  // scheduling union to `unclassified`, which would refuse both of them.
  let liveHaltClass = '';
  try { liveHaltClass = (await readFile(join(worktree, HALT_CLASS_MARKER), 'utf8')).trim(); } catch { /* absent → ineligible */ }
  if (liveHaltClass !== RECOVERABLE_CAP_HALT_CLASS_BY_GATE[command.gate]) { print('kickback-budget: live halt is not eligible for recovery.'); return 1; }
  const parked = await isOperatorParked(root, command.feature);
  if (!parked) {
    const result = await dispatchDaemonPark({ kind: 'park', slug: command.feature }, { cwd: root, out: () => {} });
    if (result !== 0) { print(`kickback-budget: could not park '${command.feature}'.`); return 1; }
  }
  try {
    const defaults = await defaultsFor(worktree);
    const remediation = command.gate !== 'build_review';
    const currentLimit = remediation ? (entry.effectiveLapCap ?? defaults[command.gate]) : (entry.effectiveLimit ?? defaults[command.gate]);
    const currentConsumed = remediation ? (entry.laps ?? 0) : entry.cumulative;
    // D3: machine-scoped identity through the approved user-config → GitHub
    // chain. `GITHUB_ACTOR` is an environment variable any pipeline process can
    // set, so it can never be the authority for an operator authorization.
    const operator = (await (deps.resolveOperator?.() ?? resolveMachineOperatorIdentity(root)));
    if (!operator?.trim()) { print('kickback-budget: no approved operator identity is available.'); return 1; }
    const adjustment: KickbackBudgetAdjustment = {
      id: randomUUID(), kind: command.action, beforeConsumed: currentConsumed,
      afterConsumed: command.action === 'reset' ? 0 : currentConsumed,
      beforeLimit: currentLimit, afterLimit: command.action === 'raise' ? currentLimit + command.by! : currentLimit,
      operator, rationale: command.rationale.trim(),
      timestamp: new Date().toISOString(), haltGeneration: entry.capEvidence.haltGeneration,
    };
    await stageKickbackBudgetAdjustment(worktree, command.gate, adjustment);
    const event: Extract<ConductorEvent, { type: 'kickback_budget_adjustment_authorized' }> = {
      type: 'kickback_budget_adjustment_authorized', adjustmentId: adjustment.id, gate: command.gate, kind: adjustment.kind,
      feature: command.feature, operator: adjustment.operator, rationale: adjustment.rationale,
      beforeConsumed: adjustment.beforeConsumed, afterConsumed: adjustment.afterConsumed,
      beforeLimit: adjustment.beforeLimit, afterLimit: adjustment.afterLimit, ts: adjustment.timestamp,
    };
    (deps.appendEvent ?? appendCloseoutEvent)(worktree, event);
    await recordAuthorizationEvent(worktree, event);
    const applied = await applyKickbackBudgetAdjustment(worktree, command.gate, adjustment, defaults[command.gate]);
    print(`${renderKickbackBudgetView(applied, command.gate, defaults[command.gate])}${parked ? '\nFeature remains parked; unpark it when ready.' : ''}`);
    return 0;
  } catch (error) {
    print(`kickback-budget: refused — ${error instanceof Error ? error.message : String(error)}`); return 1;
  } finally {
    if (!parked) await dispatchDaemonPark({ kind: 'unpark', slug: command.feature }, { cwd: root, out: () => {} });
  }
}
