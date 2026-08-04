import { describe, expect, expectTypeOf, it } from "vitest";

import * as stateStoreContract from "../../src/engine/conduct-state-store.js";
import type {
  ConductStateStore,
  ConductStateStoreError,
  NamedAtomicStateMutationBatch,
  PrivilegedStateReplacement,
  StateMutation,
  StateMutationOutcome,
  StateMutationResult,
} from "../../src/engine/conduct-state-store.js";

type ExampleState = {
  build_status: "pending" | "done";
  feature_status: "running" | "complete";
};

describe("ConductStateStore", () => {
  it("declares intent-bearing mutation commands, result failures, and exact store signatures", () => {
    const completeFeature: StateMutation<ExampleState> = {
      field: "feature_status",
      expected: "running",
      intent: "record verified feature completion",
      next: "complete",
    };
    const completeBuild: NamedAtomicStateMutationBatch<ExampleState> = {
      name: "record completed build invariant",
      mutations: [
        {
          field: "build_status",
          expected: "pending",
          intent: "record build completion",
          next: "done",
        },
        completeFeature,
      ],
    };
    const reset: PrivilegedStateReplacement<ExampleState> = {
      intent: "operator requested start-over",
      next: { build_status: "pending", feature_status: "running" },
      privileged: true,
    };
    const applied: StateMutationOutcome = { kind: "applied" };
    const idempotent: StateMutationOutcome = { kind: "idempotent" };
    const resolved: StateMutationOutcome = { kind: "resolved" };
    const conflict: ConductStateStoreError = {
      kind: "conflict",
      message: "feature status changed concurrently",
    };
    const lease: ConductStateStoreError = {
      kind: "lease",
      message: "state lease was not acquired",
    };
    const persistence: ConductStateStoreError = {
      kind: "persistence",
      message: "atomic replacement failed",
    };
    const results: StateMutationResult[] = [
      applied,
      idempotent,
      resolved,
      conflict,
      lease,
      persistence,
    ];

    // @ts-expect-error Ordinary mutations must declare their expected prior value.
    const missingExpected: StateMutation<ExampleState> = {
      field: "feature_status",
      intent: "record verified feature completion",
      next: "complete",
    };
    // @ts-expect-error Ordinary mutations must identify the writer's intent.
    const missingIntent: StateMutation<ExampleState> = {
      field: "feature_status",
      expected: "running",
      next: "complete",
    };
    // @ts-expect-error A mutation value must match its selected field.
    const mismatchedFieldValue: StateMutation<ExampleState> = {
      field: "feature_status",
      expected: "running",
      intent: "record verified feature completion",
      next: "done",
    };
    // @ts-expect-error A mutation expectation must match its selected field.
    const mismatchedFieldExpectation: StateMutation<ExampleState> = {
      field: "feature_status",
      expected: "pending",
      intent: "record verified feature completion",
      next: "complete",
    };
    // @ts-expect-error Atomic batches are named invariants, never anonymous groups.
    const unnamedBatch: NamedAtomicStateMutationBatch<ExampleState> = {
      mutations: [completeFeature],
    };
    const unprivilegedReplacement = {
      intent: "operator requested start-over",
      next: { build_status: "pending", feature_status: "running" },
    };
    // @ts-expect-error Whole-state replacement requires an explicit privileged marker.
    const invalidReplacement: PrivilegedStateReplacement<ExampleState> = unprivilegedReplacement;

    type Store = ConductStateStore<ExampleState>;

    expectTypeOf<Parameters<Store["apply"]>[0]>().toEqualTypeOf<StateMutation<ExampleState>>();
    expectTypeOf<Parameters<Store["applyBatch"]>[0]>().toEqualTypeOf<
      NamedAtomicStateMutationBatch<ExampleState>
    >();
    expectTypeOf<Parameters<Store["replace"]>[0]>().toEqualTypeOf<
      PrivilegedStateReplacement<ExampleState>
    >();
    expectTypeOf<ReturnType<Store["apply"]>>().toEqualTypeOf<Promise<StateMutationResult>>();
    expectTypeOf<ReturnType<Store["applyBatch"]>>().toEqualTypeOf<Promise<StateMutationResult>>();
    expectTypeOf<ReturnType<Store["replace"]>>().toEqualTypeOf<Promise<StateMutationResult>>();

    if (false) {
      const store = undefined as unknown as Store;
      // @ts-expect-error The privileged marker cannot be omitted at the replace boundary.
      void store.replace(unprivilegedReplacement);
    }

    void [
      completeFeature,
      completeBuild,
      reset,
      results,
      missingExpected,
      missingIntent,
      mismatchedFieldValue,
      mismatchedFieldExpectation,
      unnamedBatch,
      invalidReplacement,
    ];
    expect(stateStoreContract).toBeDefined();
  });
});
