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
  private lastRecovery: number | undefined;
  private failed = false;
  private readonly counts = new Map<LogFailureClass, number>();
  private readonly destination: string;

  constructor(
    private readonly events: ConductorEventEmitter,
    private readonly now: () => number = Date.now,
    endpoint?: string,
  ) {
    this.destination = sanitizeDestination(endpoint);
  }

  failure(kind: LogFailureClass, count = 1): void {
    this.counts.set(kind, (this.counts.get(kind) ?? 0) + count);
    const current = this.now();
    if (!this.failed) {
      this.failed = true;
      this.lastSummary = current;
      this.emit(`log delivery to ${this.destination} ${kind}; records remain local`);
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
    this.counts.clear();
    const current = this.now();
    if (this.lastRecovery !== undefined && current - this.lastRecovery < 60_000) return;
    this.lastRecovery = current;
    this.emit('log delivery recovered');
  }

  private emit(message: string): void {
    void this.events.emit({ type: 'renderer_error', rendererName: 'otel', error: `[otel] ${message}` }).catch(() => undefined);
  }
}

/** Health output may identify a destination, but never carries a URL path or credentials. */
function sanitizeDestination(endpoint: string | undefined): string {
  if (endpoint === undefined) return 'configured destination';
  try {
    const parsed = new URL(endpoint);
    return parsed.origin === 'null' ? 'configured destination' : parsed.origin;
  } catch {
    return 'configured destination';
  }
}
