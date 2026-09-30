import { classifyNetworkError, classifyResponse, type DeliveryClassification } from './delivery-classifier.js';
import type { ConductorEventEmitter } from '../../ui/events.js';
import { type SpoolSignal, SpoolStore } from './spool-store.js';

export interface SpoolDrainerOptions {
  endpoint: string;
  /** Resolves credentials at delivery time; spool files never contain them. */
  headers: () => Record<string, string>;
  fetch?: typeof globalThis.fetch;
  /** Injectable time boundary for retry tests. */
  now?: () => number;
  /** Injectable delay boundary for retry tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable delay boundary for periodic backlog reporting. */
  backlogSleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Injectable jitter source for retry tests. */
  random?: () => number;
  /** Maximum time a single OTLP/HTTP request may remain in flight. */
  exportTimeoutMs?: number;
  /** Optional event-spine owner for durable spool delivery telemetry. */
  events?: ConductorEventEmitter;
}

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
const DEFAULT_EXPORT_TIMEOUT_MS = 5_000;
const BACKLOG_REPORT_INTERVAL_MS = 30_000;
type DeliveryFailureClass = Extract<DeliveryClassification, { action: 'keep' }>['failureClass'];

/**
 * Delivers immutable OTLP batches one at a time. Delivery is at-least-once:
 * a process failure after acceptance but before deletion leaves the batch for
 * the next drainer.
 */
export class SpoolDrainer {
  private readonly send: typeof globalThis.fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly backlogSleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly random: () => number;
  private readonly exportTimeoutMs: number;
  private readonly inFlight = new Set<AbortController>();
  private readonly pendingDelays = new Set<() => void>();
  private readonly loops = new Set<Promise<void>>();
  private readonly lastFailures = new Map<SpoolSignal, DeliveryFailureClass>();
  private readonly reportedFailures = new Map<SpoolSignal, DeliveryFailureClass>();
  private stopped = false;

  constructor(
    private readonly store: SpoolStore,
    private readonly options: SpoolDrainerOptions,
    private readonly events: ConductorEventEmitter | undefined = options.events,
  ) {
    this.send = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.backlogSleep = options.backlogSleep ?? ((ms, signal) => new Promise((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      const timeout = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
    }));
    this.random = options.random ?? Math.random;
    this.exportTimeoutMs = options.exportTimeoutMs ?? DEFAULT_EXPORT_TIMEOUT_MS;
  }

  /** Last retained delivery failure for this signal, for backlog telemetry. */
  lastFailureClass(signal: SpoolSignal): DeliveryFailureClass | undefined {
    return this.lastFailures.get(signal);
  }

  async drain(): Promise<void> {
    if (this.stopped) return;
    const loops = (['traces', 'metrics'] as const).map((signal) => {
      const loop = this.drainSignal(signal);
      this.loops.add(loop);
      void loop.then(
        () => this.loops.delete(loop),
        () => this.loops.delete(loop),
      );
      return loop;
    });
    const deliveriesDone = Promise.allSettled(loops).then(() => undefined);
    const backlogLoop = this.reportBacklog(deliveriesDone);
    this.loops.add(backlogLoop);
    void backlogLoop.then(
      () => this.loops.delete(backlogLoop),
      () => this.loops.delete(backlogLoop),
    );
    await Promise.all(loops);
  }

