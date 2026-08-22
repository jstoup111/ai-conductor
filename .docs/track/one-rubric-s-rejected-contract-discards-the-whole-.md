# Track: One rubric's rejected contract discards the whole build_review lap and resurrects fixed findings

Track: technical

Scope boundary: Balanced, conforming to adr-2026-08-18 D3 — a below-cap mechanical fault still publishes no aggregate; instead (a) build_review completion classifies a non-PASS aggregate whose lapId differs from the current lap as absent (stale lapId named), (b) the kickback-ledger mechanical-fault entry records the last fault's rubric, closed reason and bounded detail as a first-class record, (c) the stale-aggregate condition rides the existing event spine. Excludes: publishing a FAIL aggregate on a mechanical fault, a new result kind/schema for rejected candidates, per-rubric carry-forward between laps (#1657), and daemon-status surfacing beyond the event spine.

Engine defect in build_review lap aggregation and completion; no product-facing requirement.
