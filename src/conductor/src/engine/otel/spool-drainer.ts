import { classifyNetworkError, classifyResponse } from './delivery-classifier.js';
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
  /** Injectable jitter source for retry tests. */
  random?: () => number;
  /** Maximum time a single OTLP/HTTP request may remain in flight. */
  exportTimeoutMs?: number;
}

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
const DEFAULT_EXPORT_TIMEOUT_MS = 5_000;

/**
 * Delivers immutable OTLP batches one at a time. Delivery is at-least-once:
 * a process failure after acceptance but before deletion leaves the batch for
 * the next drainer.
 */
export class SpoolDrainer {
  private readonly send: typeof globalThis.fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly exportTimeoutMs: number;
  private readonly inFlight = new Set<AbortController>();
  private readonly pendingDelays = new Set<() => void>();
  private readonly loops = new Set<Promise<void>>();
  private stopped = false;

  constructor(
    private readonly store: SpoolStore,
    private readonly options: SpoolDrainerOptions,
  ) {
    this.send = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
    this.exportTimeoutMs = options.exportTimeoutMs ?? DEFAULT_EXPORT_TIMEOUT_MS;
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
          break;
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
}
