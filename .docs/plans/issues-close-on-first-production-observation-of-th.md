# Implementation Plan: Observed-close — issues close on first production observation (#492)

**Date:** 2026-07-10
**Design:** .docs/decisions/adr-2026-07-10-observed-close-watch-registry.md (APPROVED)
**Stories:** .docs/stories/issues-close-on-first-production-observation-of-th.md (Accepted)
**Conflict check:** Clean as of 2026-07-10 (.docs/conflicts/2026-07-10-observed-close-492.md)

## Summary

16 tasks: a marker parser + land gate, a declaration-aware keyword resolver applied at both
`Closes`-injection sites, a v1 observation-watch registry, a two-state sweep (awaiting-merge →
watching) wired into `sweepBestEffort`, and docs. VERSION stays 0.99.19 (frozen — no bump task).
No consumer-breaking surface is touched (no bin/conduct CLI, hook wiring, settings schema, or
symlink changes); if the release-gate classifier still flags one, add a release waiver under
`.docs/release-waivers/issues-close-on-first-production-observation-of-th.md` per CLAUDE.md —
never an empty migration block.

## Technical Approach

- **`src/conductor/src/engine/observation-marker.ts` (new)** — parser for
  `.docs/observation/<plan-stem>.md` → `{kind:'watched', signature, isRegex, windowDays,
  surface:'daemon-log'} | {kind:'close-on-merge', rationale}`; typed errors for every malformed
  case (no silent defaults). Shared by the land gate and the daemon ship step.
- **`src/conductor/src/engine/engineer/issue-ref.ts`** — new `resolveIssueRefKeyword(declaration)`
  → `'Closes' | 'Refs'` (undefined/legacy or close-on-merge → `Closes`; watched → `Refs`).
  `closeIssueOnImplementationMerge` gains optional `{declaration, enroll}` deps: it injects the
  resolved keyword and, when watched, calls `enroll(entry)` after a successful injection attempt.
  Existing early returns (`no-source-ref`, `no-pr-url`) unchanged.
- **`src/conductor/src/engine/observation-sweep.ts` (new)** — mirrors `mergeable-sweep.ts`
  idioms: `ObservationEntry` (`{v:1, sourceRef, prUrl, slug, signature, isRegex, windowDays,
  enrolledAt, lastPollAt?, mergedAt?, lastScanAt?}`), tolerant enroll/read/rewrite (skip
  malformed lines and unknown `v`), pure log-scan matcher, and `sweepObservationWatch` running
  the per-entry state machine (≥5 min gh poll throttle awaiting merge; ≥60 s scan throttle
  watching; scan `daemon.log` + `daemon.log.1`; matches count only when line ISO timestamp >
  `mergedAt`; close-with-comment on first match; no-show comment + REST label at window expiry,
  issue stays open; CLOSED-unmerged → cancel comment + prune; every action logged `[daemon]`-
  prefixed; all failures logged and swallowed).
- **Call sites** — `src/conductor/src/daemon-cli.ts` post-run block reads the marker from the
  build worktree (stem = `item.slug`), passes the declaration + a production `enroll` bound to
  the primary repo's `.daemon/`; unreadable/malformed marker → log + fall back to legacy
  `Closes` (never blocks the ship). `halt-pr-rehabilitation.ts` `:102` takes the resolved
  keyword instead of hardcoded `'Closes'` (conflict resolution — both sites share the resolver).
  `daemon.ts` `sweepBestEffort` gains a third optional best-effort call; `daemon-cli.ts` binds
  the production dep next to the `sweepMergeableLabels` binding.
- **Land gate** — `src/conductor/src/engine/engineer/land-spec.ts` asserts the observation
  marker exists stem-matched to the plan and parses cleanly, beside the existing tier gate.
- **Sequencing** — parser first (everything reads it), then keyword/enrollment (ship side),
  then registry + sweep (watch side), then wiring, docs last. Tests run from `src/conductor`
  (vitest); any spawn-capable code paths respect the existing env kill-switch pattern.

## Prerequisites

None — no migrations, no new dependencies, no config. `gh` auth is the daemon's existing runner.

## Tasks

