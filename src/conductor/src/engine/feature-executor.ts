import type { WorkOrder } from './work-order.js';

/** Dispatcher-owned effects requested by an executor after its feature work ends. */
export interface FeatureTerminalEffects {
  cleanupHaltPresentation?: { prUrl: string };
  enrollWatch?: { prUrl: string };
  markProcessed?: { prUrl?: string };
  /** Root `.daemon` marker requested by setup triage; written on collection. */
  autoPark?: { reason: string };
  sweep?: true;
  /**
   * Cross-project engineer-store signal for a daemon completion
   * (adr-2026-08-27 decision 1: the store lives outside the feature worktree,
   * so the write happens on the dispatcher side). `eventsContent` is the
   * worktree's `.pipeline/events.jsonl` captured inside the executor BEFORE
   * teardown, so the dispatcher can emit after the worktree is gone.
   */
  engineerSignal?: {
    outcome: {
      slug: string;
      status: 'done' | 'halted' | 'error';
      reason?: string;
      prUrl?: string;
      costTokens?: number;
    };
    eventsContent: string;
  };
}

/** Result returned by a single feature executor. */
export interface FeatureExecutionOutcome {
  slug: string;
  status: 'done' | 'halted' | 'error' | 'parked' | 'preempted';
  prUrl?: string;
  reason?: string;
  costTokens?: number;
  terminalEffects?: FeatureTerminalEffects;
}

/**
 * Process-separable boundary for one daemon feature build.
 *
 * Executors receive only the dispatcher-built order. Root checkout state and
 * daemon ledgers remain on the dispatcher side of this seam.
 */
export interface FeatureExecutor {
  execute(order: WorkOrder): Promise<FeatureExecutionOutcome>;
}
