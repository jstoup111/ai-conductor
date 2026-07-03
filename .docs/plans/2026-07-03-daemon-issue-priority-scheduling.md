# Implementation Plan: Daemon Issue-Priority Scheduling

**Date:** 2026-07-03
**Design:** .docs/specs/2026-07-03-daemon-issue-priority-scheduling.md
**Stories:** .docs/stories/2026-07-03-daemon-issue-priority-scheduling.md
**ADRs:** adr-2026-07-03-priority-from-linked-issue-labels, adr-2026-07-03-priority-fetch-fail-soft (both APPROVED)
**Conflict check:** Clean as of 2026-07-03 (0 blocking; 2 degrading resolved in stories)

## Summary

Adds banded priority ordering (no-issue → high → medium → low → unlabeled) to the daemon's
backlog via a pure post-discovery sort fed by linked-issue labels, fetched on refresh scans
only with fail-soft fallback. 16 tasks.

## Technical Approach

- **New module `src/conductor/src/engine/backlog-priority.ts`** holding everything new:
  - `parsePriorityLabels(labels: string[]): 'high'|'medium'|'low'|undefined` — closed
    vocabulary (`priority: high|medium|low` exactly), highest wins, unknown/malformed → undefined.
  - `PriorityBand = 'no-issue'|'high'|'medium'|'low'|'unlabeled'` + rank map.
  - `PriorityResolution = { mode: 'banded'; bands: Map<string /*sourceRef*/, PriorityBand> } |
    { mode: 'fallback' } | { mode: 'off' }` — `off` when no resolver is wired (legacy).
  - `orderBacklog(items: BacklogItem[], res: PriorityResolution): BacklogItem[]` — PURE
    stable banded sort (explicit input-index tie-break; never trusts engine sort stability),
    annotating each returned item with an optional `band` field. `fallback`/`off` → returns
    input order (with/without annotations). Never adds/drops/mutates slugs (permutation).
  - `IssueLabelReader = (refs: string[]) => Promise<Map<string, string[] | 'not-found'>>` —
    injectable seam (mirrors `DiscoverBacklogOpts` owner-gate injectables). Throws only on
    transport/auth failure; per-ref 404 is data (`'not-found'`), not an outage.
  - `createPriorityResolver(reader, log)` — stateful closure: in-memory `Map` cache +
    once-per-outage flag. `resolve(items, {refresh})`: no linked items → no reader call;
    `refresh: false` → cached bands; `refresh: true` → re-fetch all linked refs; reader throw
    → clear cache, return `{mode:'fallback'}`, warn once (flag resets on next success).
- **Production reader in the same module**: `ghIssueLabelReader(runner)` — parses each
  `sourceRef` via the existing `engineer/issue-ref.ts` parser (single parse source), calls
  `gh api repos/«owner»/«repo»/issues/«n»` per ref through an injected exec runner
  (pattern of `pr-labels.ts`), maps label names, 404 → `'not-found'`, other failures throw.
- **Wiring — `daemon-work-source.ts`**: optional `priorityResolver` dep on
  `LocalWorkSourceDeps`; in `discover()`, AFTER `discoverBacklog` returns (post
  eligibility + owner gate, so a fail-closed empty backlog resolves nothing), call
  `resolver.resolve(items, {refresh})` then `orderBacklog`. Absent dep → byte-identical
  legacy behavior. `daemon-cli.ts` constructs the production resolver and passes it, and
  shares it with the dashboard.
- **Dashboard — `daemon-dashboard.ts`**: ELIGIBLE group lines gain ` [band]` suffixes from
  the items' `band` annotation, plus one `(priority: chronological fallback)` marker line
  when the latest resolution mode is `fallback`. Four-group structure, counts, and
  stdout/log parity unchanged (conflict-check resolution). Supervisor `daemon status`
  untouched.
- **`daemon.ts` untouched** — `pickEligible` already consumes backlog order; FR-8 holds by
  construction and is pinned with tests.
- **Tests**: vitest in `src/conductor` (`rtk proxy npx vitest run`), injected fakes only
  (no live network); one env-gated real-`gh` smoke per the injected-runner feedback.
  New spawn paths: none beyond short-lived `gh api` behind the injected runner.

## Prerequisites

- None (no migrations, no config schema changes; labels already exist in repos).

## Tasks

