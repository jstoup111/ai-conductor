# Track: Report the PRD-input gate surface accurately in rebase events

Track: technical

Scope boundary: Small fix for #2211, approved by the operator on 2026-09-06 (delegated). Correct the post-rebase gate-decision event payloads for the gate-surface kind that combines the feature's own runtime source with declared stories/PRD document inputs, and bind that payload projection to the classifier so a future kind cannot fall through to an unrelated default. Gate preserve/invalidate decisions, the event union's field names, the rebase delta the engine feeds the classifier, and the drift-budget preservation mechanism are all outside this slice.

This is an internal engine telemetry correction; acceptance criteria live in technical stories rather than a PRD.

The operator approved sharing one per-kind projection between the classifier and the emitter, over adding a third payload branch beside the two existing ones, on 2026-09-06 (delegated). A shared projection makes the decision and its explanation the same computation, so they cannot disagree; a third branch would leave the same drift possible for the next kind.

Scope check: A — consumer-facing engine behavior (the rebase gate loop runs in any repository the harness builds, and fires no self-host, validation-gate, CI, or repo-convention signal); B — n/a (no new skill); C — provider-agnostic (no provider is involved; the change is pure path arithmetic). No catalog registration, HARNESS.md rule, or documentation page is required: no reference page documents these event payloads, and no CLI flag, config key, step, gate, or hook changes.

Event spine: Channel? no — the change corrects the values of two existing `ConductorEvent` variants (`rebase_gate_preserved`, `rebase_gate_invalidated`) already emitted through `ConductorEventEmitter`. Concern: occurrence, already carried. Verdict: no union change, no sibling ledger, no new channel. Exception: none needed.

Verified foundation: `gate-invalidation.ts` assigns both `prd_audit` and `coverage_binding` the `feature-runtime-or-prd-inputs` kind and decides them in `classifyGateInvalidation` from `featureSrc` plus a private document-input filter. In `rebase.ts`, `emitGateInvalidationEvents` builds its payloads from `matchedPathsFor` and `declaredSurfaceFor`, whose conditional chains name only `feature-runtime`, `feature-codetest` and `all-runtime`; every other kind falls through to the whole-delta matched set and the broad `<all runtime source>` declaration. That is why a foreign-only runtime delta preserves both gates while telling the reader they depend on all runtime source and that the foreign path was considered. Two existing test expectations — one in the emitter unit tests and one in the resume-path integration test — currently encode that fall-through as intended behavior and must be corrected with it.
