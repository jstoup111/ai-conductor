# Implementation Plan: Preserve precise UTC halt timestamps through issue resolution

**Date:** 2026-09-05
**Source:** jstoup111/ai-conductor#2176
**Stories:** .docs/stories/preserve-precise-utc-halt-timestamps-through-issue.md
**Conflict check:** Small-tier exemption; no blocking dependency found.

## Technical Approach

Preserve the canonical daemon timestamp shape `YYYY-MM-DDTHH:mm:ss.sssZ` as an exact source value. In `verdict-parser.ts`, retain the complete NEW HALT timestamp instead of capturing only through seconds. Export one pure timestamp validation/conversion helper from that module for reuse by `resolution.ts`: require the canonical millisecond UTC shape and an actual valid date (finite epoch value and matching canonical round-trip). Return no numeric instant for imprecise/invalid input; never coerce it with local-time parsing or padding. Keep existing issue deduplication and newest-halt-per-slug selection, including comparisons within the same second. Only a valid precise value may serve as recovered precision.

`resolveEntry` checks that shared precondition before examining evidence. On failure return `{ resolvable: false, reason: 'imprecise-halt-time' }`; the existing sweep already counts non-shipping/non-ordinary reasons as guarded. With a precise timestamp, keep strict `mtimeMs > haltAtMs` for both evidence sources and existing PR URL/keep-open closure semantics.

Fix snapshot ownership by extracting the existing field-preserving verdict merge from `Ledger.upsert` into one pure `mergeVerdicts` helper in `ledger.ts`. Both upsert and sweep use it. The sweep reads once and merges parsed verdicts into that in-memory schema before resolving entries in either mode, then performs its existing final atomic write only in normal mode. A supplied precise monitor value replaces a legacy truncated value; no supplied value preserves the existing value, and a new timestamp-less entry uses the existing empty-string representation. Remove every sweep-time clock.now fallback for haltAt. Preserve stamp/status/closure/error fields; this is not a ledger migration or schema change.

Tests follow the current halt-issues test patterns: pure parser tests; injected filesystem mtimes for resolution; and the real sweep with MockFs/MockGh for state/closure integration. No network, real tracker, daemon loop, or wall-clock wait is required. Task 3 alone owns the changed end-to-end parse/merge/resolve integration. Tasks 1 and 2 own their distinct parsing and comparison behavior.

## Tasks

### Task 1: Preserve and validate full source timestamps

**Story:** 1
**Type:** happy-path
**Dependencies:** none

**Steps:**
1. Update the existing parser tests that currently expect truncated values; establish RED for the exact .984Z timestamp from the captured fixture. Add out-of-order same-second .100Z/.900Z cases and missing/timezone-less/seconds-only/invalid-date input cases. These invoke the real pure parser, with no source-text assertions or external process.
2. Preserve the complete canonical source token. Add the shared pure timestamp validator/converter described above and use it before accepting a precise source timestamp. Retain existing slug matching, issue-number deduplication, covered-by exclusion, and newest valid timestamp selection. Never turn incomplete input into a precise value.
3. Run scoped parser tests to GREEN; commit `fix(halt-issues): preserve millisecond UTC source timestamps`.

**Done when:**
- [ ] The real parser returns the full .984Z source string, and same-second newest selection returns .900Z regardless of ordering.
- [ ] The shared validator supplies no numeric instant for missing, timezone-less, seconds-only, or invalid-date inputs; no padding or clock fallback appears in the timestamp path.
- [ ] Existing multiple-slug, deduplication, and covered-by parser cases preserve their prior behavior apart from restored precision.

**Files:** src/conductor/src/engine/halt-issues/verdict-parser.ts, src/conductor/test/engine/halt-issues/verdict-parser.test.ts

### Task 2: Refuse imprecise resolution and retain strict millisecond freshness

**Story:** 2
**Type:** negative-path
**Dependencies:** Task 1

**Steps:**
1. Use the existing resolver's fake filesystem and explicit Date mtimes to test both processed and shipped-record sources at halt-1ms, exactly halt, and halt+1ms. Preserve the existing valid PR URL/evidence-kind assertions. Add legacy bare seconds, seconds-only Z, empty, and invalid-date fixtures with apparently later evidence; establish RED because current local Date parsing can resolve some of them.
2. Reuse Task 1's pure validator before evidence access. Refuse imprecise/invalid inputs with `imprecise-halt-time`; valid inputs retain existing strict greater-than behavior and all existing missing-PR/missing-evidence outcomes.
3. Run the affected parser/resolver selectors via `ai-conductor scoped-run` from `src/conductor` with TZ=UTC, TZ=Etc/GMT-2, and TZ=America/New_York on separate invocations. Supply TZ only to each command, not as mutable global Vitest state. Commit `fix(halt-issues): guard closure on precise UTC halt time`.