### Task 1: Label parsing — happy path
**Story:** FR-9 (highest wins) — happy paths
**Type:** happy-path
**Steps:**
1. Write failing tests: `parsePriorityLabels(['priority: high'])→'high'`; same for medium/low; `['priority: low','priority: high']→'high'`; `['bug','intake','priority: medium']→'medium'`; all three → `'high'`.
2. RED → implement `parsePriorityLabels` + `PriorityBand` rank map in new `backlog-priority.ts` → GREEN.
3. Commit: "feat(daemon): parse priority bands from issue labels (highest wins)"
**Files likely touched:** `src/conductor/src/engine/backlog-priority.ts`, `src/conductor/test/backlog-priority.test.ts`
**Dependencies:** none

### Task 2: Label parsing — adversarial inputs
**Story:** FR-9 negatives; FR-3 negative (near-miss labels); FR-4 negatives (empty/malformed)
**Type:** negative-path
**Steps:**
1. Failing tests: `['priority: urgent']→undefined`; `['Priority-High']→undefined`; `['priority: P0']→undefined`; `[]→undefined`; non-string junk filtered → undefined; determinism across repeated calls.
2. RED → tighten matcher to the closed vocabulary → GREEN.
3. Commit: "test(daemon): unknown/malformed priority labels never rank"
**Files likely touched:** same as Task 1
**Dependencies:** Task 1

### Task 3: orderBacklog — banded stable sort happy path
**Story:** FR-1, FR-2, FR-3, FR-4, FR-5 happy paths
**Type:** happy-path
**Steps:**
1. Failing tests: unlinked-first vs linked-high; high→medium→low across differing dates; low beats unlabeled despite newer date; same-band items keep input (date) order; all-medium backlog byte-identical to input; `band` annotation present on output items.
2. RED → implement `orderBacklog` (rank map + explicit input-index tie-break) → GREEN.
3. Commit: "feat(daemon): pure banded stable sort for backlog priority"
**Files likely touched:** `backlog-priority.ts`, `backlog-priority.test.ts`
**Dependencies:** Task 1

### Task 4: orderBacklog — permutation + determinism properties
**Story:** FR-5 negatives
**Type:** negative-path
**Steps:**
1. Failing tests: randomized inputs (seeded) → output is exact permutation (same multiset of slugs, no mutation of other fields); identical date prefixes in one band → deterministic repeated output; `{mode:'fallback'}` and `{mode:'off'}` → input order preserved.
2. RED → fix any hole → GREEN.
3. Commit: "test(daemon): orderBacklog is a deterministic stable permutation"
**Files likely touched:** `backlog-priority.test.ts`
**Dependencies:** Task 3

### Task 5: Resolver — refresh fetch + cache for local scans
**Story:** FR-6 happy paths
**Type:** happy-path
**Steps:**
1. Failing tests (fake reader recording calls): `resolve(items,{refresh:true})` fetches all linked refs once; subsequent `{refresh:false}` calls return same bands with ZERO reader calls; a second refresh re-fetches and picks up a changed label (low→high moves band).
2. RED → implement `createPriorityResolver` cache path → GREEN.
3. Commit: "feat(daemon): priority resolver — refresh-scan fetch, cached local scans"
**Files likely touched:** `backlog-priority.ts`, `backlog-priority.test.ts`
**Dependencies:** Task 1

### Task 6: Resolver — zero-lookup cases
**Story:** FR-2 happy (all-unlinked → no lookup) + negatives (empty backlog; garbled marker treated as unlinked)
**Type:** negative-path
**Steps:**
1. Failing tests: all-unlinked items → zero reader calls, all `no-issue` band; empty item list → zero calls, empty resolution; item without `sourceRef` (garbled marker upstream) → `no-issue` band, no warning.
2. RED → guard resolver → GREEN.
3. Commit: "test(daemon): unlinked/empty backlogs never touch the priority source"
**Files likely touched:** `backlog-priority.test.ts`
**Dependencies:** Task 5

