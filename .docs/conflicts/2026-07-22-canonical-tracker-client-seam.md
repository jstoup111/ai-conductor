# Conflict Report: canonical-tracker-client-seam-with-per-backend-tra (#846)

**Date:** 2026-07-22
**Stories checked:** TR-1..TR-6 vs all 183 files in `.docs/stories/` (14 candidates
sharing surfaces read in full; remainder excluded by keyword scan over the affected
modules), plus prior `.docs/conflicts/` reports.
**Result:** ZERO blocking conflicts. Five degrading coordination risks found; three
resolved by story amendment (applied), two accepted as merge-coordination notes.

## Resolved by amendment (stories updated in place)

### 1. TR-2 operation union vs `background-intake-conduct-loop` (coverage gap)
`poll()` depends on an assignee-scoped issue list query, absent from TR-2's original
operation union — migrating the adapter would have left a hole (raw exec or missed op).
**Resolution:** list-issues operation added to TR-2's union + argv-parity Done When
(also needed by #849's Jira polling). Severity was degrading; now closed.

### 2. TR-4 vs `halt-monitor-filed-issues-never-auto-close-no-link` (behavioral overlap — highest risk)
Halt-monitor pins zero-steady-state gh calls and exact per-transition call bounds with
`reject:false` tolerance; an interface fold-in that added any round-trip would violate
them while TR-4's generic "parity" wording let that slip.
**Resolution:** TR-4 happy path now pins the call-count invariants explicitly (zero
steady-state calls; exact pre-migration per-operation bound; no added round-trip).

### 3. TR-3 vs `spec-authoring-is-blind-to-unmerged-dependent-work` + `engineer-handoff-writeback-gh-enoent` + `intake-only-enforcement` (same-module contention)
- Canonical `(args, {cwd})` widens today's no-cwd `BlockerRunner`/`wiring-probe` runner;
  shipped construction sites (`overlap-scan.ts`) need mechanical cwd-supplying updates.
- `github-issues.ts` `report()` carries engineer-handoff's advisory-catch +
  existing-cwd invariants; `poll()` carries intake-only's byte-equivalent enqueue pin;
  `dependency-claim.ts` is pinned unchanged.
**Resolution:** TR-3 negative paths now name these caller updates and invariants
explicitly, and exclude `dependency-claim.ts` from the migration.

## Accepted degrading (merge-coordination only — no semantic clash)

### 4. TR-6 vs `condense-readme-relocate-docs` + `make-daemon-build-push-pr-timing-a-configurable-st`
Shared-file contention only: `docs/configuration.md`, `src/conductor/README.md`,
`CHANGELOG.md` `[Unreleased]`, and `HarnessConfig`/`knownTopLevelKeys` (pr_timing adds a
read key; TR-6 adds a reserved-unread `tracker` key — different keys). Aligned targets;
trivial merge resolution. Accepted.

### 5. TR-5 vs the `pr-labels.ts` contention cluster (`halt-pr-presentation-reliability`,
`finish-step-completion-becomes-engine-machinery-re`, `merged-pr-guard`, `configurable-pr-timing`)
All inject `GhRunner`/`makeProductionGh` from `pr-labels.ts`. TR-5's re-export shim
preserves every import; finish-step's reduction of `makeProductionGh()` call sites in
`artifacts.ts` counts as an import hit, not a definition site, under TR-1's grep gate.
This recurring `pr-labels.ts` contention (see `.docs/conflicts/2026-07-05-halt-pr-reliability.md`)
is exactly what TR-5 exists to defuse. Accepted.

## Root-cause routing

No conflict rooted in the design (no architecture kickback) — all findings were story
precision gaps or shared-file merge coordination. Stories amended; design unchanged.