**Done when:**
- [ ] Both evidence sources allow halt+1ms and refuse halt-1ms/equal through `resolveEntry`, retaining the expected reason and evidence fields.
- [ ] All named imprecise/invalid cases return resolvable=false with reason imprecise-halt-time, even when evidence appears newer.
- [ ] The scoped parser/resolver behavior is identical in UTC, UTC+2, and America/New_York environments.

**Files:** src/conductor/src/engine/halt-issues/resolution.ts, src/conductor/test/engine/halt-issues/resolution.test.ts

### Task 3: Resolve from the merged ledger in normal and dry-run sweeps

**Story:** 3
**Type:** happy-path
**Dependencies:** Task 1, Task 2

**Steps:**
1. Use the existing sweep MockFs/MockGh fixture, exercising the real parser, ledger merge, resolution, and closer. Seed an already-stamped legacy entry with bare `2026-07-04T11:58:38`, provide the matching .984Z monitor source, and establish RED that the current sweep evaluates or rewrites the stale value. Assert .983Z/equal evidence causes no tracker call and .985Z qualifying evidence invokes the existing close seam.
2. Extract the existing upsert merge into pure `mergeVerdicts`, preserving all existing metadata and returning the merged schema. Let upsert reuse it for its normal atomic persistence. Replace sweep's early upsert-plus-old-schema/fallback logic with one read and one in-memory merge before its processing loop, shared by dry-run and normal mode. Keep its final atomic write and other error/closure policy unchanged. Use exact recovered source strings when supplied; otherwise retain existing haltAt or empty string for a new entry. Remove processing-time substitution.
3. Add focused cases for unrecoverable legacy time, new missing time, preservation of an existing precise value when no new source time exists, and dry-run precision recovery with byte-unchanged ledger and zero tracker writes. Assert guarded counts and no planned close for imprecise entries. Existing ledger metadata-preservation and sweep keep-open/tracker-failure tests remain applicable; do not add real third-party calls.
4. Run the affected halt-issues parser/resolution/ledger/sweep selectors and the test-inclusive typecheck. Commit `fix(halt-issues): resolve against recovered ledger timestamps`.

**Done when:**
- [ ] Through `sweep`, the recovered .984Z value governs the same invocation and persists after final write; original issue identity and stamp/status metadata are preserved except for legitimate closure updates.
- [ ] Pre-halt/equal evidence produces no close, while +1ms evidence reaches the real closer with a fake tracker under existing policy.
- [ ] Unrecoverable stamped legacy entries remain guarded with zero tracker calls; new missing times are empty rather than fabricated from the clock.
- [ ] Dry-run uses identical recovery/comparison logic, writes neither ledger nor tracker, and never plans a close for an imprecise entry.

**Files:** src/conductor/src/engine/halt-issues/ledger.ts, src/conductor/src/engine/halt-issues/sweep.ts, src/conductor/test/engine/halt-issues/ledger.test.ts, src/conductor/test/engine/halt-issues/sweep.test.ts

## Coverage and Authority

Task 1 covers Story 1 H1/H2/N1; Task 2 covers Story 2 H1/N1/N2/N3; Task 3 covers Story 3 H1/H2/N1/N2/N3 and owns the application-service integration proof. Every criterion is diff-local. No extra acceptance/system test or terminal aggregate-validation task is needed.

The approved 2026-07-08 halt-issue-closure-sweep ADR already requires the newest halt per slug, strict recurrence protection, atomic ledger persistence, and no dry-run writes. This repair satisfies those decisions rather than amending them. Operator decision 2026-09-05 explicitly chooses exact-source recovery or retained imprecise legacy issues.

## Verify-Claims Ledger

99%, verified from the named production files and tests: source timestamps carry .sssZ; current parser drops them; Date interprets zone-less values locally; both evidence guards are strict >; upsert preserves metadata but sweep resolves and ultimately writes an older snapshot; missing-time fallback uses the current clock. No unconfirmed load-bearing assumptions remain. Verdict: CLEAR.
