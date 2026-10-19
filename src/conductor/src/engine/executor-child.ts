import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ConductorEventEmitter } from '../ui/events.js';
import { EventPersister } from './event-persister.js';
import { EXECUTOR_PROTOCOL_VERSION, parseExecutorMessage } from './executor-protocol.js';
import type { FeatureExecutionOutcome } from './feature-executor.js';
import type { WorkOrder } from './work-order.js';
import type { ExecutorIpcPort } from './executor-proxies.js';

export interface ExecutorChildDeps {
  engineVersionId: string;
  supervisorEngineVersionId?: string;
  /** Creates/reuses a worktree only after the supervisor has sent its order. */
  createWorktree(order: WorkOrder): Promise<{ path: string }>;
  run(input: { order: WorkOrder; events: ConductorEventEmitter; signal: AbortSignal }): Promise<FeatureExecutionOutcome>;
  log?: (line: string) => void;
  exit?: (code: number) => void;
}

/**
 * Child-side protocol endpoint. Production composition supplies the existing
 * worktree and conductor seams; tests can exercise the protocol without a
 * real process. The child is the sole writer of its feature event ledger.
 */
export async function runExecutorChild(port: ExecutorIpcPort, deps: ExecutorChildDeps): Promise<void> {
  const controller = new AbortController();
  let started = false;
  let complete = false;
  const sendOutcome = (outcome: FeatureExecutionOutcome) => {
    if (complete) return;
    complete = true;
    port.send({ kind: 'outcome', outcome });
  };
  const stop = (reason: string) => {
    if (!controller.signal.aborted) controller.abort(reason);
  };
  port.on('disconnect', () => stop('supervisor disconnected'));
  port.on('message', (raw?: unknown) => {
    const parsed = parseExecutorMessage(raw);
    if (parsed.kind === 'ok' && parsed.message.kind === 'stop') stop(parsed.message.reason);
  });
  port.send({ kind: 'hello', protocolVersion: EXECUTOR_PROTOCOL_VERSION, engineVersionId: deps.engineVersionId });
  await new Promise<void>((resolve) => {
    const receive = (raw?: unknown) => {
      const parsed = parseExecutorMessage(raw);
      if (parsed.kind !== 'ok' || parsed.message.kind !== 'work-order' || started) return;
      started = true;
      const order = parsed.message.order;
      void (async () => {
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
            type: 'executor_started', slug: order.slug, engineVersionId: order.engineVersionId,
            protocolVersion: EXECUTOR_PROTOCOL_VERSION,
            supervisorEngineVersionId: deps.supervisorEngineVersionId ?? order.engineVersionId,
          });
          const outcome = controller.signal.aborted
            ? { slug: order.slug, status: 'parked' as const, reason: String(controller.signal.reason ?? 'stopped') }
            : await deps.run({ order, events, signal: controller.signal });
          persister.stop();
          sendOutcome(outcome);
        } catch (error) {
          sendOutcome({ slug: order.slug, status: 'error', reason: error instanceof Error ? error.message : String(error) });
        } finally { resolve(); }
      })();
    };
    port.on('message', receive);
  });
  deps.exit?.(0);
}
