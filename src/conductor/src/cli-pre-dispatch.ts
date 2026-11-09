import type { Command } from 'commander';
import { createProgram } from './cli.js';

/**
 * The command detectors reached before the foreground pipeline starts.
 *
 * Keep this catalog aligned with the two dispatch chains in index.ts. The
 * registry is intentionally declarative: later help routing uses its command
 * path and owner without duplicating the intercept chain.
 */
export type PreDispatchHelpOwner = 'router' | 'self' | 'passthrough';

export interface PreDispatchCommand {
  readonly detector: string;
  readonly commandPath: readonly string[];
  readonly helpOwner: PreDispatchHelpOwner;
}

export const PRE_DISPATCH_COMMANDS = [
  { detector: 'detectRenderCommand', commandPath: ['render-diagrams'], helpOwner: 'router' },
  { detector: 'detectRateCardCommand', commandPath: ['rate-card'], helpOwner: 'router' },
  { detector: 'detectOverlapScanCommand', commandPath: ['overlap-scan'], helpOwner: 'router' },
  { detector: 'detectVersionCommand', commandPath: ['version'], helpOwner: 'router' },
  { detector: 'detectUpdateCommand', commandPath: ['update'], helpOwner: 'passthrough' },
  { detector: 'detectBuildReviewAcceptCommand', commandPath: ['build-review', 'accept'], helpOwner: 'router' },
  { detector: 'detectBuildReviewResolveCaseCommand', commandPath: ['build-review', 'resolve-case'], helpOwner: 'router' },
  { detector: 'detectDoneWhenAcceptCommand', commandPath: ['done-when', 'accept'], helpOwner: 'router' },
  { detector: 'detectBuildReviewRecordReducedCoverageCommand', commandPath: ['build-review', 'record-reduced-coverage'], helpOwner: 'router' },
  { detector: 'detectBuildReviewFindingsCommand', commandPath: ['build-review', 'findings'], helpOwner: 'router' },
  { detector: 'detectBuildTailCommand', commandPath: ['build-tail'], helpOwner: 'router' },
  { detector: 'detectScopedRunCommand', commandPath: ['scoped-run'], helpOwner: 'router' },
  { detector: 'detectDecideGrantCommand', commandPath: ['decide-grant'], helpOwner: 'router' },
  { detector: 'detectKickbackBudgetCommand', commandPath: ['kickback-budget'], helpOwner: 'router' },
  { detector: 'detectHaltClearCommand', commandPath: ['halt-clear'], helpOwner: 'router' },
  { detector: 'detectRewindCommand', commandPath: ['rewind'], helpOwner: 'router' },
  { detector: 'detectResealCommand', commandPath: ['reseal'], helpOwner: 'router' },
  { detector: 'detectMissingResealReasonCommand', commandPath: ['missing-reseal-reason'], helpOwner: 'router' },
  { detector: 'detectTestSuiteCommand', commandPath: ['test-suite'], helpOwner: 'router' },
  { detector: 'detectMemoryCommand', commandPath: ['memory', 'setup'], helpOwner: 'router' },
  { detector: 'detectRegistryCommand', commandPath: ['register'], helpOwner: 'router' },
  { detector: 'detectRegistryCommand', commandPath: ['create'], helpOwner: 'router' },
  { detector: 'detectUserConfigReadCommand', commandPath: ['config'], helpOwner: 'router' },
  { detector: 'detectUserConfigWriteCommand', commandPath: ['config'], helpOwner: 'router' },
  { detector: 'detectUserConfigSetCommand', commandPath: ['config', 'set'], helpOwner: 'router' },
  { detector: 'detectEngineerCommand', commandPath: ['engineer'], helpOwner: 'self' },
  { detector: 'detectIntakeLoopCommand', commandPath: ['intake-loop'], helpOwner: 'router' },
  { detector: 'detectBrainCommand', commandPath: ['brain'], helpOwner: 'router' },
  { detector: 'detectShippedRecordCommand', commandPath: ['shipped-record'], helpOwner: 'router' },
  { detector: 'detectDocsPruneCommand', commandPath: ['docs-prune'], helpOwner: 'router' },
  { detector: 'detectTranscriptsCommand', commandPath: ['transcripts'], helpOwner: 'router' },
  { detector: 'detectShipmentEvidenceCommand', commandPath: ['shipment-evidence'], helpOwner: 'router' },
  { detector: 'detectFinishRecordCommand', commandPath: ['finish-record'], helpOwner: 'router' },
  { detector: 'detectManualTestRecordCommand', commandPath: ['manual-test-record'], helpOwner: 'router' },
  { detector: 'detectDeriveFeedbackCommand', commandPath: ['derive-feedback'], helpOwner: 'router' },
  { detector: 'detectTaskCommand', commandPath: ['task'], helpOwner: 'router' },
  { detector: 'detectGithubBoundaryAuditCommand', commandPath: ['github-boundary-audit'], helpOwner: 'router' },
  { detector: 'detectGithubOperationCommand', commandPath: ['github-operation'], helpOwner: 'router' },
  { detector: 'detectScopeCheckCommand', commandPath: ['scope-check'], helpOwner: 'router' },
  { detector: 'detectTaskMembershipCheckCommand', commandPath: ['task-membership-check'], helpOwner: 'router' },
  { detector: 'detectRoundStampCommand', commandPath: ['round-stamp'], helpOwner: 'router' },
  { detector: 'detectStackCommitGuardCommand', commandPath: ['stack-commit-guard'], helpOwner: 'router' },
  { detector: 'detectStackLandCommand', commandPath: ['stack', 'land'], helpOwner: 'router' },
  { detector: 'detectStackRoundsCommand', commandPath: ['stack', 'rounds'], helpOwner: 'router' },
  { detector: 'detectStackOwnersCommand', commandPath: ['stack', 'owners'], helpOwner: 'router' },
  { detector: 'detectStackRestackResolveCommand', commandPath: ['stack', 'restack-resolve'], helpOwner: 'router' },
  { detector: 'detectEvidenceCommand', commandPath: ['evidence'], helpOwner: 'router' },
  { detector: 'detectKpiCommand', commandPath: ['kpi'], helpOwner: 'router' },
  { detector: 'detectBuildAuthStatusCommand', commandPath: ['build-auth-status'], helpOwner: 'router' },
  { detector: 'detectHaltIssuesSweepCommand', commandPath: ['halt-issues'], helpOwner: 'self' },
  { detector: 'detectPlanProtectedTargetsCommand', commandPath: ['plan-protected-targets'], helpOwner: 'router' },
  { detector: 'monitorCli.detectMonitorCommand', commandPath: ['monitor'], helpOwner: 'router' },
  { detector: 'detectDaemonObserveCommand', commandPath: ['daemon'], helpOwner: 'self' },
  { detector: 'detectDaemonParkCommand', commandPath: ['daemon'], helpOwner: 'self' },
  { detector: 'detectDaemonExitWitnessCommand', commandPath: ['daemon'], helpOwner: 'self' },
  { detector: 'detectDaemonSupervisorCommand', commandPath: ['daemon'], helpOwner: 'self' },
  { detector: 'detectDaemonCommand', commandPath: ['daemon'], helpOwner: 'self' },
] as const satisfies readonly PreDispatchCommand[];

