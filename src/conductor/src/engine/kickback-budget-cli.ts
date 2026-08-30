import { readKickbackLedger, type KickbackLedger } from './kickback-ledger.js';
import {
  resolveNamedFeatureWorktree,
  type NamedFeatureWorktreeResolverDeps,
} from './feature-worktree-resolver.js';
import {
  deriveKickbackBudgetView,
  renderKickbackBudgetViewHuman,
  renderKickbackBudgetViewJson,
} from './kickback-budget.js';
import type { KickbackBudgetInspectDispatch } from '../cli.js';

/** Injectable read-only boundary for the pre-boot budget inspection command. */
export interface KickbackBudgetInspectDeps extends NamedFeatureWorktreeResolverDeps {
  readonly cwd?: string;
  readonly readBudgetLedger?: (worktree: string) => Promise<KickbackLedger>;
  readonly print?: (output: string) => void;
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
