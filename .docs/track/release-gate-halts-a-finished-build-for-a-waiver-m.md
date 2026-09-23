# Track: release-gate-halts-a-finished-build-for-a-waiver-m

Track: technical

Scope boundary: Balanced (operator-confirmed). The self-host SHIP tail's `release-disposition` step judges the real feature diff and emits a schema-bounded verdict — `migration`, `waiver`, or `unclassifiable` — authoring and committing a gate-valid waiver (or a runnable migration block) so the existing TR-10 release gate validates it; `unclassifiable` leaves the gate's halt exactly as today. Excluded: any change to the path-based breaking-surface classifier, `version-signal.ts`'s shared heuristic, consumer-project pipelines, and plan-time waiver authoring.

Internal self-host SHIP-tail/gate machinery for this repository with no product-facing requirements, so acceptance criteria live directly in stories and no PRD is authored.
