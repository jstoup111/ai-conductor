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
  { detector: 'detectUserConfigReadCommand', commandPath: ['config'], helpOwner: 'router' },
  { detector: 'detectUserConfigWriteCommand', commandPath: ['config'], helpOwner: 'router' },
  { detector: 'detectUserConfigSetCommand', commandPath: ['config', 'set'], helpOwner: 'router' },
  { detector: 'detectEngineerCommand', commandPath: ['engineer'], helpOwner: 'self' },
  { detector: 'detectIntakeLoopCommand', commandPath: ['intake-loop'], helpOwner: 'router' },
  { detector: 'detectBrainCommand', commandPath: ['brain'], helpOwner: 'router' },
  { detector: 'detectShippedRecordCommand', commandPath: ['shipped-record'], helpOwner: 'router' },
  { detector: 'detectShipmentEvidenceCommand', commandPath: ['shipment-evidence'], helpOwner: 'router' },
  { detector: 'detectFinishRecordCommand', commandPath: ['finish-record'], helpOwner: 'router' },
  { detector: 'detectManualTestRecordCommand', commandPath: ['manual-test-record'], helpOwner: 'router' },
  { detector: 'detectDeriveFeedbackCommand', commandPath: ['derive-feedback'], helpOwner: 'router' },
  { detector: 'detectTaskCommand', commandPath: ['task'], helpOwner: 'router' },
  { detector: 'detectGithubBoundaryAuditCommand', commandPath: ['github-boundary-audit'], helpOwner: 'router' },
  { detector: 'detectGithubOperationCommand', commandPath: ['github-operation'], helpOwner: 'router' },
  { detector: 'detectScopeCheckCommand', commandPath: ['scope-check'], helpOwner: 'router' },
  { detector: 'detectTaskMembershipCheckCommand', commandPath: ['task-membership-check'], helpOwner: 'router' },
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

function dispatcherBody(sourceText: string, name: string): string {
  const declaration = new RegExp(`(?:export\\s+)?async\\s+function\\s+${name}\\s*\\(`).exec(sourceText);
  if (!declaration || declaration.index === undefined) return '';

  const parameterStart = sourceText.indexOf('(', declaration.index);
  if (parameterStart < 0) return '';

  let parameterDepth = 0;
  let parameterEnd = -1;
  for (let index = parameterStart; index < sourceText.length; index += 1) {
    if (sourceText[index] === '(') parameterDepth += 1;
    if (sourceText[index] === ')') {
      parameterDepth -= 1;
      if (parameterDepth === 0) {
        parameterEnd = index;
        break;
      }
    }
  }
  if (parameterEnd < 0) return '';

  const start = sourceText.indexOf('{', parameterEnd);
  if (start < 0) return '';

  let depth = 0;
  for (let index = start; index < sourceText.length; index += 1) {
    if (sourceText[index] === '{') depth += 1;
    if (sourceText[index] === '}') {
      depth -= 1;
      if (depth === 0) return sourceText.slice(start, index + 1);
    }
  }
  return '';
}

function dispatchedDetectors(sourceText: string): string[] {
  const source = [
    dispatcherBody(sourceText, 'dispatchNonDispatchingCliCommand'),
    dispatcherBody(sourceText, 'dispatchCliCommand'),
  ].join('\n');
  const detectors = new Set<string>();
  const detectorCall = /\b(?:detect[A-Za-z]+Command|monitorCli\.detectMonitorCommand)\s*\(/g;
  for (const match of source.matchAll(detectorCall)) detectors.add(match[0].replace(/\s*\($/, ''));
  return [...detectors].sort();
}

/** Return the detector names missing from either the source dispatch chain or registry. */
export function diffDetectorSets(
  sourceText: string,
  registry: readonly PreDispatchCommand[],
): { readonly unregistered: string[]; readonly stale: string[] } {
  const dispatched = new Set(dispatchedDetectors(sourceText));
  const registered = new Set(registry.map(({ detector }) => detector));
  return {
    unregistered: [...dispatched].filter((detector) => !registered.has(detector)).sort(),
    stale: [...registered].filter((detector) => !dispatched.has(detector)).sort(),
  };
}
