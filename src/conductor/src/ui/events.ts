import type { ConductorEvent } from '../types/index.js';

/**
 * Handlers may be sync or async. `emit()` awaits async handlers before
 * returning, so the engine can know the UI has finished rendering before it
 * prompts the user. Without this, an async dashboard render races with
 * readline's prompt() output and the two interleave on the terminal.
 */
export type EventHandler = (event: ConductorEvent) => void | Promise<void>;

type HandlerMap = Map<ConductorEvent['type'], Set<EventHandler>>;

interface HandlerIsolation {
  handlers: Array<{ type: ConductorEvent['type']; handler: EventHandler }>;
  failed: boolean;
  onFailure: (error: unknown) => void;
}

export class ConductorEventEmitter {
  private handlers: HandlerMap = new Map();
  private activeIsolation: HandlerIsolation | undefined;
  private handlerIsolations = new Map<
    ConductorEvent['type'],
    Map<EventHandler, HandlerIsolation>
  >();

  /**
   * Dispatch `event` to every registered handler and await any Promises they
   * return. Handler errors are swallowed so one failing subscriber doesn't
   * crash the engine.
   */
  async emit(event: ConductorEvent): Promise<void> {
    const handlers = this.handlers.get(event.type);
    if (!handlers || handlers.size === 0) return;

    // Snapshot so once-handlers removing themselves during iteration don't break us.
    const isolations = this.handlerIsolations.get(event.type);
    const snapshot = [...handlers].map((handler) => ({
      handler,
      isolation: isolations?.get(handler),
    }));
    const pending: Promise<void>[] = [];
    for (const { handler, isolation } of snapshot) {
      if (isolation?.failed) continue;
      try {
        const out = handler(event);
        if (out && typeof (out as Promise<void>).then === 'function') {
          if (isolation) {
            void (out as Promise<void>).catch((error: unknown) => {
              this.failIsolation(isolation, error);
            });
          } else {
            pending.push((out as Promise<void>).catch(() => {
              /* swallow async handler errors */
            }));
          }
        }
      } catch (error) {
        if (isolation) this.failIsolation(isolation, error);
        /* swallow sync handler errors */
      }
    }
    if (pending.length > 0) await Promise.all(pending);
  }

  /**
   * Dispatch like `emit()`, but preserve subscriber failures for callers that
   * cannot report success without durable event handling (for example an
   * operator-audited reseal). Normal engine rendering remains best-effort via
   * `emit()`.
   */
  async emitOrThrow(event: ConductorEvent): Promise<void> {
    const handlers = this.handlers.get(event.type);
    if (!handlers || handlers.size === 0) return;

    const failures: unknown[] = [];
    const pending: Promise<void>[] = [];
    const isolations = this.handlerIsolations.get(event.type);
    const snapshot = [...handlers].map((handler) => ({
      handler,
      isolation: isolations?.get(handler),
    }));
    for (const { handler, isolation } of snapshot) {
      if (isolation?.failed) continue;
      try {
        const out = handler(event);
        if (out && typeof (out as Promise<void>).then === 'function') {
          if (isolation) {
            void (out as Promise<void>).catch((error: unknown) => {
              this.failIsolation(isolation, error);
            });
          } else {
            pending.push((out as Promise<void>).catch((error: unknown) => {
              failures.push(error);
            }));
          }
        }
      } catch (error) {
        if (isolation) this.failIsolation(isolation, error);
        else failures.push(error);
      }
    }
    await Promise.all(pending);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, 'Conductor event handlers failed');
  }

  on(type: ConductorEvent['type'], handler: EventHandler): void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    const added = !set.has(handler);
    set.add(handler);
    if (added && this.activeIsolation) {
      let isolations = this.handlerIsolations.get(type);
      if (!isolations) {
        isolations = new Map();
        this.handlerIsolations.set(type, isolations);
      }
      isolations.set(handler, this.activeIsolation);
      this.activeIsolation.handlers.push({ type, handler });
    }
  }

  off(type: ConductorEvent['type'], handler: EventHandler): void {
    this.handlers.get(type)?.delete(handler);
    this.handlerIsolations.get(type)?.delete(handler);
  }

  withIsolatedHandlerRegistrations(
    register: () => void,
    onFailure: (error: unknown) => void,
  ): void {
    const isolation: HandlerIsolation = { handlers: [], failed: false, onFailure };
    const previousIsolation = this.activeIsolation;
    this.activeIsolation = isolation;
    try {
      register();
    } catch (error) {
      this.failIsolation(isolation, error);
      throw error;
    } finally {
      this.activeIsolation = previousIsolation;
    }
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

  private failIsolation(isolation: HandlerIsolation, error: unknown): void {
    if (isolation.failed) return;
    isolation.failed = true;
    for (const { type, handler } of isolation.handlers) this.off(type, handler);
    try {
      isolation.onFailure(error);
    } catch {
      /* warning/reporting failures must not escape event delivery */
    }
  }
}
