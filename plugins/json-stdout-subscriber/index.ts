import type { ConductorEvent } from '../../src/conductor/src/types/index.js';
import type { UIRenderer, UISubscriber } from '../../src/conductor/src/ui/types.js';

/**
 * JsonStdoutSubscriber — Feature 3.2
 *
 * Emits every ConductorEvent as a newline-delimited JSON line to stdout.
 * Each line includes all original event fields plus a `ts` ISO timestamp.
 *
 * Selectable via `ui_renderer: json-stdout` in .ai-conductor/config.yml.
 *
 * Design: handle() is a no-op (silent) before start() and after stop().
 * This matches the TerminalSubscriber contract for safe lifecycle management.
 */
export class JsonStdoutSubscriber implements UISubscriber {
  private started = false;

  start(_renderers: UIRenderer[] = []): void {
    this.started = true;
  }

  async stop(): Promise<void> {
    this.started = false;
  }

  handle(event: ConductorEvent): void {
    if (!this.started) return;
    const output =
      event.type === 'test_suite_verification'
        ? {
            type: event.type,
            freshness: {
              status: event.freshness.status,
              ...(event.freshness.reason !== undefined
                ? { reason: event.freshness.reason }
                : {}),
            },
          }
        : event;
    const line = JSON.stringify({ ...output, ts: new Date().toISOString() }) + '\n';
    process.stdout.write(line);
  }
}

// Default export for plugin loader discovery
export default new JsonStdoutSubscriber();
