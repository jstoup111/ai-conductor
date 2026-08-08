# Intake origin: adr-approval-gate-before-build

Source-Ref: jstoup111/ai-conductor#662
Owner: jstoup111

## Desired outcome

- The writing-system-tests step (or its gate) fails fast when any governing ADR for the feature is not `Status: APPROVED` — before spec authoring, not after ship steps.
- A daemon-dispatched build cannot start on a feature whose ADR set contains non-APPROVED members (or the dispatch is parked with a reason naming the ADR), consistent with the deterministic-first convention.
- The as-built check stays as the backstop, but firing there is the exception path, not the primary enforcement point.
