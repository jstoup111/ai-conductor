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

/** Parsed read-only inspection of a feature's routed rounds. */
export interface StackRoundsInspectDispatch {
  kind: 'stack-rounds-inspect';
  slug: string;
}

/** Parsed close request for one superseded routed round. */
export interface StackRoundsCloseDispatch {
  kind: 'stack-rounds-close';
  slug: string;
  roundId: string;
  reason: string;
}

export type StackRoundsDispatch = StackRoundsInspectDispatch | StackRoundsCloseDispatch;

export interface StackOwnersDispatch {
  kind: 'stack-owners';
  slug: string;
  paths: readonly string[];
  diff?: string;
}
