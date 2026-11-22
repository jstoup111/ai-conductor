# Track: Stacked rounds reach whole-feature validation

Track: technical

Source: jstoup111/ai-conductor#3682

Scope boundary: The operator approved all four outcomes in #3682 on 2026-11-18, excluding a broader stacked-feature recovery audit. After required child validation passes, whole-feature gates start without a false pending-prerequisite HALT; genuinely required validation runs; redispatch does not enter an already-complete BUILD merely because feature-level child-region fields are absent; incomplete child validation continues to block whole-feature gates.

The operator approved approach A and the technical track on 2026-11-19: consume authoritative child validation at the live handoff and on resume. This repairs internal orchestration under the existing per-child validation architecture. It does not introduce a separate mandatory feature-level suite. Stories will carry the acceptance contract; no PRD is required.

Alternative considered: a mandatory fresh feature-level suite after every routed round. Rejected because it adds repeated validation and changes validation ownership instead of correcting which evidence the existing gates consume.

This is a behavior correction, not a behavior-preserving maintenance change; no applicability waiver is requested.

## Verified basis

- `conductor.ts::continueRoutedHostExit` restores root state after a settled routed return and selects `manual_test`.
- `conductor.ts::restoreWholeFeatureState` clears the active child and replaces the in-memory state with root state.
- `steps.ts` gives `manual_test` the `test_suite` prerequisite. The ordinary gate and `resume-entry.ts::resolveRunnableResumeEntry` consult state.
- The routed-leaf-return test fixture initializes root `test_suite` as done, so that fixture does not reproduce a missing root status.

Verify-claims: CLEAR for the approved direction. Detailed evidence freshness and recovery behavior remain architecture-review work; no implementation is authorized by this marker.
