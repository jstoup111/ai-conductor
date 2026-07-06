// engineer/intake/notifier.ts — status surface write notifier (Task 9).
// Injected-dependency factory mirroring the port/queue module style:
// createNotifier(deps) returns a stateful notify(ideas) function.
// All I/O (status persistence, push, clock, logging) is injected — no real
// file I/O happens inside this module.

import type { Envelope } from './port.js';

// ─── NotifierStatus ───────────────────────────────────────────────────────────

/** Status surface record written on each notify() call. */
export interface NotifierStatus {
  /** Number of ideas included in this notification. */
  count: number;
  /** Source refs of the notified ideas, in the same order as `ideas`. */
  sourceRefs: string[];
  /** Timestamp of this notification, from the injected clock. */
  timestamp: string;
  /** Human-readable summary message for the push notification. */
  message: string;
}

// ─── NotifierDeps ─────────────────────────────────────────────────────────────

/** Injected dependencies for createNotifier. */
export interface NotifierDeps {
  /** Persist the status surface. Durable location is the caller's concern. */
  writeStatus(status: NotifierStatus): Promise<void> | void;
  /** Optional push notification side-effect (e.g. desktop/chat alert). */
  push(status: NotifierStatus): Promise<void> | void;
  /** Injected clock — returns the current timestamp. */
  now(): string;
  /** Injected logger. */
  log(message: string): void;
}

// ─── Notifier ─────────────────────────────────────────────────────────────────

/** The notifier returned by createNotifier. */
export interface Notifier {
  notify(ideas: Envelope[]): Promise<void>;
}

// ─── createNotifier ────────────────────────────────────────────────────────────

/**
 * Create a notifier bound to the given injected dependencies.
 *
 * notify(ideas) builds a status surface object — count, sourceRefs, and a
 * timestamp from the injected clock — and writes it via deps.writeStatus().
 */
export function createNotifier(deps: NotifierDeps): Notifier {
  return {
    async notify(ideas: Envelope[]): Promise<void> {
      if (ideas.length === 0) {
        return;
      }

      const sourceRefs = ideas.map((i) => i.sourceRef);
      const message = `${ideas.length} new idea(s) captured from ${sourceRefs.join(', ')}`;
      const status: NotifierStatus = {
        count: ideas.length,
        sourceRefs,
        timestamp: deps.now(),
        message,
      };

      await deps.writeStatus(status);
      deps.log(`notifier: wrote status surface for ${status.count} idea(s)`);

      try {
        await deps.push(status);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        deps.log(`notifier: push notification failed (non-fatal): ${reason}`);
      }
    },
  };
}