### Task 1: Observation-marker parser — watched declarations
**Story:** "Observation marker parses and validates" (happy paths)
**Type:** happy-path

**Steps:**
1. Write failing tests: substring signature + `Surface: daemon-log` + `Window-days: 14` parses to a watched declaration; `/regex/` form parses with `isRegex: true` and compiles.
2. Verify RED.
3. Implement `parseObservationMarker(content)` in new `observation-marker.ts` (line-oriented, same style as `intake-marker.ts`).
4. Verify GREEN.
5. Commit: "feat(observe): observation-marker parser — watched declarations"

**Files:**
- src/conductor/src/engine/observation-marker.ts — new parser module
- src/conductor/test/observation-marker.test.ts — parser tests

**Dependencies:** none

### Task 2: Observation-marker parser — close-on-merge and malformed inputs
**Story:** "Observation marker parses and validates" (close-on-merge happy + all negatives)
**Type:** negative-path

**Steps:**
1. Write failing tests: `close-on-merge` + rationale parses; missing/blank rationale fails naming it; non-compiling regex fails naming the regex error; missing `Signature:` fails; `Window-days: 0`/non-numeric fails; unknown `Surface:` fails naming v1 support.
2. Verify RED.
3. Implement the typed-error cases (discriminated error results, no throws-as-control-flow beyond the module boundary).
4. Verify GREEN.
5. Commit: "feat(observe): marker parser rejects malformed declarations with typed errors"

**Files:** same

**Dependencies:** 1

### Task 3: Land gate asserts the observation marker
**Story:** "Engineer land gate asserts the marker" (happy paths + missing marker)
**Type:** happy-path

**Steps:**
1. Write failing tests against `landSpec`: valid watched marker stem-matched to the plan lands; valid close-on-merge marker lands; missing `.docs/observation/<plan-stem>.md` fails naming the expected path, worktree left intact.
2. Verify RED.
3. Implement the assertion in `land-spec.ts` beside the tier gate: resolve plan stem (existing logic), require + parse the marker via Task 1's parser.
4. Verify GREEN.
5. Commit: "feat(observe): engineer land requires a valid observation marker"

**Files:**
- src/conductor/src/engine/engineer/land-spec.ts — marker assertion
- src/conductor/test/land-spec.test.ts — gate tests (or the file where landSpec tests live; follow existing layout)

**Dependencies:** 2

### Task 4: Land gate negative paths — malformed marker and stem mismatch
**Story:** "Engineer land gate asserts the marker" (remaining negatives)
**Type:** negative-path

**Steps:**
1. Write failing tests: malformed marker → land fails quoting the parse error; `.docs/observation/bar.md` with plan `foo.md` → fails naming the stem mismatch.
2. Verify RED.
3. Implement error surfacing (reuse typed parser errors in the gate message).
4. Verify GREEN.
5. Commit: "test(observe): land gate rejects malformed and mis-stemmed markers"

**Files:** same

**Dependencies:** 3

### Task 5: Declaration-aware keyword resolver in issue-ref
**Story:** "Ship-time trailer is conditional on the declaration" (keyword resolution core)
**Type:** happy-path

**Steps:**
1. Write failing tests: `resolveIssueRefKeyword(undefined)` → `'Closes'`; close-on-merge declaration → `'Closes'`; watched declaration → `'Refs'`.
2. Verify RED.
3. Implement `resolveIssueRefKeyword` in `issue-ref.ts`; thread an optional `declaration` through `closeIssueOnImplementationMerge` so the injected keyword is the resolved one (default path byte-identical to today).
4. Verify GREEN.
5. Commit: "feat(observe): issue-ref keyword resolved from observation declaration"

**Files:**
- src/conductor/src/engine/engineer/issue-ref.ts — resolver + threading
- src/conductor/test/issue-ref.test.ts — resolver tests (follow existing layout)

**Dependencies:** 1

### Task 6: Observation registry — v1 entries, tolerant IO
**Story:** "Registry survives daemon restarts and malformed lines" (happy + malformed line + unknown schema)
**Type:** infrastructure