  /** Stops retries and asks every currently active request to abort. */
  async stop(): Promise<void> {
    this.stopped = true;
    for (const controller of this.inFlight) controller.abort();
    for (const release of this.pendingDelays) release();

    const loops = [...this.loops];
    if (loops.length === 0) return;
    await Promise.race([
      Promise.allSettled(loops).then(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, this.exportTimeoutMs)),
    ]);
  }

  private async drainSignal(signal: SpoolSignal): Promise<void> {
    for (const batch of await this.store.list(signal)) {
      if (this.stopped) return;
      const body = await this.store.read(batch);
      let backoffMs = INITIAL_BACKOFF_MS;

      while (!this.stopped) {
        const classification = await this.deliver(signal, body);
        if (this.stopped) return;
        if (classification.action !== 'keep') {
          await this.store.delete(batch);
          if (classification.action === 'delete' && this.reportedFailures.delete(signal)) {
            await this.events?.emit({
              type: 'renderer_error',
              rendererName: 'otel',
              error: `OTLP ${signal} delivery recovered`,
            });
          }
          if (classification.action === 'drop') {
            await this.events?.emit({
              type: 'otel_spool_drop',
              signal,
              reason: classification.reason,
              batches: 1,
              items: classification.rejectedItems || batch.items,
              status: classification.status,
            });
          }
          break;
        }

        this.lastFailures.set(signal, classification.failureClass);
        if (this.reportedFailures.get(signal) !== classification.failureClass) {
          this.reportedFailures.set(signal, classification.failureClass);
          await this.events?.emit({
            type: 'renderer_error',
            rendererName: 'otel',
            error: `OTLP ${signal} delivery failed: ${classification.failureClass}`,
          });
        }

        // A server-directed delay takes precedence over the ordinary backoff.
        if (classification.retryAfterMs !== undefined) {
          await this.delay(classification.retryAfterMs);
          continue;
        }

        await this.delay(this.backoffWithJitter(backoffMs));
        backoffMs = Math.min(MAX_BACKOFF_MS, backoffMs * 2);
      }
    }
  }

  private async deliver(signal: SpoolSignal, body: Buffer) {
    const controller = new AbortController();
    this.inFlight.add(controller);
    const timeout = setTimeout(() => controller.abort(), this.exportTimeoutMs);
    try {
      const response = await this.send(`${this.options.endpoint.replace(/\/$/, '')}/v1/${signal}`, {
        method: 'POST',
        headers: { ...this.options.headers(), 'Content-Type': 'application/x-protobuf' },
        body: new Uint8Array(body).buffer as ArrayBuffer,
        signal: controller.signal,
      });
      return classifyResponse(
        response.status,
        new Uint8Array(await response.arrayBuffer()),
        Object.fromEntries(response.headers.entries()),
        signal,
      );
    } catch {
      return classifyNetworkError();
    } finally {
      clearTimeout(timeout);
      this.inFlight.delete(controller);
    }
  }

  private backoffWithJitter(backoffMs: number): number {
    // Keep the base delay as the lower bound so deterministic random() = 0
    // yields the documented 1 s, 2 s, ... progression.
    return Math.min(MAX_BACKOFF_MS, Math.floor(backoffMs * (1 + this.random())));
  }

  private async reportBacklog(deliveriesDone: Promise<void>): Promise<void> {
    while (!this.stopped) {
      let deliveriesFinished = false;
      const controller = new AbortController();
      await Promise.race([
        this.backlogDelay(BACKLOG_REPORT_INTERVAL_MS, controller.signal),
        deliveriesDone.then(() => {
          deliveriesFinished = true;
          controller.abort();
        }),
      ]);
      if (this.stopped || deliveriesFinished) return;

      for (const signal of ['traces', 'metrics'] as const) {
        const batches = await this.store.list(signal);
        const lastFailureClass = this.lastFailures.get(signal);
        if (batches.length === 0 || lastFailureClass === undefined) continue;

        const oldestCreatedAt = Number(batches[0].name.slice(0, 15));
        await this.events?.emit({
          type: 'otel_spool_backlog',
          signal,
          files: batches.length,
          bytes: batches.reduce((total, batch) => total + batch.size, 0),
          oldestAgeMs: Math.max(0, this.now() - oldestCreatedAt),
          lastFailureClass,
        });
      }
    }
  }

  private async delay(ms: number): Promise<void> {
    if (this.stopped) return;
    const due = this.now() + ms;
    let release!: () => void;
    const interrupted = new Promise<void>((resolve) => { release = resolve; });
    this.pendingDelays.add(release);
    try {
      await Promise.race([
        this.sleep(Math.max(0, due - this.now())),
        interrupted,
      ]);
    } finally {
      this.pendingDelays.delete(release);
    }
  }

  private async backlogDelay(ms: number, signal: AbortSignal): Promise<void> {
    if (this.stopped) return;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const interrupted = new Promise<void>((resolve) => {
      controller.signal.addEventListener('abort', resolve, { once: true });
    });
    const release = abort;
    this.pendingDelays.add(release);
    try {
      await Promise.race([this.backlogSleep(ms, controller.signal), interrupted]);
    } finally {
      this.pendingDelays.delete(release);
      signal.removeEventListener('abort', abort);
    }
  }
}
