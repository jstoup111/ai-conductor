import { loadMergedConfig } from './config.js';
import type { EffortLevel, HarnessConfig } from '../types/config.js';
import { resolveGuidedSessionSelection, type GuidedSessionSelection } from './monitor/selection.js';
import { createPriorityResolver, ghIssueLabelReader } from './backlog-priority.js';
import { makeProductionGh } from './tracker-client.js';
import { startOperatorEventSpine } from './event-persister.js';
import { dispatchHaltIssuesSweep } from './halt-issues/halt-issues-cli.js';
import { deriveQueueMembership } from './monitor/queue.js';
import { runGuidedMonitorQueue, type HaltIssueReconciliationOutcome } from './monitor/loop.js';
import { openGuidedSession, displayHaltClassification } from './monitor/session.js';
import { readDeferrals, isDeferred } from './monitor/deferrals.js';
import { orderMonitorQueue, type MonitorPriorityResolver } from './monitor/ordering.js';
import { snapshotHaltMarker } from './halt-marker.js';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export type MonitorDispatch =
  | { readonly kind: 'run'; readonly projectName?: string; readonly overrides?: { readonly provider?: string; readonly model?: string; readonly effort?: EffortLevel } }
  | { readonly kind: 'guide' };

export const MONITOR_USAGE =
  // ai-conductor:session-command-context=operator-only
  'Usage: ai-conductor monitor all|<project> [--provider <provider>] [--model <model>] [--effort <effort>]\n' +
  '  Monitor halted features across every registered project, or one named project.\n';
// /ai-conductor:session-command-context

/**
 * Parse the foreground monitor selector. A malformed `monitor` invocation is
 * deliberately still recognized, so it cannot fall through to the pipeline
 * launcher as a feature description.
 */
export function detectMonitorCommand(argv: readonly string[]): MonitorDispatch | null {
  if (argv[2] !== 'monitor') return null;
  const selector = argv[3];
  if (selector === undefined || selector.startsWith('-')) {
    return { kind: 'guide' };
  }
  const overrides: { provider?: string; model?: string; effort?: EffortLevel } = {};
  for (let index = 4; index < argv.length; index += 2) {
    const flag = argv[index]; const value = argv[index + 1];
    if (value === undefined || (flag !== '--provider' && flag !== '--model' && flag !== '--effort') || Object.hasOwn(overrides, flag.slice(2))) return { kind: 'guide' };
    if (flag === '--provider') overrides.provider = value;
    if (flag === '--model') overrides.model = value;
    if (flag === '--effort') overrides.effort = value as EffortLevel;
  }
  const withOverrides = Object.keys(overrides).length === 0 ? {} : { overrides };
  return selector === 'all' ? { kind: 'run', ...withOverrides } : { kind: 'run', projectName: selector, ...withOverrides };
}

export interface MonitorCliDeps {
  readonly resolveProvider?: (projectRoot: string) => Promise<{ readonly provider?: string; readonly error?: string }>;
  readonly loadConfig?: typeof loadMergedConfig;
  readonly resolveSelection?: (input: { config: HarnessConfig; overrides?: { provider?: string; model?: string; effort?: EffortLevel } }) => GuidedSessionSelection;
  readonly deriveQueueMembership?: typeof deriveQueueMembership;
  readonly runGuidedMonitorQueue?: typeof runGuidedMonitorQueue;
  readonly openGuidedSession?: typeof openGuidedSession;
  readonly print?: (message: string) => void;
  readonly printError?: (message: string) => void;
  readonly createInterrupt?: () => { readonly untilStop: Promise<void>; readonly dispose: () => void };
  readonly priorityResolver?: MonitorPriorityResolver;
  readonly reconcileHaltIssues?: () => Promise<HaltIssueReconciliationOutcome>;
  readonly haltIssuesRepository?: typeof haltIssuesRepository;
  readonly dispatchHaltIssuesSweep?: typeof dispatchHaltIssuesSweep;
  readonly startEventSpine?: typeof startOperatorEventSpine;
  /** Filesystem seams keep the composed ordering boundary deterministic in tests. */
  readonly readDeferrals?: typeof readDeferrals;
  readonly snapshotHaltMarker?: typeof snapshotHaltMarker;
}

const execFileP = promisify(execFile);

async function haltIssuesRepository(projectRoot: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileP('git', ['config', '--get', 'remote.origin.url'], { cwd: projectRoot });
    const match = /(?:github\.com[:/])([^/\s]+\/[^/\s]+?)(?:\.git)?\s*$/.exec(stdout);
    return match?.[1];
  } catch {
    return undefined;
  }
}

function createInterruptSignal(): { readonly untilStop: Promise<void>; readonly dispose: () => void } {
  let stop!: () => void;
  const untilStop = new Promise<void>((resolve) => {
    stop = resolve;
  });
  const onInterrupt = () => stop();
  process.once('SIGINT', onInterrupt);
  return {
    untilStop,
    dispose: () => process.removeListener('SIGINT', onInterrupt),
  };
}

