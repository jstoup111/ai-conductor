import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConductorEventEmitter } from './conductor-event-emitter.js';
import { EventPersister } from './event-persister.js';
import { EXECUTOR_PROTOCOL_VERSION, parseExecutorMessage } from './executor-protocol.js';
import { versionIdFromEngineDir } from './engine-version-id.js';
import type { FeatureExecutionOutcome } from './feature-executor.js';
import type { WorkOrder } from './work-order.js';
import type { ExecutorIpcPort } from './executor-proxies.js';
import {
  createExecutorRequestClient,
  createLiveBoundaryProxy,
  createProviderAvailabilityProxy,
  createRateLimitEpisodeProxy,
  createWorktreeLifecycleProxy,
  teeExecutorConsole,
} from './executor-proxies.js';

export interface ExecutorChildDeps {
  /**
   * Legacy supervisor-provided value. Retained only for adapter compatibility;
   * child identity is always derived from `moduleDir` below.
   */
  engineVersionId?: string;
  /** Test seam; production always derives this module's own directory. */
  moduleDir?: string;
  supervisorEngineVersionId?: string;
  /**
   * Claims any root-owned dispatch coordination before the child binds its
   * feature worktree. A skipped admission is a normal daemon outcome.
   */
  admitDispatch?: (order: WorkOrder) => Promise<ExecutorChildDispatchAdmission>;
  /** Creates/reuses a worktree only after the supervisor has sent its order. */
  createWorktree(order: WorkOrder): Promise<{ path: string }>;
  run(input: ExecutorChildBaseRunInput): Promise<FeatureExecutionOutcome>;
  log?: (line: string) => void;
  exit?: (code: number) => void;
}

/** The child receives replicas of every dispatcher-owned coordination service. */
export interface ExecutorChildBaseRunInput {
  order: WorkOrder;
  /** Engine identity derived from this child process's loaded module. */
  engineVersionId: string;
  /** Supervisor pool width from the IPC envelope; retained for legacy guard parity. */
  effectiveConcurrency?: number;
  events: ConductorEventEmitter;
  signal: AbortSignal;
  /** Feature-scoped logger forwarded to the supervisor-owned daemon sink. */
  log?: (line: string) => void;
}

export type ExecutorChildDispatchAdmission =
  | { readonly kind: 'admitted'; readonly release?: () => Promise<unknown> }
  | { readonly kind: 'skipped'; readonly outcome: FeatureExecutionOutcome };

/**
 * The executor's identity belongs to the loaded child module, never to the
 * supervisor that forked it.  A published child runs from
 * `dist-versions/<id>/engine`; source and other unpublished runs degrade to
 * `dev`, matching shipped-record's existing non-blocking behavior.
 */
export function resolveExecutorChildEngineVersion(
  moduleDir = dirname(fileURLToPath(import.meta.url)),
): string {
  return versionIdFromEngineDir(moduleDir) ?? 'dev';
}

export interface ExecutorChildRunInput extends ExecutorChildBaseRunInput {
  rateLimitEpisode: ReturnType<typeof createRateLimitEpisodeProxy>;
  providerAvailability: ReturnType<typeof createProviderAvailabilityProxy>;
  liveBoundaryCoordinator: ReturnType<typeof createLiveBoundaryProxy>;
  worktreeLifecycle: ReturnType<typeof createWorktreeLifecycleProxy>;
}

/**
 * Compose the IPC replicas once, before the order arrives.  Keeping this
 * small factory outside the CLI makes the process boundary testable without
 * giving tests a real child process or any daemon-global state.
 */
export function withExecutorBrokerProxies(
  port: ExecutorIpcPort,
  deps: Omit<ExecutorChildDeps, 'run' | 'createWorktree'> & {
    createWorktree(order: WorkOrder, lifecycle: ReturnType<typeof createWorktreeLifecycleProxy>): Promise<{ path: string }>;
    run(input: ExecutorChildRunInput): Promise<FeatureExecutionOutcome>;
    liveBoundaryEnabled?: boolean;
  },
): ExecutorChildDeps {
  const client = createExecutorRequestClient(port);
  const restoreConsole = teeExecutorConsole(port);
  const run = deps.run;
  return {
    ...deps,
    createWorktree: (order) => deps.createWorktree(order, createWorktreeLifecycleProxy(client)),
    run: async (input: ExecutorChildBaseRunInput) => {
      try {
        return await run({
          ...input,
          log: deps.log,
          rateLimitEpisode: createRateLimitEpisodeProxy(client),
          providerAvailability: createProviderAvailabilityProxy(client),
          liveBoundaryCoordinator: createLiveBoundaryProxy(client, deps.liveBoundaryEnabled ?? false),
          worktreeLifecycle: createWorktreeLifecycleProxy(client),
        });
      } finally {
        restoreConsole();
        client.close('executor run complete');
      }
    },
  };
}