**Steps:**
1. Write failing tests: enroll appends a `v:1` JSONL entry (mkdir -p `.daemon`); read returns persisted entries across a fresh instance (restart-shaped); a malformed line between two valid ones is skipped + logged and dropped by the next survivors rewrite; missing `v` / `v:2` entries are skipped as unrecognized-schema.
2. Verify RED.
3. Implement `ObservationEntry`, `enrollObservation`, `readObservationWatch`, `rewriteObservationWatch` in new `observation-sweep.ts`, mirroring `mergeable-sweep.ts` idioms (best-effort, non-throwing).
4. Verify GREEN.
5. Commit: "feat(observe): observation-watch registry with v1 schema and tolerant IO"

**Files:**
- src/conductor/src/engine/observation-sweep.ts — registry helpers
- src/conductor/test/observation-sweep.test.ts — registry tests

**Dependencies:** none

### Task 7: Registry concurrency — append during rewrite loses nothing
**Story:** "Registry survives daemon restarts and malformed lines" (concurrent enrollment negative)
**Type:** negative-path

**Steps:**
1. Write failing test: an entry enrolled between a sweep's read and its survivors rewrite is not lost — pin the contract (rewrite re-reads and merges by prUrl, or equivalent).
2. Verify RED.
3. Implement the chosen contract in `rewriteObservationWatch` (document it in the module header).
4. Verify GREEN.
5. Commit: "fix(observe): survivors rewrite preserves concurrently enrolled entries"

**Files:** same as Task 6

**Dependencies:** 6

### Task 8: Ship-time enrollment via closeIssueOnImplementationMerge
**Story:** "Ship-time trailer is conditional on the declaration" (watched enrollment + close-on-merge + legacy + registry-append failure)
**Type:** happy-path

**Steps:**
1. Write failing tests: watched declaration + sourceRef + prUrl → PR gains `Refs`, `enroll` called once with a complete v1 entry; close-on-merge → `Closes`, no enroll; no declaration (legacy) → `Closes`, no enroll, body byte-identical to pre-feature fixture; enroll throwing → logged, outcome still 'attempted', PR keeps `Refs`.
2. Verify RED.
3. Implement the optional `enroll` dep in `closeIssueOnImplementationMerge` (called only on watched, after injection attempt; failures swallowed).
4. Verify GREEN.
5. Commit: "feat(observe): ship-time enrollment of watched fixes"

**Files:**
- src/conductor/src/engine/engineer/issue-ref.ts — enroll dep
- src/conductor/test/issue-ref.test.ts — enrollment tests

**Dependencies:** 5, 6

### Task 9: Ship-time guards — no sourceRef, halted build, corrupt marker fallback
**Story:** "Ship-time trailer is conditional on the declaration" (remaining negatives)
**Type:** negative-path

**Steps:**
1. Write failing tests: no sourceRef → nothing injected/enrolled; no pr_url → nothing injected/enrolled; a marker-read helper that surfaces a parse failure → declaration treated as undefined (legacy `Closes`) with the failure logged.
2. Verify RED.
3. Implement `readObservationDeclaration(worktreePath, slug, log)` (small helper in `observation-marker.ts`: missing file → undefined silently; malformed file → undefined + logged warning).
4. Verify GREEN.
5. Commit: "feat(observe): ship-time guards and corrupt-marker fallback to close-on-merge"

**Files:**
- src/conductor/src/engine/observation-marker.ts — read helper
- src/conductor/test/observation-marker.test.ts; src/conductor/test/issue-ref.test.ts — guard tests

**Dependencies:** 8

### Task 10: Halt-PR rehabilitation resolves the keyword from the declaration
**Story:** "Ship-time trailer is conditional on the declaration" (conflict-resolution scenarios)
**Type:** negative-path

**Steps:**
1. Write failing tests: rehabilitation with a watched declaration ensures `Refs` (never `Closes`); with legacy/close-on-merge ensures `Closes` exactly as today (existing acceptance test stays green).
2. Verify RED.
3. Replace the hardcoded `keyword: 'Closes'` at `halt-pr-rehabilitation.ts:102` with a `keyword` resolved via `resolveIssueRefKeyword`; thread the declaration from the daemon-cli call site.
4. Verify GREEN (including `test/acceptance/halt-pr-rehabilitation.acceptance.test.ts`).
5. Commit: "fix(observe): halt-PR rehabilitation honors the observation declaration"

