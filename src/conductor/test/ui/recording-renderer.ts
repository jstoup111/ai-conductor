import type { ConductorEvent } from '../../src/types/index.js';
import type { UIRenderer } from '../../src/ui/types.js';

/**
 * Test double for UIRenderer. Records every event passed to handle() so tests
 * can assert which events were dispatched. Also records whether stop() was called.
 */
export class RecordingRenderer implements UIRenderer {
  readonly events: ConductorEvent[] = [];
  stopCalled = false;

  /** Simulates a slow renderer when set. Resolves after the given ms. */
  delayMs = 0;

  /** When set, handle() will throw this error. */
  throwError: Error | null = null;

  async handle(event: ConductorEvent): Promise<void> {
    if (this.throwError) {
      throw this.throwError;
    }
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    this.events.push(event);
  }

  stop(): void {
    this.stopCalled = true;
  }

  reset(): void {
    this.events.length = 0;
    this.stopCalled = false;
    this.delayMs = 0;
    this.throwError = null;
  }
}