### Task 7: Resolver — not-found and malformed are data, not outage
**Story:** FR-3 negatives (deleted issue; closed issue honored), FR-4 negatives (empty labels, malformed payload)
**Type:** negative-path
**Steps:**
1. Failing tests: reader returns `'not-found'` for one ref → that item `unlabeled`, others keep bands, zero outage warnings; empty labels list → `unlabeled`; malformed payload normalized by reader contract → `unlabeled`, no fallback; closed-issue labels (reader returns labels regardless of state) → honored.
2. RED → implement per-ref data handling → GREEN.
3. Commit: "feat(daemon): missing/unlabeled issues band as unlabeled, never outage"
**Files likely touched:** `backlog-priority.ts`, `backlog-priority.test.ts`
**Dependencies:** Task 5

### Task 8: Resolver — outage fail-soft + once-per-outage warning
**Story:** FR-7 all paths
**Type:** negative-path
**Steps:**
1. Failing tests: reader throws → `{mode:'fallback'}`, cache cleared, exactly one warn line; repeated failing resolves → no further warns; success resumes banded mode; NEW failure after success warns again; mid-scan partial failure (reader throws after partial work) → whole-scan fallback, no mixed bands.
2. RED → implement outage flag + cache clear → GREEN.
3. Commit: "feat(daemon): whole-scan fallback + once-per-outage warning (resets on success)"
**Files likely touched:** `backlog-priority.ts`, `backlog-priority.test.ts`
**Dependencies:** Task 5

### Task 9: Production gh label reader (injected runner)
**Story:** FR-3 happy (cross-repo ref); FR-7 (transport error classification)
**Type:** infrastructure
**Steps:**
1. Failing tests with injected exec runner: builds `gh api repos/o/r/issues/N` argv from `sourceRef` "o/r#N" (parsed via `engineer/issue-ref.ts`); cross-repo refs hit their own repo path; label names extracted from JSON; HTTP 404 → `'not-found'`; non-404 failure/ENOENT → throws (transport).
2. RED → implement `ghIssueLabelReader` → GREEN.
3. Commit: "feat(daemon): gh REST issue-label reader behind injected runner"
**Files likely touched:** `backlog-priority.ts`, `backlog-priority.test.ts`
**Dependencies:** Task 7

### Task 10: Real-binary gh smoke (env-gated)
**Story:** FR-3 happy path — end-to-end reader confidence (injected-runner argv tests can pass on wrong argv)
**Type:** infrastructure
**Steps:**
1. Add a vitest `describe.skipIf(!process.env.PRIORITY_GH_SMOKE)` smoke: run the REAL `gh` binary against `jstoup111/ai-conductor#200` and assert a `priority: *` label parses to a band.
2. Verify it runs green locally with the env flag set; stays skipped in CI/offline.
3. Commit: "test(daemon): env-gated real-gh smoke for the label reader"
**Files likely touched:** `src/conductor/test/backlog-priority.smoke.test.ts`
**Dependencies:** Task 9

### Task 11: WorkSource wiring — post-gate ordering, legacy identical
**Story:** FR-1 happy (end-to-end order); FR-8 happy (eligibility set unchanged) + fail-closed negative
**Type:** happy-path
**Steps:**
1. Failing tests on `localWorkSource`: with resolver injected, `discover()` returns banded order and calls resolver AFTER `discoverBacklog` (fail-closed empty backlog → zero reader calls); WITHOUT resolver, `discover()` output and `discoverBacklog` opts are byte-identical to today (existing tests stay green); eligibility set identical with/without resolver.
2. RED → add optional `priorityResolver` to `LocalWorkSourceDeps`, apply `resolve`+`orderBacklog` in `discover()` → GREEN.
3. Commit: "feat(daemon): wire priority ordering into WorkSource discovery (post-gate)"
**Files likely touched:** `src/conductor/src/engine/daemon-work-source.ts`, `src/conductor/test/daemon-work-source.test.ts`
**Dependencies:** Tasks 3, 8

### Task 12: Head-of-line + park/halt interplay
**Story:** FR-8 happy (ineligible high never blocks eligible low) + negatives (stories-not-approved / owner-gate / in-flight skips stand)
**Type:** negative-path
**Steps:**
1. Failing tests at the daemon loop level (existing runDaemon test harness, fake WorkSource returning banded order): parked/halted high-band item + eligible low-band item → low dispatches; in-flight first item → picker advances; stories-not-approved and owner-gated specs skip with existing messages regardless of band.
2. RED only if behavior differs → expected GREEN-by-construction; keep tests as regression pins.
3. Commit: "test(daemon): priority never overrides eligibility, park, or dedup"
**Files likely touched:** `src/conductor/test/daemon.test.ts` (or the existing daemon loop test file)
**Dependencies:** Task 11

