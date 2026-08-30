# PRD: cumulative kickback budget recovery

**Date:** 2026-08-29
**Status:** Approved

## Problem / Background

A feature can exhaust its cumulative `build_review` kickback allowance and enter a permanent
`needs-human` halt even after the behavior that produced the earlier findings has changed. Today an
operator can recover only by editing internal pipeline state by hand. That recovery is unsupported,
unvalidated, unattributed, and easy to apply to the wrong feature or counter.

The halt reports the final count and latest reason, but it does not give the operator a complete
account of semantic laps, prior adjustments, or separately tracked harness-side faults. Operators
therefore cannot reliably distinguish an unchanged implementation spin from a budget accumulated
under obsolete review behavior.

## Goals & Non-Goals

**Goals**

- Let an operator inspect a halted feature's cumulative review budget without editing internal
  state.
- Let an operator deliberately reset consumed semantic laps or extend that feature's effective
  allowance, then safely resume the matching halt.
- Make every adjustment attributable and preserve enough before/after evidence to explain later
  exhaustion.
- Preserve bounded termination when the same unresolved work keeps failing.
- Keep semantic kickbacks distinct from already-separated mechanical review faults.

**Non-Goals**

- Automatically decide that two differently worded findings are equivalent or obsolete.
- Automatically reset a budget when source code, review configuration, or an engine version changes.
- Change the default cumulative allowance for every feature.
- Merge semantic and mechanical-fault allowances or redesign mechanical-fault recovery.
- Build, merge, or otherwise complete the halted feature as part of budget recovery.

## Users / Personas

- **Daemon operator:** needs to understand why a feature halted, decide whether old failures are
  still relevant, make a bounded recovery decision, and return the feature to normal daemon
  ownership without state surgery.
- **Maintainer investigating convergence:** needs an attributable history that distinguishes genuine
  semantic repair laps, excluded mechanical faults, and operator-granted recovery.

## Functional Requirements

- **FR-1:** An operator can inspect one explicitly selected feature and see its current cumulative
  semantic laps, effective allowance, remaining allowance, latest counted semantic reason, and
  whether the allowance is exhausted.
- **FR-2:** Inspection distinguishes semantic laps counted toward the cumulative allowance from
  mechanical review faults that use their existing separate allowance.
- **FR-3:** Inspection shows every prior operator adjustment for the selected feature, including the
  adjustment kind, before and after values, operator identity, rationale, and time.
- **FR-4:** An operator can reset the selected feature's consumed cumulative semantic laps to zero
  while leaving its default allowance unchanged.
- **FR-5:** An operator can raise the selected feature's effective cumulative allowance by a positive
  amount without erasing its consumed-lap history.
- **FR-6:** Every mutating recovery requires a non-empty rationale and a resolvable operator identity;
  missing or invalid attribution is rejected without changing feature state.
- **FR-7:** A mutating recovery succeeds only for an explicitly selected feature currently stopped
  by the matching cumulative `build_review` cap; a missing feature, different halt cause, different
  gate, ambiguous target, invalid amount, or stale recovery request is rejected without mutation.
- **FR-8:** A successful recovery records the adjustment before making the matching halt resumable;
  if recording or state transition fails, the feature remains halted with no partially applied
  adjustment.
- **FR-9:** Successful recovery clears only the matching cumulative-cap terminal condition and
  returns the feature to the repository's normal safe resume path; it does not clear unrelated halt
  conditions or bypass any downstream gate.
- **FR-10:** After a reset, the next semantic failure consumes the first lap of a fresh cumulative
  allowance; after an extension, consumption continues from the preserved count against the higher
  effective allowance.
- **FR-11:** Repeated unresolved semantic failures remain bounded: once the post-adjustment effective
  allowance is exceeded, the feature halts again under the same cumulative-cap rule.
- **FR-12:** A cumulative-cap halt identifies the selected gate, consumed semantic laps, effective
  allowance, remaining allowance, latest counted semantic reason, and prior operator adjustments,
  and explicitly states that separately accounted mechanical faults were not charged to that total.
- **FR-13:** Each successful recovery is visible through the repository's standard event and
  operator-observability surfaces with the same attribution and before/after values shown by
  inspection.
- **FR-14:** A legacy feature with cumulative state but no adjustment history remains inspectable and
  recoverable; absent historical detail is reported as unavailable rather than invented.

## Non-Functional Requirements

- Recovery is atomic and crash-safe: an interrupted operation cannot leave the budget adjusted while
  the audit record or halt state says otherwise.
- Recovery is scoped to one explicit feature and never changes another feature or the repository-wide
  default.
- Read-only inspection does not require daemon shutdown and never mutates feature state.
- Existing persisted feature state remains backward-compatible.
- Default automated tests exercise third-party boundaries with faithful fakes; no ordinary test or
  CI run calls a real LLM or other external service.

## Acceptance Criteria / Success Metrics

- A halted fixture can be inspected, reset with attribution, resumed, and observed consuming lap one
  on its next semantic failure without manual state editing.
- A second halted fixture can receive a positive allowance extension, retain its consumed count, and
  halt again exactly when the extended allowance is exceeded.
- Attempts against a non-matching or stale halt leave the budget, adjustment history, halt state, and
  sibling features byte-for-byte unchanged.
- Human-readable and machine-readable inspection agree on counts, allowance, remaining budget,
  fault separation, and adjustment history.
- A successful adjustment appears once in durable inspection and once in standard event
  observability with matching attribution and before/after values.
- Existing unchanged-spin, rebase-credit, and mechanical-fault convergence behaviors remain covered
  and pass unchanged except where their expected diagnostics intentionally gain the new accounting.

## Scope

### In Scope

- Per-feature inspection of cumulative semantic budget state.
- Guarded reset and positive extension operations with rationale and operator identity.
- Matching cumulative-cap halt recovery through the normal resume lifecycle.
- Durable before/after adjustment history and standard event visibility.
- Expanded halt diagnostics and canonical operator recovery documentation.
- Legacy-state behavior when adjustment history is absent.

### Out of Scope

- Automatic finding equivalence or source-change detection.
- Global/default allowance configuration changes.
- Changes to per-tree no-progress counting.
- Changes to mechanical-fault classification, allowance, reduced-coverage decisions, or recovery.
- Recovery for other halt classes or gates.
- Any automatic build, merge, or shipment action.

## Key Decisions & Rationale

- The operator decides whether prior findings are obsolete. This is a judgment call; deterministic
  machinery validates and records the decision rather than attempting semantic equivalence through
  hashes or text matching.
- Reset and extension are distinct capabilities. Reset grants a fresh episode while preserving the
  default bound; extension preserves consumed history while authorizing a larger one-feature budget.
- Recovery is feature-local and halt-specific so it cannot become a hidden global weakening of
  livelock protection.
- Mechanical faults remain separate because they already represent failures the implementation could
  not satisfy and are governed by their own bounded recovery contract.

## Dependencies

- The existing cumulative `build_review` convergence bound and `needs-human` halt lifecycle.
- The existing operator identity, daemon feature-resolution, and safe resume capabilities.
- The repository's existing event and operator-observability contract.
- The existing separately bounded mechanical-fault accounting.

## Open Questions

- Which durable representation best preserves both original consumption and later reset/extension
  adjustments without making derived totals disagree?
- How should the recovery operation prove exclusive ownership against an active daemon dispatch while
  keeping read-only inspection available?
- Should adjustment visibility extend the existing generic intervention occurrence or introduce a
  dedicated adjustment occurrence within the standard event stream?
- What is the authoritative historical source when legacy state contains only the latest semantic
  reason and older persisted events are unavailable?
