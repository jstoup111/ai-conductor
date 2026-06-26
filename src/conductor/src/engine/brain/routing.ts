// Routing outcome discriminated union (ADR-007, FR-3).
//
// Four exhaustive variants:
//   confirmed  — brain matched an existing project; caller proceeds with it.
//   redirected — brain chose a different project than the one suggested.
//   create     — no existing project matches; caller should scaffold a new one.
//   declined   — brain rejected the request entirely; NO project field (type-
//                enforced) so consumers cannot accidentally write to a project.
//
// The `assertNever` export gives consumers a compile-time exhaustiveness guard
// for switch statements over RoutingOutcome.

import type { ProjectRecord } from '../registry.js';

export type RoutingOutcome =
  | { kind: 'confirmed'; project: ProjectRecord }
  | { kind: 'redirected'; project: ProjectRecord }
  | { kind: 'create'; name: string }
  | { kind: 'declined' };

// Exhaustiveness helper. Place in the `default` branch of a switch over
// RoutingOutcome. TypeScript will error at compile time if any variant is
// unhandled; at runtime an unknown value throws so tests can catch it too.
export function assertNever(x: never): never {
  throw new Error(`Unhandled RoutingOutcome variant: ${JSON.stringify(x)}`);
}