### Task 13: daemon-cli production wiring
**Story:** FR-6 happy (relabel + refresh reorders in one process); restart negative (state is process-local)
**Type:** infrastructure
**Steps:**
1. Failing test (integration-style with injected runner factory): daemon-cli constructs ONE resolver, passes it to `localWorkSource` and exposes it to the dashboard; resolver state does not persist anywhere durable (no files written).
2. RED → wire `createPriorityResolver(ghIssueLabelReader(runner), log)` in `daemon-cli.ts` → GREEN.
3. Commit: "feat(daemon): construct priority resolver in daemon-cli wiring"
**Files likely touched:** `src/conductor/src/daemon-cli.ts`, its test file
**Dependencies:** Tasks 9, 11

### Task 14: Dashboard band annotations + fallback marker
**Story:** FR-10 all paths
**Type:** happy-path
**Steps:**
1. Failing tests on `renderDashboard`: ELIGIBLE lines listed in effective build order with ` [no-issue|high|medium|low|unlabeled]` suffixes; fallback mode → `(priority: chronological fallback)` marker line and NO band suffixes (no stale annotations); empty backlog renders clean; four-group structure + stdout/log parity assertions from existing tests remain green.
2. RED → thread `band`/mode into `daemon-dashboard.ts` render → GREEN.
3. Commit: "feat(daemon): dashboard shows priority bands and fallback mode"
**Files likely touched:** `src/conductor/src/engine/daemon-dashboard.ts`, `src/conductor/test/daemon-dashboard.test.ts`
**Dependencies:** Task 11 (band annotation shape), Task 8 (mode)

### Task 15: Full-suite regression pass
**Story:** FR-8 Done-When (existing eligibility/owner-gate/park tests green with ordering active)
**Type:** infrastructure
**Steps:**
1. `rtk proxy npx vitest run` in `src/conductor` — full suite.
2. Fix any regression (expected: none; ordering is opt-in by injection).
3. Commit only if fixes were needed.
**Files likely touched:** none (verification)
**Dependencies:** Tasks 12, 13, 14

### Task 16: Docs + CHANGELOG
**Story:** PRD acceptance criteria (docs in same PR); issue #200 acceptance criteria
**Type:** infrastructure
**Steps:**
1. Update `README.md` + `src/conductor/README.md`: priority bands, label vocabulary, refresh cadence, fallback semantics, dashboard annotations.
2. Add CHANGELOG `## [Unreleased]` → Added entry.
3. Commit: "docs: daemon issue-priority scheduling"
**Files likely touched:** `README.md`, `src/conductor/README.md`, `CHANGELOG.md`
**Dependencies:** Task 15

## Task Dependency Graph

```
T1 ──► T2
 ├───► T3 ──► T4
 └───► T5 ──► T6
        ├───► T7 ──► T9 ──► T10
        └───► T8 ─┐   └────────► T13 ─┐
T3 ───────────────┴► T11 ──► T12 ─────┼──► T15 ──► T16
T8/T11 ──────────────► T14 ───────────┘
```

**Dependencies:** T2←T1; T3←T1; T4←T3; T5←T1; T6←T5; T7←T5; T8←T5; T9←T7; T10←T9; T11←T3,T8; T12←T11; T13←T9,T11; T14←T8,T11; T15←T12,T13,T14; T16←T15.

## Integration Points

- After Task 11: end-to-end banded discovery testable with fakes (WorkSource → ordered items).
- After Task 13: real daemon process orders by live labels (manual: relabel #200, watch refresh scan).
- After Task 14: operator-visible verification via dashboard.

## Coverage

| Story (FR) | Tasks |
|---|---|
| Unlinked first (FR-2) | T3, T6 |
| Label order (FR-1, FR-3) | T3, T7, T9, T10, T11 |
| Unlabeled last (FR-4) | T3, T7 |
| Stable within band (FR-5) | T3, T4 |
| Relabel, no restart (FR-6) | T5, T13 |
| Outage fail-soft (FR-7) | T8, T9 |
| Order-only, never eligibility (FR-8) | T11, T12, T15 |
| Multi-label highest (FR-9) | T1, T2 |
| Visible order + band (FR-10) | T14 |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by explicit tasks (T2, T4, T6, T7, T8, T12)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
