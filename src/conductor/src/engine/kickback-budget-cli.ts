import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { KickbackBudgetDispatch } from '../cli.js';
import { appendCloseoutEvent } from './closeout-events.js';
import { AuditTrailWriter } from './audit-trail.js';
import { EventPersister } from './event-persister.js';
import { dispatchDaemonPark } from './daemon-park-cli.js';
import { applyKickbackBudgetAdjustment, discardPendingKickbackBudgetAdjustment, isUnreadableKickbackLedger, readKickbackLedger, stageKickbackBudgetAdjustment, type KickbackBudgetAdjustment } from './kickback-ledger.js';
import { kickbackBudgetView, renderKickbackBudgetView } from './kickback-budget-view.js';
import { resolveMainRepoRoot, isOperatorParked } from './park-marker.js';
import { readHaltClass } from './halt-marker.js';
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
  resolveOperator?: () => string | undefined;
  print?: (message: string) => void;
  resolveMainRoot?: (cwd: string) => Promise<string>;
  appendEvent?: typeof appendCloseoutEvent;
}

async function resolveWorktree(feature: string, cwd: string, resolveMainRoot: (cwd: string) => Promise<string>): Promise<string | undefined> {
  try {
    const worktree = join(await resolveMainRoot(cwd), '.worktrees', feature);
    return (await stat(worktree)).isDirectory() ? worktree : undefined;
  } catch { return undefined; }
}

async function reconcilePendingAdjustments(worktree: string): Promise<void> {
  const ledger = await readKickbackLedger(worktree);
  if (isUnreadableKickbackLedger(ledger)) throw new Error('ledger is unreadable');
  let eventText = '';
  try { eventText = await readFile(join(worktree, '.pipeline', 'pipeline-events.jsonl'), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('authorization event ledger is unreadable'); }
  const defaults = await defaultsFor(worktree);
  for (const [gate, entry] of Object.entries(ledger.gates)) {
    const pending = entry.pendingAdjustment;
    if (!pending) continue;
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
  const worktree = await resolveWorktree(command.feature, deps.cwd ?? process.cwd(), deps.resolveMainRoot ?? resolveMainRepoRoot);
  if (!worktree) { print(`kickback-budget: feature '${command.feature}' is unavailable.`); return 1; }
  if (command.action === 'inspect') {
    const ledger = await readKickbackLedger(worktree);
    if (isUnreadableKickbackLedger(ledger)) { print('kickback-budget: ledger is unreadable.'); return 1; }
    const defaults = await defaultsFor(worktree);
    const views = [...GATES].map((gate) => kickbackBudgetView(ledger.gates[gate], gate, defaults[gate]));
    print(command.format === 'json' ? JSON.stringify({ feature: command.feature, gates: views }) : views.map((view) => renderKickbackBudgetView(ledger.gates[view.gate], view.gate, defaults[view.gate])).join('\n\n'));
    return 0;
  }
  if (!deps.isInteractive?.() && deps.isInteractive !== undefined || (deps.isInteractive === undefined && !process.stdin.isTTY)) {
    print('kickback-budget: mutations require an interactive local operator terminal.'); return 2;
  }
  if (!command.gate || !GATES.has(command.gate) || !command.rationale?.trim()) { print('kickback-budget: invalid gate or rationale.'); return 2; }
  try { await reconcilePendingAdjustments(worktree); }
  catch (error) { print(`kickback-budget: refused — ${error instanceof Error ? error.message : String(error)}`); return 1; }
  const ledger = await readKickbackLedger(worktree);
  if (isUnreadableKickbackLedger(ledger)) { print('kickback-budget: ledger is unreadable.'); return 1; }
  const entry = ledger.gates[command.gate];
  if (!entry?.capEvidence) { print('kickback-budget: no current cap evidence for that gate.'); return 1; }
  try { await readFile(join(worktree, '.pipeline', 'HALT'), 'utf8'); } catch { print('kickback-budget: feature is not currently halted.'); return 1; }
  if ((await readHaltClass(worktree)) !== 'needs-human') { print('kickback-budget: live halt is not eligible for recovery.'); return 1; }
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
    const operator = deps.resolveOperator?.() ?? process.env.GITHUB_ACTOR;
    if (!operator?.trim()) { print('kickback-budget: no approved operator identity is available.'); return 1; }
    const adjustment: KickbackBudgetAdjustment = {
      id: randomUUID(), kind: command.action, beforeConsumed: currentConsumed,
      afterConsumed: command.action === 'reset' ? 0 : currentConsumed,
      beforeLimit: currentLimit, afterLimit: command.action === 'raise' ? currentLimit + command.by! : currentLimit,
      operator, rationale: command.rationale,
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
