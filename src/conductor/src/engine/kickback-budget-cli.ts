import { readKickbackLedger, type KickbackLedger } from './kickback-ledger.js';
import {
  resolveNamedFeatureWorktree,
  type NamedFeatureWorktreeResolverDeps,
} from './feature-worktree-resolver.js';
import {
  deriveKickbackBudgetView,
  renderKickbackBudgetViewHuman,
  renderKickbackBudgetViewJson,
  applyKickbackBudgetMutation,
  reconcilePendingKickbackBudgetAdjustment,
} from './kickback-budget.js';
import type { KickbackBudgetDispatch, KickbackBudgetInspectDispatch } from '../cli.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { acquireTemporaryOperatorPark } from './daemon-park-cli.js';
import { makeMachineOwnerResolver } from './owner-gate/machine-identity.js';
import { makeProductionGh } from './tracker-client.js';

/** Injectable read-only boundary for the pre-boot budget inspection command. */
export interface KickbackBudgetInspectDeps extends NamedFeatureWorktreeResolverDeps {
  readonly cwd?: string;
  /** Accepted for parity with mutation dispatchers; inspection ignores TTY state. */
  readonly isInteractive?: boolean;
  readonly readBudgetLedger?: (worktree: string) => Promise<KickbackLedger>;
  readonly print?: (output: string) => void;
}

export interface KickbackBudgetMutationDeps extends KickbackBudgetInspectDeps {
  readonly isInteractive?: boolean;
  readonly resolveOperator?: () => Promise<{ resolved: boolean; id?: string }>;
}

/**
 * Inspects exactly one resolved feature worktree. This path deliberately owns
 * no lease, park marker, pipeline state, or identity mutation: it only reads
 * the durable ledger after the shared resolver has authenticated its target.
 */
export async function dispatchKickbackBudgetInspect(
  command: KickbackBudgetInspectDispatch,
  deps: KickbackBudgetInspectDeps = {},
): Promise<number> {
  const print = deps.print ?? console.log;
  try {
    const resolved = await resolveNamedFeatureWorktree(
      { cwd: deps.cwd, feature: command.feature },
      deps,
    );
    if (!resolved) throw new Error('feature identity is unavailable');

    const ledger = await (deps.readBudgetLedger ?? readKickbackLedger)(resolved.worktree);
    const entry = ledger.gates.build_review;
    if (!entry) throw new Error('build-review budget is unavailable');

    const view = deriveKickbackBudgetView(command.feature, entry);
    print(command.format === 'json'
      ? renderKickbackBudgetViewJson(view)
      : renderKickbackBudgetViewHuman(view));
    return 0;
  } catch {
    print(`kickback-budget inspect: current feature state is invalid or unavailable for '${command.feature}'.`);
    return 1;
  }
}

/** Guard and apply a reset/raise without booting a conductor. */
export async function dispatchKickbackBudgetMutation(
  command: Exclude<KickbackBudgetDispatch, KickbackBudgetInspectDispatch>,
  deps: KickbackBudgetMutationDeps = {},
): Promise<number> {
  const print = deps.print ?? console.log;
  try {
    if (deps.isInteractive === false || !process.stdin.isTTY && deps.isInteractive === undefined) throw new Error('an interactive terminal is required');
    const resolved = await resolveNamedFeatureWorktree({ cwd: deps.cwd, feature: command.feature }, deps);
    if (!resolved) throw new Error('feature identity is unavailable');
    const resolveOperator = deps.resolveOperator ?? makeMachineOwnerResolver(makeProductionGh(), resolved.mainRoot);
    const operator = await resolveOperator();
    if (!operator.resolved || !operator.id) throw new Error('machine operator identity is unavailable');
    const [haltClass, ledger] = await Promise.all([
      readFile(join(resolved.worktree, '.pipeline/HALT.class'), 'utf8'),
      (deps.readBudgetLedger ?? readKickbackLedger)(resolved.worktree),
    ]);
    const evidence = ledger.gates.build_review?.exhaustedEvidence;
    if (haltClass.trim() !== 'needs-human' || !evidence) throw new Error('the exact cumulative-cap halt is not current');
    const temporaryPark = await acquireTemporaryOperatorPark(resolved.mainRoot, command.feature);
    const reconciled = await reconcilePendingKickbackBudgetAdjustment(resolved.worktree, command.feature);
    if (reconciled && !reconciled.ok) throw new Error(reconciled.message);
    const result = await applyKickbackBudgetMutation(resolved.worktree, command.feature, operator.id, command.rationale,
      command.kind === 'reset' ? { kind: 'reset' } : { kind: 'raise', amount: command.amount }, evidence.generation);
    if (!result.ok) throw new Error(result.message);
    await temporaryPark.release();
    print(`kickback-budget ${command.kind}: authorized ${result.adjustment.id}`);
    return 0;
  } catch (error) {
    print(`kickback-budget ${command.kind}: ${error instanceof Error ? error.message : 'recovery refused'}.`);
    return 1;
  }
}
