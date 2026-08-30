import type { WorkOrder } from './work-order.js';

/** Result returned by a single feature executor. */
export interface FeatureExecutionOutcome {
  slug: string;
  status: 'done' | 'halted' | 'error' | 'parked';
  prUrl?: string;
  reason?: string;
  costTokens?: number;
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
}

/** In-process v1 adapter around the existing feature-runner implementation. */
export function createInProcessFeatureExecutor(
  deps: InProcessFeatureExecutorDeps,
): FeatureExecutor {
  return {
    execute(order: WorkOrder): Promise<FeatureExecutionOutcome> {
      return deps.run(order);
    },
  };
}
