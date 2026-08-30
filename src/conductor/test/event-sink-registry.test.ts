// Covers: task:1, task:6
import { describe, expect, it } from 'vitest';

import { EVENT_SINKS, type SinkDeclaration } from '../src/engine/event-sinks.js';
import type { ConductorEvent } from '../src/types/events.js';

const { provider_stream_progress: _omitted, ...missingProviderStreamProgress } = EVENT_SINKS;
// @ts-expect-error -- every ConductorEvent type requires a sink declaration.
missingProviderStreamProgress satisfies Record<ConductorEvent['type'], SinkDeclaration>;

const kickbackBudgetAdjustmentAuthorized = {
  type: 'kickback_budget_adjustment_authorized',
  adjustmentId: 'adjustment-7',
  feature: 'the-cumulative-kickback-cap-never-resets-so-a-reco',
  gate: 'build_review',
  kind: 'raise',
  beforeCount: 6,
  afterCount: 6,
  beforeLimit: 5,
  afterLimit: 8,
  operator: 'james',
  rationale: 'Need three more review laps to complete the remediation.',
  at: '2026-08-30T12:00:00.000Z',
} satisfies ConductorEvent;

const { adjustmentId: _adjustmentId, ...missingAdjustmentId } = kickbackBudgetAdjustmentAuthorized;
// @ts-expect-error -- adjustment authorization requires a durable adjustment identity.
missingAdjustmentId satisfies ConductorEvent;
const { feature: _feature, ...missingFeature } = kickbackBudgetAdjustmentAuthorized;
// @ts-expect-error -- adjustment authorization requires its feature.
missingFeature satisfies ConductorEvent;
const { gate: _gate, ...missingGate } = kickbackBudgetAdjustmentAuthorized;
// @ts-expect-error -- adjustment authorization requires its gate.
missingGate satisfies ConductorEvent;
const { kind: _kind, ...missingKind } = kickbackBudgetAdjustmentAuthorized;
// @ts-expect-error -- adjustment authorization requires its adjustment kind.
missingKind satisfies ConductorEvent;
const { beforeCount: _beforeCount, ...missingBeforeCount } = kickbackBudgetAdjustmentAuthorized;
// @ts-expect-error -- adjustment authorization requires its prior count.
missingBeforeCount satisfies ConductorEvent;
const { afterCount: _afterCount, ...missingAfterCount } = kickbackBudgetAdjustmentAuthorized;
// @ts-expect-error -- adjustment authorization requires its adjusted count.
missingAfterCount satisfies ConductorEvent;
const { beforeLimit: _beforeLimit, ...missingBeforeLimit } = kickbackBudgetAdjustmentAuthorized;
// @ts-expect-error -- adjustment authorization requires its prior limit.
missingBeforeLimit satisfies ConductorEvent;
const { afterLimit: _afterLimit, ...missingAfterLimit } = kickbackBudgetAdjustmentAuthorized;
// @ts-expect-error -- adjustment authorization requires its adjusted limit.
missingAfterLimit satisfies ConductorEvent;
const { operator: _operator, ...missingOperator } = kickbackBudgetAdjustmentAuthorized;
// @ts-expect-error -- adjustment authorization requires its operator.
missingOperator satisfies ConductorEvent;
const { rationale: _rationale, ...missingRationale } = kickbackBudgetAdjustmentAuthorized;
// @ts-expect-error -- adjustment authorization requires its rationale.
missingRationale satisfies ConductorEvent;
const { at: _at, ...missingTimestamp } = kickbackBudgetAdjustmentAuthorized;
// @ts-expect-error -- adjustment authorization requires its timestamp.
missingTimestamp satisfies ConductorEvent;

describe('event sink registry', () => {
  it('persists provider stream progress without rendering or auditing it', () => {
    expect(EVENT_SINKS.provider_stream_progress).toEqual({
      render: false,
      persist: true,
      audit: false,
      otel: false,
    });
  });

  it('accepts a complete kickback budget adjustment authorization at every sink', () => {
    expect({ event: kickbackBudgetAdjustmentAuthorized, sinks: EVENT_SINKS.kickback_budget_adjustment_authorized }).toEqual({
      event: kickbackBudgetAdjustmentAuthorized,
      sinks: { render: true, persist: true, audit: true, otel: true },
    });
  });
});
