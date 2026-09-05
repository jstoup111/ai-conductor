import type { WorkOrder } from './work-order.js';

/** Dispatcher-owned effects requested by an executor after its feature work ends. */
export interface FeatureTerminalEffects {
  cleanupHaltPresentation?: { prUrl: string };
  enrollWatch?: { prUrl: string };
  markProcessed?: { prUrl?: string };
  /** Root `.daemon` marker requested by setup triage; written on collection. */
  autoPark?: { reason: string };
  sweep?: true;
}

/** Result returned by a single feature executor. */
export interface FeatureExecutionOutcome {
  slug: string;
  status: 'done' | 'halted' | 'error' | 'parked';
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

export interface InProcessFeatureExecutorDeps {
  run(order: WorkOrder): Promise<FeatureExecutionOutcome>;
  /** Optional host-owned context around one executor's complete async lifetime. */
  withFeatureOwnership?<T>(
    slug: string,
    run: () => Promise<T>,
  ): Promise<T>;
}

/** In-process v1 adapter around the existing feature-runner implementation. */
export function createInProcessFeatureExecutor(
  deps: InProcessFeatureExecutorDeps,
): FeatureExecutor {
  return {
    execute(order: WorkOrder): Promise<FeatureExecutionOutcome> {
      if (!deps.withFeatureOwnership) return deps.run(order);
      return deps.withFeatureOwnership(order.slug, () => deps.run(order));
    },
  };
}
