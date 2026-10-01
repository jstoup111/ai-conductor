import { loadMergedConfig } from './config.js';
import { normalizeProviderSelection } from './provider-selection.js';
import { findBuiltInProviderDescriptor } from '../execution/provider-catalog.js';
import { createPriorityResolver, ghIssueLabelReader } from './backlog-priority.js';
import { makeProductionGh } from './tracker-client.js';
import { startOperatorEventSpine } from './event-persister.js';
import { dispatchHaltIssuesSweep } from './halt-issues/halt-issues-cli.js';
import { deriveQueueMembership } from './monitor/queue.js';
import { runGuidedMonitorQueue } from './monitor/loop.js';
import { openGuidedSession, displayHaltClassification } from './monitor/session.js';
import { readDeferrals, isDeferred } from './monitor/deferrals.js';
import { orderMonitorQueue, type MonitorPriorityResolver } from './monitor/ordering.js';
import { snapshotHaltMarker } from './halt-marker.js';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export type MonitorDispatch =
  | { readonly kind: 'run'; readonly projectName?: string }
  | { readonly kind: 'guide' };

export const MONITOR_USAGE =
  'Usage: ai-conductor monitor all|<project>\n' +
  '  Monitor halted features across every registered project, or one named project.\n';

/**
 * Parse the foreground monitor selector. A malformed `monitor` invocation is
 * deliberately still recognized, so it cannot fall through to the pipeline
 * launcher as a feature description.
 */
export function detectMonitorCommand(argv: readonly string[]): MonitorDispatch | null {
  if (argv[2] !== 'monitor') return null;
  const selector = argv[3];
  if (argv.length !== 4 || selector === undefined || selector.startsWith('-')) {
    return { kind: 'guide' };
  }
  return selector === 'all' ? { kind: 'run' } : { kind: 'run', projectName: selector };
}

interface MonitorProviderResolution {
  readonly provider?: string;
  readonly error?: string;
}

export interface MonitorCliDeps {
  readonly resolveProvider?: (projectRoot: string) => Promise<MonitorProviderResolution>;
  readonly deriveQueueMembership?: typeof deriveQueueMembership;
  readonly runGuidedMonitorQueue?: typeof runGuidedMonitorQueue;
  readonly openGuidedSession?: typeof openGuidedSession;
  readonly print?: (message: string) => void;
  readonly printError?: (message: string) => void;
  readonly createInterrupt?: () => { readonly untilStop: Promise<void>; readonly dispose: () => void };
  readonly priorityResolver?: MonitorPriorityResolver;
  readonly reconcileHaltIssues?: () => Promise<number>;
  readonly startEventSpine?: typeof startOperatorEventSpine;
  /** Filesystem seams keep the composed ordering boundary deterministic in tests. */
  readonly readDeferrals?: typeof readDeferrals;
  readonly snapshotHaltMarker?: typeof snapshotHaltMarker;
}

const execFileP = promisify(execFile);

async function resolveConfiguredProvider(projectRoot: string): Promise<MonitorProviderResolution> {
  const result = await loadMergedConfig(projectRoot);
  if (!result.ok) return { error: result.error.message };
  return { provider: normalizeProviderSelection(result.config.llm_provider)[0] };
}

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

  const providerResult = await (deps.resolveProvider ?? resolveConfiguredProvider)(projectRoot);
  if (providerResult.error !== undefined || providerResult.provider === undefined) {
    printError(`monitor: unable to resolve provider${providerResult.error ? `: ${providerResult.error}` : ''}`);
    return 1;
  }
  if (findBuiltInProviderDescriptor(providerResult.provider) === undefined) {
    printError(`monitor: unregistered provider ${providerResult.provider}.`);
    return 1;
  }

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
  const reconcileHaltIssues = deps.reconcileHaltIssues ?? (async () => {
    const ghRepo = await haltIssuesRepository(projectRoot);
    if (ghRepo === undefined) return 0;
    return dispatchHaltIssuesSweep({
      kind: 'sweep',
      dryRun: false,
      repoDir: projectRoot,
      ghRepo,
      monitorLog: join(homedir(), '.ai-conductor', 'halt-monitor', 'monitor.log'),
      ledger: join(homedir(), '.ai-conductor', 'halt-issues', 'ledger.json'),
    }, projectRoot, { events: spine.events });
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
      launch: (halt) => open({ provider: providerResult.provider!, halt }),
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
