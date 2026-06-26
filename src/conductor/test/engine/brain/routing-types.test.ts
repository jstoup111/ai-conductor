// Test: RoutingOutcome discriminated union (Task 5, FR-3, ADR-007)
import { describe, it, expect } from 'vitest';
import type { RoutingOutcome } from '../../../src/engine/brain/routing.js';
import { assertNever } from '../../../src/engine/brain/routing.js';
import type { ProjectRecord } from '../../../src/engine/registry.js';

// Helper that switches exhaustively over all 4 variants.
// assertNever in the default position proves TypeScript exhaustiveness.
function dispatch(outcome: RoutingOutcome): string {
  switch (outcome.kind) {
    case 'confirmed':
      return `confirmed:${outcome.project.name}`;
    case 'redirected':
      return `redirected:${outcome.project.name}`;
    case 'create':
      return `create:${outcome.name}`;
    case 'declined':
      return 'declined';
    default:
      return assertNever(outcome);
  }
}

describe('RoutingOutcome discriminated union', () => {
  const stubProject: ProjectRecord = {
    schemaVersion: 1,
    name: 'my-project',
    path: '/home/user/my-project',
    status: 'registered',
    registeredAt: '2026-01-01T00:00:00.000Z',
  };

  it('handles confirmed variant', () => {
    const outcome: RoutingOutcome = { kind: 'confirmed', project: stubProject };
    expect(dispatch(outcome)).toBe('confirmed:my-project');
  });

  it('handles redirected variant', () => {
    const outcome: RoutingOutcome = { kind: 'redirected', project: stubProject };
    expect(dispatch(outcome)).toBe('redirected:my-project');
  });

  it('handles create variant', () => {
    const outcome: RoutingOutcome = { kind: 'create', name: 'new-project' };
    expect(dispatch(outcome)).toBe('create:new-project');
  });

  it('handles declined variant', () => {
    const outcome: RoutingOutcome = { kind: 'declined' };
    expect(dispatch(outcome)).toBe('declined');
  });

  it('declined variant has no project property (type-level assertion)', () => {
    const outcome: RoutingOutcome = { kind: 'declined' };
    if (outcome.kind === 'declined') {
      // @ts-expect-error — 'project' does not exist on the declined variant
      const _noop = outcome.project;
      void _noop;
    }
    // If TypeScript compiles without error on the @ts-expect-error line above,
    // the type correctly has no `project` field on 'declined'.
    expect(true).toBe(true);
  });

  it('assertNever throws for impossible values at runtime', () => {
    // Cast to force a runtime call to assertNever — simulates a future variant
    // that wasn't handled in the switch.
    expect(() => assertNever({ kind: 'unknown' } as never)).toThrow();
  });
});
