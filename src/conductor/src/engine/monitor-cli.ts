import { loadMergedConfig } from './config.js';
import { normalizeProviderSelection } from './provider-selection.js';
import { deriveQueueMembership } from './monitor/queue.js';
import { runGuidedMonitorQueue } from './monitor/loop.js';
import { openGuidedSession } from './monitor/session.js';

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
}

async function resolveConfiguredProvider(projectRoot: string): Promise<MonitorProviderResolution> {
  const result = await loadMergedConfig(projectRoot);
  if (!result.ok) return { error: result.error.message };
  return { provider: normalizeProviderSelection(result.config.llm_provider)[0] };
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

  const membership = deps.deriveQueueMembership ?? deriveQueueMembership;
  const run = deps.runGuidedMonitorQueue ?? runGuidedMonitorQueue;
  const open = deps.openGuidedSession ?? openGuidedSession;
  const interrupt = (deps.createInterrupt ?? createInterruptSignal)();
  let inventoryCode = 0;

  try {
    await run({
      deriveMembership: async () => {
        const result = await membership({ projectName: command.projectName });
        inventoryCode = Math.max(inventoryCode, result.code);
        return result.halts;
      },
      launch: (halt) => open({ provider: providerResult.provider!, halt }),
      offer: (halt) => print(
        `${halt.projectName ?? halt.project}: ${halt.slug} — ${halt.reason} (${halt.haltClass})`,
      ),
      report: print,
      untilStop: interrupt.untilStop,
    });
    return inventoryCode;
  } finally {
    interrupt.dispose();
  }
}
