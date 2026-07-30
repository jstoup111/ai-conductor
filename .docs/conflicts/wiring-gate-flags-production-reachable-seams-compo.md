# Conflict Check: Contract-aware same-file wiring

**Date:** 2026-07-30
**Inventory:** all 228 story files, all 42 specs, and all 142 prior conflict reports; keyword and contract scan narrowed semantic comparison to the wiring, evidence, kickback, and as-built reachability family.
**Result:** **PASS — zero blocking conflicts remain.** Two blocking contradictions were found and resolved through the operator-approved architecture. No degrading conflict is accepted.

## Conflict: Historical Layer 1 contract unconditionally rejects same-file composition

**Stories involved:** “Layer 1 universal probe — declared sites verified, orphan exports named” vs “Qualifying same-file composition passes with explicit proof”
**Files:** `.docs/stories/2026-07-12-wiring-reachability-gate.md` vs `.docs/stories/wiring-gate-flags-production-reachable-seams-compo.md`
**Type:** contradiction
**Severity:** blocking
**Confidence:** 99% — the historical story says every same-file-only export gaps and Layer 1 gates independently, while the new approved ADR permits a narrow join with Layer 2.

**Resolution Options:**

1. Amend the historical assertions only for the approved three-proof exception; preserve every other Layer 1 outcome.
2. Keep the unconditional external-file rule and reject #880's desired outcome.
3. Remove the orphan backstop for all same-file references, weakening dead-export detection.

**Resolution:** Option 1, selected through approval of `adr-2026-07-30-contract-aware-same-file-wiring`. The historical story now distinguishes an own-file reference alone from a declared, exact, root-reachable composition.

## Conflict: SHIP review rejects the BUILD-approved file boundary

**Stories involved:** New same-file wiring stories vs the existing `architecture-review --as-built` production-reachability contract
**Files:** `.docs/stories/wiring-gate-flags-production-reachable-seams-compo.md` vs `skills/architecture-review/SKILL.md`
**Type:** sequencing
**Severity:** blocking
**Confidence:** 100% — BUILD would accept the three-proof chain, but SHIP currently says a primitive's own module never counts as its caller.

**Resolution Options:**

1. Apply the same three-proof semantics at SHIP while independently tracing current source.
2. Keep SHIP strict, making the approved BUILD behavior unshippable.
3. Exempt these primitives from SHIP reachability review, weakening the final safety gate.

**Resolution:** Option 1, explicitly selected by the operator. A new TI-4 story requires the as-built reviewer to count the exact same-file caller only as part of a complete production-root chain; own-module-only and stale-evidence cases remain blocking.

## Explicitly Compatible Overlaps

- **Cross-file Layer 1:** existing non-test references outside the defining file keep their current pass path. Confidence 99%.
- **Test-only protection:** test paths cannot manufacture either a Layer 1 caller or a Layer 2 root chain. Confidence 99%.
- **Layer 2 degradation:** `not-applicable`, `skipped`, and `bad-root` never authorize the exception. Confidence 99%.
- **Contract and waivers:** `no_new_surface`, inert waiver resolution, contradiction detection, and undeclared-surface behavior are unchanged. Confidence 98%.
- **Evidence freshness and kickback:** current-HEAD validation, named gap propagation, and BUILD rewind semantics are unchanged; typed proof is additive. Confidence 98%.
- **Resource contention:** a single shared compiler program/checker prevents per-export construction and adds no shared external resource. Confidence 96%.

## Re-check

After applying the selected resolutions, all five conflict classes were evaluated:

- no contradictory same-file definition remains;
- BUILD and SHIP share one semantic contract while retaining independent verification;
- no ambiguous intermediate state allows module reachability alone to pass;
- no new shared mutable resource is introduced;
- no circular gate or task dependency is created.

The conflict check passes with zero blocking and zero degrading conflicts.