/** Return Commander-owned help for a registered command path, if help was requested. */
export function routeSubcommandHelp(
  argv: readonly string[],
  registry: readonly PreDispatchCommand[] = PRE_DISPATCH_COMMANDS,
  program?: Command,
): string | null {
  const args = argv.slice(2);
  const optionTerminator = args.indexOf('--');
  const helpArgs = optionTerminator < 0 ? args : args.slice(0, optionTerminator);
  if (!helpArgs.some((arg) => arg === '--help' || arg === '-h')) return null;

  // The top-level argv token selects the dispatch owner.
  const entry = registry.find((candidate) => candidate.commandPath[0] === args[0]);
  if (entry === undefined || entry.helpOwner !== 'router') {
    return null;
  }

  let command = program ?? createProgram();
  for (let index = 0; index < helpArgs.length; index += 1) {
    const arg = helpArgs[index];
    if (arg.startsWith('-')) {
      // Only a value-taking option advances the command-path cursor. Inline
      // values (for example, --event=audit) are already part of this token.
      const consumesNextToken = command.options.some((candidate) =>
        (candidate.short === arg || candidate.long === arg)
        && (candidate.required || candidate.optional),
      );
      if (consumesNextToken && !arg.includes('=')) index += 1;
      continue;
    }
    const next = command.commands.find((candidate) => candidate.name() === arg);
    if (next === undefined) break;
    command = next;
  }
  return command.helpInformation();
}
