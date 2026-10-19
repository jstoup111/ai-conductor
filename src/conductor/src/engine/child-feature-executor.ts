import { fork as nodeFork } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import type { ConductorEventEmitter } from '../ui/events.js';
import type { FeatureExecutionOutcome, FeatureExecutor } from './feature-executor.js';
import type { WorkOrder } from './work-order.js';
import { EXECUTOR_PROTOCOL_VERSION, parseExecutorMessage, type ExecutorMessage } from './executor-protocol.js';
import type { ExecutorIpcPort } from './executor-proxies.js';
import type { ExecutorBrokerAttachment } from './executor-broker.js';
import { removeExecutorRecord, writeExecutorRecord } from './executor-records.js';
import { versionIdFromEngineDir } from './engine-version-id.js';

export interface ForkedExecutor extends ExecutorIpcPort {
  pid?: number;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}

export interface ChildFeatureExecutorDeps {
  projectRoot: string;
  /** Resolves the immutable directory named by a WorkOrder pin. */
  engineDirForOrder: (order: WorkOrder, useSupervisorBuild: boolean) => string;
  supervisorEngineVersionId: string;
  rootEvents: ConductorEventEmitter;
  attachBroker: (slug: string, port: ExecutorIpcPort) => ExecutorBrokerAttachment;
  fork?: (modulePath: string, args: string[], options: { silent: true; execArgv?: string[] }) => ForkedExecutor;
  dispatchStartTimeoutMs?: number;
  teardownTimeoutMs?: number;
  /** True only when a protocol mismatch should request the D7 drain fallback. */
  onProtocolMismatch?: () => void;
  log?: (line: string) => void;
}

interface RunningChild { child: ForkedExecutor; order: WorkOrder; attachment: ExecutorBrokerAttachment; }

function errorOutcome(order: WorkOrder, reason: string): FeatureExecutionOutcome {
  return { slug: order.slug, status: 'error', reason };
}

/**
 * Process-isolated executor adapter. The supervisor owns root events, durable
 * executor references and all terminal effects; the child owns its worktree.
 */