/**
 * Child-side protocol endpoint. Production composition supplies the existing
 * worktree and conductor seams; tests can exercise the protocol without a
 * real process. The child is the sole writer of its feature event ledger.
 */
export async function runExecutorChild(port: ExecutorIpcPort, deps: ExecutorChildDeps): Promise<void> {
  const engineVersionId = resolveExecutorChildEngineVersion(deps.moduleDir);
  const controller = new AbortController();
  let started = false;
  let complete = false;
  let finishWaitingForOrder: (() => void) | undefined;
  // The child disconnects and exits right after its outcome, so the send
  // must be flushed first: an unflushed outcome is dropped and the supervisor
  // records a shipped feature as `executor exited before outcome`.
  const sendOutcome = (outcome: FeatureExecutionOutcome): Promise<void> => {
    if (complete) return Promise.resolve();
    complete = true;
    return new Promise<void>((resolve) => {
      try {
        port.send({ kind: 'outcome', outcome }, () => resolve());
      } catch {
        // A closed channel cannot deliver; there is nothing left to flush.
        resolve();
      }
    });
  };
  const stop = (reason: string) => {
    if (!controller.signal.aborted) controller.abort(reason);
    // A supervisor can stop or disappear between hello and its work order.
    // Do not leave this otherwise-idle child attached to its inherited IPC
    // handle indefinitely; there is no feature state to report in that case.
    if (!started) finishWaitingForOrder?.();
  };
  port.on('disconnect', () => stop('supervisor disconnected'));
  port.on('message', (raw?: unknown) => {
    const parsed = parseExecutorMessage(raw);
    if (parsed.kind === 'ok' && parsed.message.kind === 'stop') stop(parsed.message.reason);
  });
  port.send({ kind: 'hello', protocolVersion: EXECUTOR_PROTOCOL_VERSION, engineVersionId });
  await new Promise<void>((resolve) => {
    finishWaitingForOrder = resolve;
    const receive = (raw?: unknown) => {
      const parsed = parseExecutorMessage(raw);
      if (parsed.kind !== 'ok' || parsed.message.kind !== 'work-order' || started) return;
      started = true;
      const order = parsed.message.order;
      // New supervisors provide this in the protocol envelope. Retain the
      // WorkOrder fallback so a new child remains compatible with a
      // supervisor that predates the envelope field.
      const effectiveConcurrency = parsed.message.effectiveConcurrency ?? order.effectiveConcurrency;
      void (async () => {
        try {
          const admission = await deps.admitDispatch?.(order);
          if (admission?.kind === 'skipped') {
            await sendOutcome(admission.outcome);
            return;
          }
          try {
            const worktree = await deps.createWorktree(order);
            const pipeline = join(worktree.path, '.pipeline');
            await mkdir(pipeline, { recursive: true });
            await writeFile(join(pipeline, 'work-order.json'), `${JSON.stringify(order)}\n`, 'utf8');
            const events = new ConductorEventEmitter();
            const persister = new EventPersister(join(pipeline, 'events.jsonl'), events);
            persister.start();
            for (const type of Object.keys((await import('./event-sinks.js')).EVENT_SINKS) as Array<import('../types/events.js').ConductorEvent['type']>) {
              events.on(type, (event) => { port.send({ kind: 'event', scope: event.type === 'feature_shipped' || event.type === 'provider_suppressed' ? 'root' : 'feature', payload: event }); });
            }
            await events.emit({
              type: 'executor_started', slug: order.slug, engineVersionId,
              protocolVersion: EXECUTOR_PROTOCOL_VERSION,
              supervisorEngineVersionId: deps.supervisorEngineVersionId ?? order.supervisorEngineVersionId ?? order.engineVersionId,
            });
            const outcome = controller.signal.aborted
              ? { slug: order.slug, status: 'parked' as const, reason: String(controller.signal.reason ?? 'stopped') }
              : await deps.run({ order, engineVersionId, effectiveConcurrency, events, signal: controller.signal });
            persister.stop();
            await sendOutcome(outcome);
          } finally {
            await admission?.release?.();
          }
        } catch (error) {
          await sendOutcome({ slug: order.slug, status: 'error', reason: error instanceof Error ? error.message : String(error) });
        } finally { resolve(); }
      })();
    };
    port.on('message', receive);
  });
  // The work order has one terminal response. Leaving IPC open retains the
  // child and its broker listeners after a completed feature.
  port.disconnect?.();
  deps.exit?.(0);
}
