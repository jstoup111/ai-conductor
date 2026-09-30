import { classifyNetworkError, classifyResponse } from './delivery-classifier.js';
import { type SpoolSignal, SpoolStore } from './spool-store.js';

export interface SpoolDrainerOptions {
  endpoint: string;
  /** Resolves credentials at delivery time; spool files never contain them. */
  headers: () => Record<string, string>;
  fetch?: typeof globalThis.fetch;
}

/**
 * Delivers immutable OTLP batches one at a time. Delivery is at-least-once:
 * a process failure after acceptance but before deletion leaves the batch for
 * the next drainer.
 */
export class SpoolDrainer {
  private readonly send: typeof globalThis.fetch;

  constructor(
    private readonly store: SpoolStore,
    private readonly options: SpoolDrainerOptions,
  ) {
    this.send = options.fetch ?? globalThis.fetch;
  }

  async drain(): Promise<void> {
    await Promise.all((['traces', 'metrics'] as const).map((signal) => this.drainSignal(signal)));
  }

  private async drainSignal(signal: SpoolSignal): Promise<void> {
    for (const batch of await this.store.list(signal)) {
      const body = await this.store.read(batch);
      let classification;
      try {
        const response = await this.send(`${this.options.endpoint.replace(/\/$/, '')}/v1/${signal}`, {
          method: 'POST',
          headers: { ...this.options.headers(), 'Content-Type': 'application/x-protobuf' },
          body: new Uint8Array(body).buffer as ArrayBuffer,
        });
        classification = classifyResponse(
          response.status,
          new Uint8Array(await response.arrayBuffer()),
          Object.fromEntries(response.headers.entries()),
          signal,
        );
      } catch {
        classification = classifyNetworkError();
      }

      if (classification.action === 'keep') return;
      await this.store.delete(batch);
    }
  }
}
