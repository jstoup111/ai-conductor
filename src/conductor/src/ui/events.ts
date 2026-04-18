import type { ConductorEvent } from '../types/index.js';

/**
 * Handlers may be sync or async. `emit()` awaits async handlers before
 * returning, so the engine can know the UI has finished rendering before it
 * prompts the user. Without this, an async dashboard render races with
 * readline's prompt() output and the two interleave on the terminal.
 */
export type EventHandler = (event: ConductorEvent) => void | Promise<void>;

type HandlerMap = Map<ConductorEvent['type'], Set<EventHandler>>;

export class ConductorEventEmitter {
  private handlers: HandlerMap = new Map();

  /**
   * Dispatch `event` to every registered handler and await any Promises they
   * return. Handler errors are swallowed so one failing subscriber doesn't
   * crash the engine.
   */
  async emit(event: ConductorEvent): Promise<void> {
    const handlers = this.handlers.get(event.type);
    if (!handlers || handlers.size === 0) return;

    // Snapshot so once-handlers removing themselves during iteration don't break us.
    const snapshot = [...handlers];
    const pending: Promise<void>[] = [];
    for (const handler of snapshot) {
      try {
        const out = handler(event);
        if (out && typeof (out as Promise<void>).then === 'function') {
          pending.push(
            (out as Promise<void>).catch(() => {
              /* swallow async handler errors */
            }),
          );
        }
      } catch {
        /* swallow sync handler errors */
      }
    }
    if (pending.length > 0) await Promise.all(pending);
  }

  on(type: ConductorEvent['type'], handler: EventHandler): void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
  }

  off(type: ConductorEvent['type'], handler: EventHandler): void {
    this.handlers.get(type)?.delete(handler);
  }

  once(type: ConductorEvent['type'], handler: EventHandler): void {
    const wrapped: EventHandler = (event) => {
      this.off(type, wrapped);
      return handler(event);
    };
    this.on(type, wrapped);
  }

  waitFor(type: ConductorEvent['type']): Promise<ConductorEvent> {
    return new Promise((resolve) => {
      this.once(type, resolve);
    });
  }
}