**Files:**
- src/conductor/src/engine/halt-pr-rehabilitation.ts — keyword param
- src/conductor/src/daemon-cli.ts — thread declaration to rehab call
- src/conductor/test/acceptance/halt-pr-rehabilitation.acceptance.test.ts — both-keyword coverage

**Dependencies:** 9

### Task 11: Sweep awaiting-merge state — throttled polls and transitions
**Story:** "Awaiting-merge entries poll gently and transition correctly" (all criteria)
**Type:** happy-path

**Steps:**
1. Write failing tests (fake gh runner + injected clock): MERGED → entry records `mergedAt`, state watching; `lastPollAt` within 5 min → zero gh calls for that entry; CLOSED unmerged → cancel comment on issue + prune, issue untouched otherwise; gh failure → logged, entry survives, sweep continues; ten due entries → exactly one state call each per tick.
2. Verify RED.
3. Implement the awaiting-merge branch of `sweepObservationWatch`; add a small `prStateWithMergedAt` gh helper (`gh pr view --json state,mergedAt`) in `observation-sweep.ts` (PrMergeState lacks mergedAt — verified).
4. Verify GREEN.
5. Commit: "feat(observe): awaiting-merge polling with 5-minute per-entry throttle"

**Files:**
- src/conductor/src/engine/observation-sweep.ts — sweep + gh helper
- src/conductor/test/observation-sweep.test.ts — state tests

**Dependencies:** 6

### Task 12: Log-scan matcher — post-merge filter, rotation, stampless lines
**Story:** "First post-merge observation closes the issue" (matcher criteria)
**Type:** happy-path

**Steps:**
1. Write failing tests over a pure matcher with fixture logs: substring and regex signatures match; a match timestamped before `mergedAt` does NOT count; a match only in `daemon.log.1` is found; lines without a leading ISO timestamp are ignored.
2. Verify RED.
3. Implement `findObservation(logDir, signature, isRegex, after)` scanning `daemon.log` + `daemon.log.1` via `daemonLogPath`/rotated-name knowledge exposed from `daemon-log.ts` (export the rotated-path helper there rather than duplicating the constant).
4. Verify GREEN.
5. Commit: "feat(observe): post-merge log-scan matcher across rotation"

**Files:**
- src/conductor/src/engine/observation-sweep.ts — matcher
- src/conductor/src/engine/daemon-log.ts — export rotated-log path helper
- src/conductor/test/observation-sweep.test.ts — matcher fixtures

**Dependencies:** 6

### Task 13: Watching state — close on first match, retries, scan throttle
**Story:** "First post-merge observation closes the issue" (close flow + idempotency + throttle)
**Type:** happy-path

**Steps:**
1. Write failing tests: match → `gh` close invoked for the sourceRef with a comment quoting the matched line + timestamp, entry pruned; close failure → entry survives, retried next tick; already-closed issue → pruned without error; `lastScanAt` within 60 s → no scan this tick.
2. Verify RED.
3. Implement the watching branch: throttle, matcher call, `gh issue close --repo <owner/repo> <n> --comment <quote>` (or REST equivalent), prune/survive logic.
4. Verify GREEN.
5. Commit: "feat(observe): first post-merge observation closes the originating issue"

**Files:** same as Task 11

**Dependencies:** 11, 12

### Task 14: No-show flow — flag loudly, never close silently
**Story:** "A never-observed fix is flagged, never silently closed" (all criteria)
**Type:** negative-path