/** Compose the foreground monitor without booting the provider-aware pipeline. */
export async function dispatchMonitorCommand(
  command: MonitorDispatch,
  projectRoot: string,
  deps: MonitorCliDeps = {},
): Promise<number> {
  const print = deps.print ?? ((message: string) => console.log(message));
  const printError = deps.printError ?? ((message: string) => console.error(message));
  if (command.kind === 'guide') {
    printError(MONITOR_USAGE);
    return 1;
  }

  let selection: GuidedSessionSelection;
  const overrides = command.overrides ?? {};
  if (deps.resolveProvider) {
    const providerResult = await deps.resolveProvider(projectRoot);
    if (providerResult.error !== undefined || providerResult.provider === undefined) {
      printError(`monitor: unable to resolve provider${providerResult.error ? `: ${providerResult.error}` : ''}`); return 1;
    }
    selection = (deps.resolveSelection ?? resolveGuidedSessionSelection)({ config: {}, overrides: { ...overrides, provider: overrides.provider ?? providerResult.provider } });
  } else {
    const result = await (deps.loadConfig ?? loadMergedConfig)(projectRoot);
    if (!result.ok) { printError(`monitor: unable to resolve provider: ${result.error.message}`); return 1; }
    selection = (deps.resolveSelection ?? resolveGuidedSessionSelection)({ config: result.config, overrides });
  }
  if (selection.kind === 'refused') { printError(selection.message); return 1; }
  print(`monitor: guided sessions use provider=${selection.provider} (${selection.sources.provider}), model=${selection.model} (${selection.sources.model}), effort=${selection.effort} (${selection.sources.effort})`);

  const membership = deps.deriveQueueMembership ?? deriveQueueMembership;
  const run = deps.runGuidedMonitorQueue ?? runGuidedMonitorQueue;
  const open = deps.openGuidedSession ?? openGuidedSession;
  const interrupt = (deps.createInterrupt ?? createInterruptSignal)();
  const spine = (deps.startEventSpine ?? startOperatorEventSpine)(projectRoot);
  const priorityResolver = deps.priorityResolver ?? createPriorityResolver(
    ghIssueLabelReader(makeProductionGh(), projectRoot),
    print,
  );
  const readStoredDeferrals = deps.readDeferrals ?? readDeferrals;
  const snapshot = deps.snapshotHaltMarker ?? snapshotHaltMarker;
  const reconcileHaltIssues = deps.reconcileHaltIssues ?? (async (): Promise<HaltIssueReconciliationOutcome> => {
    const ghRepo = await (deps.haltIssuesRepository ?? haltIssuesRepository)(projectRoot);
    if (ghRepo === undefined) return { exitCode: 0, recordedErrorCount: 0, capturedLines: [] };
    const capturedLines: string[] = [];
    let recordedErrorCount = 0;
    const exitCode = await (deps.dispatchHaltIssuesSweep ?? dispatchHaltIssuesSweep)({
      kind: 'sweep',
      dryRun: false,
      repoDir: projectRoot,
      ghRepo,
      monitorLog: join(homedir(), '.ai-conductor', 'halt-monitor', 'monitor.log'),
      ledger: join(homedir(), '.ai-conductor', 'halt-issues', 'ledger.json'),
    }, projectRoot, {
      events: spine.events,
      output: {
        log: (line) => capturedLines.push(line),
        error: (line) => {
          recordedErrorCount += 1;
          capturedLines.push(line);
        },
      },
    });
    return { exitCode, recordedErrorCount, capturedLines };
  });
  let inventoryCode = 0;
  let terminalInventory = false;

  try {
    await run({
      deriveMembership: async () => {
        const result = await membership({ projectName: command.projectName });
        inventoryCode = Math.max(inventoryCode, result.code);
        terminalInventory = result.terminal === true;
        if (terminalInventory) return [];
        const deferralsByProject = new Map<string, Awaited<ReturnType<typeof readDeferrals>>>();
        for (const halt of result.halts) {
          if (!deferralsByProject.has(halt.project)) {
            deferralsByProject.set(halt.project, await readStoredDeferrals(halt.project, { report: print }));
          }
        }
        const orderable = await Promise.all(result.halts.map(async (halt) => ({
          ...halt,
          deferred: isDeferred(deferralsByProject.get(halt.project) ?? [], {
            project: halt.project,
            feature: halt.slug,
            haltIdentity: await snapshot(join(halt.project, '.worktrees', halt.slug)),
          }),
        })));
        return orderMonitorQueue(orderable, priorityResolver);
      },
      launch: (halt) => open({ provider: selection.provider, model: selection.model, effort: selection.effort, halt }),
      offer: (halt) => {
        const ordering = halt as typeof halt & { band?: string; orderingBasis?: string };
        print(
          `${halt.projectName ?? halt.project}: ${halt.slug} — ${halt.reason} (${displayHaltClassification(halt.haltClass)})` +
          `${ordering.band === undefined ? '' : ` [${ordering.band}; ${ordering.orderingBasis}]`}`,
        );
      },
      report: print,
      reconcileHaltIssues,
      events: spine.events,
      shouldStopAfterMembership: () => terminalInventory,
      untilStop: interrupt.untilStop,
    });
    return inventoryCode;
  } finally {
    interrupt.dispose();
    spine.stop();
  }
}
