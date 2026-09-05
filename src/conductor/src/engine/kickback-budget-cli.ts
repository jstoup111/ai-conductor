import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { join } from 'node:path';

import type { KickbackBudgetDispatch } from '../cli.js';
import { appendCloseoutEvent } from './closeout-events.js';
import { applyKickbackBudgetAdjustment, readKickbackLedger, type KickbackBudgetAdjustment } from './kickback-ledger.js';
import { kickbackBudgetView, renderKickbackBudgetView } from './kickback-budget-view.js';
import { resolveMainRepoRoot, isOperatorParked, removeOperatorPark, writeOperatorPark } from './park-marker.js';

const GATES = new Set(['build_review', 'prd_audit', 'architecture_review_as_built']);
const DEFAULTS: Record<string, number> = { build_review: 5, prd_audit: 1, architecture_review_as_built: 1 };

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

/** Dispatch read-only inspect or an interactive, halted-feature-only mutation. */
export async function dispatchKickbackBudgetCommand(command: KickbackBudgetDispatch, deps: KickbackBudgetCliDeps = {}): Promise<number> {
  const print = deps.print ?? console.log;
  const root = await (deps.resolveMainRoot ?? resolveMainRepoRoot)(deps.cwd ?? process.cwd());
  const worktree = await resolveWorktree(command.feature, deps.cwd ?? process.cwd(), deps.resolveMainRoot ?? resolveMainRepoRoot);
  if (!worktree) { print(`kickback-budget: feature '${command.feature}' is unavailable.`); return 1; }
  const ledger = await readKickbackLedger(worktree);
  if (command.action === 'inspect') {
    const views = Object.entries(ledger.gates).map(([gate, entry]) => kickbackBudgetView(entry, gate, DEFAULTS[gate] ?? 2));
    print(command.format === 'json' ? JSON.stringify({ feature: command.feature, gates: views }) : views.map((view) => renderKickbackBudgetView(ledger.gates[view.gate], view.gate, DEFAULTS[view.gate] ?? 2)).join('\n\n'));
    return 0;
  }
  if (!deps.isInteractive?.() && deps.isInteractive !== undefined || (deps.isInteractive === undefined && !process.stdin.isTTY)) {
    print('kickback-budget: mutations require an interactive local operator terminal.'); return 2;
  }
  if (!command.gate || !GATES.has(command.gate) || !command.rationale?.trim()) { print('kickback-budget: invalid gate or rationale.'); return 2; }
  const entry = ledger.gates[command.gate];
  if (!entry?.capEvidence) { print('kickback-budget: no current cap evidence for that gate.'); return 1; }
  try { await readFile(join(worktree, '.pipeline', 'HALT'), 'utf8'); } catch { print('kickback-budget: feature is not currently halted.'); return 1; }
  const parked = await isOperatorParked(root, command.feature);
  if (!parked) await writeOperatorPark(root, command.feature);
  try {
    const remediation = command.gate !== 'build_review';
    const currentLimit = remediation ? (entry.effectiveLapCap ?? DEFAULTS[command.gate]) : (entry.effectiveLimit ?? DEFAULTS[command.gate]);
    const currentConsumed = remediation ? (entry.laps ?? 0) : entry.cumulative;
    const adjustment: KickbackBudgetAdjustment = {
      id: randomUUID(), kind: command.action, beforeConsumed: currentConsumed,
      afterConsumed: command.action === 'reset' ? 0 : currentConsumed,
      beforeLimit: currentLimit, afterLimit: command.action === 'raise' ? currentLimit + command.by! : currentLimit,
      operator: deps.resolveOperator?.() ?? userInfo().username, rationale: command.rationale,
      timestamp: new Date().toISOString(), haltGeneration: entry.capEvidence.haltGeneration,
    };
    (deps.appendEvent ?? appendCloseoutEvent)(worktree, { type: 'kickback_budget_adjustment_authorized', adjustmentId: adjustment.id, gate: command.gate, kind: adjustment.kind, ts: adjustment.timestamp });
    await applyKickbackBudgetAdjustment(worktree, command.gate, adjustment, DEFAULTS[command.gate]);
    print(`kickback-budget: ${command.action} authorized for ${command.gate}; daemon will resume '${command.feature}'.`);
    return 0;
  } catch (error) {
    print(`kickback-budget: refused — ${error instanceof Error ? error.message : String(error)}`); return 1;
  } finally { if (!parked) await removeOperatorPark(root, command.feature); }
}
