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

export interface ForkedExecutor extends ExecutorIpcPort {
  pid?: number;
  /** Present when Node forks with `silent: true`. */
  stdout?: NodeJS.ReadableStream | null;
  stderr?: NodeJS.ReadableStream | null;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}

export interface ChildFeatureExecutorDeps {
  projectRoot: string;
  /** Resolves the immutable directory named by a WorkOrder pin. */
  engineDirForOrder: (order: WorkOrder, useSupervisorBuild: boolean) => string;
  supervisorEngineVersionId: string;
  rootEvents: ConductorEventEmitter;
  attachBroker: (slug: string, port: ExecutorIpcPort, engineVersionId?: string) => ExecutorBrokerAttachment;
  fork?: (modulePath: string, args: string[], options: { silent: true; execArgv?: string[] }) => ForkedExecutor;
  dispatchStartTimeoutMs?: number;
  teardownTimeoutMs?: number;
  /**
   * The supervisor gates D7's drain fallback. Return true only when this
   * mismatch was recorded as a restart request; consumer daemons return false.
   */
  onProtocolMismatch?: () => boolean;
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
  let stopAllPromise: Promise<void> | undefined;

  const launch = async (order: WorkOrder, useSupervisorBuild: boolean, priorFailure?: string): Promise<FeatureExecutionOutcome> => {
    const engineDir = deps.engineDirForOrder(order, useSupervisorBuild);
    // A fallback child executes the supervisor build, not the original failed
    // pin.  Publish that actual identity into its work order and durable
    // record, otherwise status and shipped telemetry lie about the executor.
    const launchedOrder: WorkOrder = {
      ...order,
      ...(useSupervisorBuild ? { engineVersionId: deps.supervisorEngineVersionId as WorkOrder['engineVersionId'] } : {}),
      supervisorEngineVersionId: deps.supervisorEngineVersionId as WorkOrder['engineVersionId'],
    };
    const modulePath = join(engineDir, 'index.js');
    const child = fork(modulePath, ['executor-child'], { silent: true });
    // Piped output must be drained even when the child uses console.log rather
    // than the IPC console tee; otherwise a full OS pipe can deadlock it.
    const forwardOutput = (stream: NodeJS.ReadableStream | null | undefined, level: 'stdout' | 'stderr') => {
      if (!stream) return;
      let remainder = '';
      stream.on('data', (chunk: Buffer | string) => {
        remainder += String(chunk);
        const lines = remainder.split(/\r?\n/);
        remainder = lines.pop() ?? '';
        for (const line of lines) deps.log?.(`[executor ${order.slug} ${level}] ${line}`);
      });
      stream.on('end', () => { if (remainder) deps.log?.(`[executor ${order.slug} ${level}] ${remainder}`); });
      stream.resume();
    };
    forwardOutput(child.stdout, 'stdout');
    forwardOutput(child.stderr, 'stderr');
    const attachment = deps.attachBroker(order.slug, child, launchedOrder.engineVersionId);
    const entry: RunningChild = { child, order: launchedOrder, attachment };
    running.add(entry);
    // Publish the pin immediately after fork, before waiting for the child's
    // hello.  A child is live as soon as fork returns; delaying this until the
    // handshake leaves a window in which engine-store GC can reclaim its
    // module.  Exit cleanup below waits for this promise, so an exit racing a
    // slow write can never leave a newly-written stale record behind.
    let recordFailure: Error | undefined;
    let ended = false;
    let terminationTimer: ReturnType<typeof setTimeout> | undefined;
    const requestTermination = () => {
      child.kill('SIGTERM');
      // A record publication failure is no less terminal than a failed
      // handshake: it must use the same bounded TERM→KILL path.
      terminationTimer ??= setTimeout(() => {
        if (!ended) child.kill('SIGKILL');
      }, teardownTimeoutMs);
    };
    const recordPublished = writeExecutorRecord(deps.projectRoot, order.slug, {
      pid: child.pid ?? -1, engineDir, engineVersionId: launchedOrder.engineVersionId, startedAt: new Date().toISOString(),
    }).catch((error: unknown) => {
      recordFailure = error instanceof Error ? error : new Error(String(error));
      deps.log?.(`[executor ${order.slug}] could not publish executor record: ${recordFailure.message}`);
      requestTermination();
    });
    let outcome: FeatureExecutionOutcome | undefined;
    let handshake: 'accepted' | 'failed' | 'missing' | undefined;
    let handshakeFailure: string | undefined;
    let protocolMismatchEvent: Promise<void> | undefined;
    let workOrderSent = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = async (result: FeatureExecutionOutcome): Promise<FeatureExecutionOutcome> => {
      if (ended) return outcome ?? result;
      ended = true; outcome = result;
      if (timer) clearTimeout(timer);
      if (terminationTimer) clearTimeout(terminationTimer);
      attachment.close(); running.delete(entry);
      // A record write started at fork may complete after an early child exit.
      // Serialize removal after it so records only disappear following the
      // actual exit and cannot be resurrected by that racing write.
      await recordPublished;
      await removeExecutorRecord(deps.projectRoot, order.slug).catch(() => {});
      return result;
    };
    const done = new Promise<FeatureExecutionOutcome>((resolve) => {
      child.once('exit', (code, signal) => {
        const reason = outcome?.reason ?? (code === 134 || signal === 'SIGABRT' ? 'executor exited from V8 heap exhaustion' : `executor exited before outcome (code ${code ?? 'null'}, signal ${signal ?? 'none'})`);
        void finish(outcome ?? errorOutcome(order, reason)).then(resolve);
      });
    });
    const rejectHandshake = (
      reason: string,
      actualProtocolVersion?: number,
    ): void => {
      if (handshake !== undefined) return;
      handshake = 'failed';
      handshakeFailure = reason;
      const restartRequested = deps.onProtocolMismatch?.() === true;
      protocolMismatchEvent = deps.rootEvents.emit({
        type: 'executor_protocol_mismatch',
        slug: order.slug,
        engineVersionId: launchedOrder.engineVersionId,
        expectedProtocolVersion: EXECUTOR_PROTOCOL_VERSION,
        ...(actualProtocolVersion === undefined ? {} : { actualProtocolVersion }),
        reason,
        restartRequested,
      });
      requestTermination();
    };
    timer = setTimeout(() => {
      if (handshake === undefined) {
        handshake = 'missing';
        handshakeFailure = 'executor missing startup handshake';
        requestTermination();
      }
    }, startTimeoutMs);
    child.on('message', (raw?: unknown) => {
      const parsed = parseExecutorMessage(raw);
      if (parsed.kind === 'malformed') {
        deps.log?.(`[executor ${order.slug}] malformed child message: ${parsed.reason}`);
        if (handshake === undefined) {
          rejectHandshake(`malformed executor startup handshake: ${parsed.reason}`);
        }
        return;
      }
      const message = parsed.message;
      if (message.kind === 'hello' && handshake === undefined) {
        if (message.protocolVersion !== EXECUTOR_PROTOCOL_VERSION) {
          rejectHandshake(
            `executor protocol mismatch: expected ${EXECUTOR_PROTOCOL_VERSION}, received ${message.protocolVersion}`,
            message.protocolVersion,
          );
          return;
        }
        handshake = 'accepted';
        void recordPublished.then(() => {
          // The handshake permits work only once the live child is durably
          // pinned.  Do not send after a record failure or an early exit.
          if (recordFailure || ended || workOrderSent) return;
          workOrderSent = true;
          child.send({
            kind: 'work-order',
            order: launchedOrder,
            ...(launchedOrder.effectiveConcurrency === undefined
              ? {}
              : { effectiveConcurrency: launchedOrder.effectiveConcurrency }),
          } satisfies ExecutorMessage);
        });
        return;
      }
      if (message.kind === 'outcome') {
        if (outcome) { deps.log?.(`[executor ${order.slug}] ignored duplicate outcome`); return; }
        outcome = message.outcome;
        // The child may stay connected due to a leaked handle. Preserve its
        // terminal result but bound the supervisor resource lifetime.
        void delay(teardownTimeoutMs).then(() => { if (!ended) requestTermination(); });
      }
    });
    const result = await done;
    if (recordFailure) return errorOutcome(order, `could not publish executor record: ${recordFailure.message}`);
    await protocolMismatchEvent;
    if (handshake === 'failed' && !useSupervisorBuild) {
      const reason = handshakeFailure ?? 'executor protocol handshake failed';
      return launch(order, true, reason);
    }
    if (handshake === 'failed' && useSupervisorBuild) {
      return errorOutcome(
        order,
        `${priorFailure ?? 'executor handshake failed'}; supervisor-build relaunch handshake failed: ${handshakeFailure ?? 'unknown handshake failure'}`,
      );
    }
    if (handshake === 'missing') return errorOutcome(order, handshakeFailure ?? 'executor missing startup handshake');
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
      // Fork and broker construction are process boundaries too.  Preserve the
      // dispatch pair even when either fails synchronously before a child can
      // report an outcome; otherwise a durable start record would have no
      // matching collection record.
      let result: FeatureExecutionOutcome;
      try {
        result = await launch(order, false);
      } catch (error) {
        result = errorOutcome(order, error instanceof Error ? error.message : String(error));
      }
      await deps.rootEvents.emit({
        type: 'feature_dispatch_ended', slug: order.slug,
        outcome: result.status === 'done' ? 'complete' : result.status === 'halted' || result.status === 'parked' ? 'halted' : 'terminated',
        ...(result.status === 'halted' && result.halt
          ? { step: result.halt.step, haltClass: result.halt.haltClass }
          : {}),
      });
      return result;
    },
    async stopAll() {
      if (stopAllPromise) return stopAllPromise;
      const children = [...running];
      if (children.length === 0) return;
      stopAllPromise = (async () => {
        for (const entry of children) entry.child.send({ kind: 'stop', reason: 'supervisor shutdown' });
        // The supervisor gives every concurrently draining executor a full
        // teardown allowance.  This matches its lock-release budget and
        // avoids killing a healthy later child merely because an earlier one
        // consumed the first slice of the shutdown window.
        await delay(teardownTimeoutMs * children.length);
        for (const entry of children) {
          // A cooperative child may have exited during the grace period.
          // SIGKILL only children still owned by this adapter, then report
          // completion so the daemon can continue its bounded lock drain.
          if (running.has(entry)) entry.child.kill('SIGKILL');
        }
      })();
      return stopAllPromise;
    },
  };
}
