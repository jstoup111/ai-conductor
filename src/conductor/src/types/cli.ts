export interface HaltClearDispatch { kind: 'halt-clear'; feature: string; rationale?: string; }

/** Parsed open-path arguments for an operator stack landing. */
export interface StackLandOpenDispatch {
  kind: 'stack-land';
  slug: string;
  child: string;
  carry: readonly string[];
  reason: string;
}

/** Parsed declaration of an already-open operator stack landing. */
export interface StackLandDoneDispatch {
  kind: 'stack-land-done';
  slug: string;
}

/** Parsed abandonment of an already-open operator stack landing. */
export interface StackLandAbandonDispatch {
  kind: 'stack-land-abandon';
  slug: string;
}

export type StackLandDispatch = StackLandOpenDispatch | StackLandDoneDispatch | StackLandAbandonDispatch;

export interface StackOwnersDispatch {
  kind: 'stack-owners';
  slug: string;
  paths: readonly string[];
  diff?: string;
}
