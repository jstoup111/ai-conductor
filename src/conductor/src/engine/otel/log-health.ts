import type { ConductorEventEmitter } from '../../ui/events.js';

export type LogFailureClass = 'auth' | 'endpoint' | 'network' | 'policy' | 'storage' | 'dropped' | 'timeout' | 'response';

/**
 * Bounded, local-only log-delivery health.  It deliberately reports classes,
 * never URLs, credentials, response bodies, or thrown error text.  The event
 * spine's renderer_error sink persists and renders this without subscribing
 * the log exporter, so health can never recursively export itself.
 */
export class LogHealth {
  private lastSummary = 0;
  private lastRecovery = 0;
  private failed = false;
  private readonly counts = new Map<LogFailureClass, number>();

  constructor(
    private readonly events: ConductorEventEmitter,
    private readonly now: () => number = Date.now,
  ) {}

  failure(kind: LogFailureClass, count = 1): void {
    this.counts.set(kind, (this.counts.get(kind) ?? 0) + count);
    const current = this.now();
    if (!this.failed) {
      this.failed = true;
      this.lastSummary = current;
      this.emit(`log delivery ${kind}; records remain local`);
      return;
    }
    if (current - this.lastSummary >= 60_000) {
      this.lastSummary = current;
      const summary = [...this.counts.entries()].map(([name, value]) => `${name}=${value}`).join(', ');
      this.counts.clear();
      this.emit(`log delivery still degraded (${summary})`);
    }
  }

  recovered(): void {
    if (!this.failed) return;
    this.failed = false;
    const current = this.now();
    if (current - this.lastRecovery < 60_000) return;
    this.lastRecovery = current;
    this.emit('log delivery recovered');
  }

  private emit(message: string): void {
    void this.events.emit({ type: 'renderer_error', rendererName: 'otel', error: `[otel] ${message}` }).catch(() => undefined);
  }
}