**Steps:**
1. Write failing tests (injected clock): window expiry with no post-merge match → no-show comment naming signature + window AND `observation:no-show` label added via REST `gh api` argv (asserted), issue remains open, entry pruned; label failure → comment still attempted, logged, pruned (no re-flag loop); match on the expiry tick → close wins (observation check ordered before expiry); post-merge match that occurred during a daemon outage, first sweep after expiry → still closes, not no-show.
2. Verify RED.
3. Implement the expiry branch with scan-before-expiry ordering; label add via `gh api` REST (Projects-classic `gh issue edit` bug — PR #172 precedent); `ensureLabel` for `observation:no-show`.
4. Verify GREEN.
5. Commit: "feat(observe): no-show window flags unobserved fixes via REST label"

**Files:** same as Task 11

**Dependencies:** 13

### Task 15: Production wiring — sweepBestEffort third call + daemon-cli bindings
**Story:** "The sweep is wired into the production daemon and can never block it" (all criteria)
**Type:** infrastructure

**Steps:**
1. Write failing tests: `sweepBestEffort` invokes an injected `sweepObservationWatch` after `sweepMergeableLabels`; a thrown error from it is caught + logged and dispatch continues (extend the existing error-isolation test pattern); empty/absent registry → zero gh calls, zero scans, no log noise; a wiring assertion that the production dep binding in `daemon-cli.ts` passes the primary repo root + gh runner + daemon-log dir into the sweep and that ship-time code passes `readObservationDeclaration` + production `enroll` into `closeIssueOnImplementationMerge` (entry-point wiring, not just the primitive — #462 lesson).
2. Verify RED.
3. Implement: optional `sweepObservationWatch` dep on `DaemonDeps` + call in `sweepBestEffort` (`daemon.ts`); production binding in `daemon-cli.ts` beside the `sweepMergeableLabels` binding; post-run block reads the declaration and passes `enroll`; `[daemon]`-prefixed log lines for enroll/transition/close/flag actions. The enroll line MUST
   contain the literal substring `observe: enrolled` (e.g. `[daemon] observe: enrolled <slug> → <sourceRef>`) —
   it is this feature's own declared observation signature (`.docs/observation/` marker); do not reword it.
4. Verify GREEN.
5. Commit: "feat(observe): wire observation sweep into sweepBestEffort and daemon-cli"

**Files:**
- src/conductor/src/engine/daemon.ts — third best-effort call
- src/conductor/src/daemon-cli.ts — dep binding + post-run declaration/enroll
- src/conductor/test/daemon.test.ts; src/conductor/test/observation-sweep.test.ts — wiring + isolation tests (follow existing daemon test layout)

**Dependencies:** 9, 14

### Task 16: Docs — README + CHANGELOG
**Story:** "The sweep is wired into the production daemon…" (Done When: docs) + repo docs-track-features rule
**Type:** infrastructure

**Steps:**
1. Document in `src/conductor/README.md`: the observation marker format, registry file, sweep cadence/throttles, close/no-show semantics, grandfathering, and the land-gate requirement.
2. Add a root `README.md` note only if operator-facing behavior surfaces there (issue-close semantics table if one exists; otherwise skip).
3. Add `CHANGELOG.md` `## [Unreleased]` → Added entry describing observed-close (#492).
4. Run `test/test_harness_integrity.sh` (repo validation rule) and the conductor test suite from `src/conductor`.
5. Commit: "docs(observe): observed-close marker, registry, sweep semantics (#492)"

**Files:**
- src/conductor/README.md — feature docs
- CHANGELOG.md — Unreleased entry
- README.md — only if operator-facing surface exists

**Dependencies:** 15

## Task Dependency Graph

```
1 → 2 → 3 → 4
1 → 5 ─┐
6 ─────┼→ 8 → 9 → 10
6 → 7  │
6 → 11 ┐
6 → 12 ┼→ 13 → 14 ┐
       │          ├→ 15 → 16
9 ─────┴──────────┘
```

## Integration Points

- After Task 4: `engineer land` end-to-end rejects/accepts specs by marker validity.
- After Task 10: ship-time path complete — both injection sites declaration-aware; a watched
  fix's PR carries `Refs` and an enrolled entry on every path including halt rehabilitation.
- After Task 14: full watch lifecycle testable against fixture logs + fake gh.
- After Task 15: production daemon exercises the whole flow; the sweep's own `[daemon]` log
  lines provide this feature's observation signature (`.docs/observation/` marker authored at
  spec time — deliberately NOT a plan task).

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task (each an explicit task/step)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