export function createChildProcessFeatureExecutor(deps: ChildFeatureExecutorDeps): FeatureExecutor & { stopAll(): Promise<void> } {
  const fork = deps.fork ?? ((modulePath, args, options) => nodeFork(modulePath, args, options) as unknown as ForkedExecutor);
  const running = new Set<RunningChild>();
  const startTimeoutMs = deps.dispatchStartTimeoutMs ?? 30_000;
  const teardownTimeoutMs = deps.teardownTimeoutMs ?? 15_000;

  const launch = async (order: WorkOrder, useSupervisorBuild: boolean, priorFailure?: string): Promise<FeatureExecutionOutcome> => {
    const engineDir = deps.engineDirForOrder(order, useSupervisorBuild);
    // A fallback child executes the supervisor build, not the original failed
    // pin.  Publish that actual identity into its work order and durable
    // record, otherwise status and shipped telemetry lie about the executor.
    const launchedOrder: WorkOrder = {
      ...order,
      ...(useSupervisorBuild ? { engineVersionId: versionIdFromEngineDir(engineDir) ?? order.engineVersionId } : {}),
      supervisorEngineVersionId: deps.supervisorEngineVersionId as WorkOrder['engineVersionId'],
    };
    const modulePath = join(engineDir, 'index.js');
    const child = fork(modulePath, ['executor-child'], { silent: true });
    const attachment = deps.attachBroker(order.slug, child);
    const entry: RunningChild = { child, order: launchedOrder, attachment };
    running.add(entry);
    let ended = false;
    let outcome: FeatureExecutionOutcome | undefined;
    let handshake: 'accepted' | 'failed' | 'missing' | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = async (result: FeatureExecutionOutcome): Promise<FeatureExecutionOutcome> => {
      if (ended) return outcome ?? result;
      ended = true; outcome = result;
      if (timer) clearTimeout(timer);
      attachment.close(); running.delete(entry);
      await removeExecutorRecord(deps.projectRoot, order.slug).catch(() => {});
      return result;
    };
    const done = new Promise<FeatureExecutionOutcome>((resolve) => {
      child.once('exit', (code, signal) => {
        const reason = outcome?.reason ?? (code === 134 || signal === 'SIGABRT' ? 'executor exited from V8 heap exhaustion' : `executor exited before outcome (code ${code ?? 'null'}, signal ${signal ?? 'none'})`);
        void finish(outcome ?? errorOutcome(order, reason)).then(resolve);
      });
    });
    timer = setTimeout(() => {
      if (handshake === undefined) {
        handshake = 'missing';
        child.kill('SIGTERM');
      }
    }, startTimeoutMs);
    child.on('message', (raw?: unknown) => {
      const parsed = parseExecutorMessage(raw);
      if (parsed.kind === 'malformed') {
        deps.log?.(`[executor ${order.slug}] malformed child message: ${parsed.reason}`);
        if (handshake === undefined) {
          handshake = 'failed';
          deps.onProtocolMismatch?.();
          child.kill('SIGTERM');
        }
        return;
      }
      const message = parsed.message;
      if (message.kind === 'hello' && handshake === undefined) {
        if (message.protocolVersion !== EXECUTOR_PROTOCOL_VERSION) {
          handshake = 'failed'; deps.onProtocolMismatch?.(); child.kill('SIGTERM'); return;
        }
        handshake = 'accepted';
        void writeExecutorRecord(deps.projectRoot, order.slug, {
          pid: child.pid ?? -1, engineDir, engineVersionId: launchedOrder.engineVersionId, startedAt: new Date().toISOString(),
        }).then(() => child.send({ kind: 'work-order', order: launchedOrder } satisfies ExecutorMessage));
        return;
      }
      if (message.kind === 'outcome') {
        if (outcome) { deps.log?.(`[executor ${order.slug}] ignored duplicate outcome`); return; }
        outcome = message.outcome;
        // The child may stay connected due to a leaked handle. Preserve its
        // terminal result but bound the supervisor resource lifetime.
        void delay(teardownTimeoutMs).then(() => { if (!ended) child.kill('SIGTERM'); });
      }
    });
    const result = await done;
    if (handshake === 'failed' && !useSupervisorBuild) {
      const reason = priorFailure ?? 'executor protocol handshake failed';
      return launch(order, true, reason);
    }
    if (handshake === 'failed' && useSupervisorBuild) return errorOutcome(order, `${priorFailure ?? 'executor handshake failed'}; supervisor-build relaunch handshake failed`);
    if (handshake === 'missing') return errorOutcome(order, 'executor missing startup handshake');
    return result;
  };

  return {
    async execute(order) {
      // Dispatch lifecycle belongs to the claim, not a particular fork. A
      // protocol fallback may launch twice, but the durable daemon ledger must
      // still contain exactly one start/end pair for that claim.
      await deps.rootEvents.emit({
        type: 'feature_dispatch_started', slug: order.slug, kind: 'initial',
        engineVersionId: order.engineVersionId,
        ...(order.pinFallbackReason === undefined ? {} : { pinFallbackReason: order.pinFallbackReason }),
      });
      const result = await launch(order, false);
      await deps.rootEvents.emit({
        type: 'feature_dispatch_ended', slug: order.slug,
        outcome: result.status === 'done' ? 'complete' : result.status === 'halted' || result.status === 'parked' ? 'halted' : 'terminated',
      });
      return result;
    },
    async stopAll() {
      const children = [...running];
      for (const entry of children) entry.child.send({ kind: 'stop', reason: 'supervisor shutdown' });
      await delay(teardownTimeoutMs);
      for (const entry of children) entry.child.kill('SIGTERM');
    },
  };
}
