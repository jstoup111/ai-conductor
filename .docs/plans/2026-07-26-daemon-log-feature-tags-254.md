# Implementation Plan: Daemon log feature tags

**Date:** 2026-07-26
**Design:** technical track; no PRD or architecture artifact (Small tier)
**Stories:** `.docs/stories/daemon-log-feature-tags-254.md`
**Conflict check:** skipped for Small tier

## Summary

Introduce a composable daemon text logger with an optional bounded feature tag, then allocate and thread one feature-owned logger through the existing feature execution boundary. Four TDD tasks cover formatting, runner ownership, production wiring, and regression behavior.

## Technical Approach

Keep repository-global logging on the existing daemon logger. Add a pure feature-display formatter and a logger-derivation function that preserves the existing console/file behavior while inserting `[<feature>]` immediately after `[daemon]`. `beginFeatureRun` derives one immutable logger per backlog item; `makeRunFeature` uses that logger for feature preparation, conductor/event/provider execution, feature-owned diagnostics, and terminal outcomes. Ambient process-wide diagnostics that do not pass through this boundary remain global. This avoids ambient mutable feature state and makes overlapping loggers independently testable. The persisted timestamp remains outside the textual prefix, and ANSI stripping/rotation remain sink responsibilities.

## Prerequisites

- The issue #254 intake marker, accepted technical story, and Small complexity marker are present.
- Existing repository-global daemon logging remains the compatibility baseline.

## Tasks

### Task 1: Format bounded feature tags

**Story:** Story 1 — short slug, long slug, and global-line acceptance criteria
**Type:** happy-path

**Steps:**
1. Write failing focused tests for a short feature slug, a slug requiring deterministic 24-character display truncation ending in `…`, and an absent feature slug.
2. Verify the focused tests fail (RED).
3. Add a pure daemon feature-tag formatter/logger derivation that composes `[daemon][<display>]` without changing message content.
4. Verify the focused tests pass (GREEN).
5. Commit with message: `feat(daemon): format bounded feature log tags`.

**Files:** `src/conductor/src/engine/daemon-log.ts`; `src/conductor/test/engine/daemon-log.test.ts`

**Wired-into:** `src/conductor/src/daemon-cli.ts#runDaemonMode`

**Dependencies:** none

### Task 2: Give each feature run an immutable logger

**Story:** Story 1 — feature-owned lifecycle lines and overlapping logger negative path
**Type:** infrastructure

**Steps:**
1. Write failing runner tests proving two feature scopes receive distinct loggers and interleaved messages retain their own feature identity.
2. Verify the focused tests fail (RED).
3. Extend the feature-run scope/dependency boundary so `beginFeatureRun` supplies an immutable feature logger and runner-owned preparation, error, halt, and terminal messages use it.
4. Verify the focused tests pass (GREEN).
5. Commit with message: `feat(daemon): scope loggers to feature runs`.

**Files:** `src/conductor/src/engine/daemon-runner.ts`; `src/conductor/test/engine/daemon-runner.test.ts`

**Wired-into:** `src/conductor/src/engine/daemon-runner.ts#makeRunFeature`

**Dependencies:** Task 1

### Task 3: Route feature execution output through the scoped logger

**Story:** Story 1 — setup, structured event, warning, retry, and subprocess-diagnostic acceptance criteria
**Type:** happy-path

**Steps:**
1. Write failing daemon-mode tests that emit representative setup output, a rendered step event, a provider/retry warning, and a diagnostic during one feature run, asserting the live and persisted prefix is `[daemon][<feature>]` for each.
2. Verify the focused tests fail (RED).
3. In `runDaemonMode`, derive the feature logger in `beginFeatureRun` and pass it through worktree preparation/triage, provider execution, event rendering, conductor execution, and feature-local diagnostic persistence.
4. Verify the focused tests pass (GREEN).
5. Commit with message: `feat(daemon): tag active feature output`.

**Files:** `src/conductor/src/daemon-cli.ts`; `src/conductor/src/engine/daemon-runner.ts`; `src/conductor/test/engine/daemon-log.test.ts`; `src/conductor/test/engine/daemon-runner.test.ts`

**Wired-into:** `src/conductor/src/daemon-cli.ts#beginFeatureRun, src/conductor/src/daemon-cli.ts#runConductorInWorktree`

**Dependencies:** Task 2

### Task 4: Preserve global and existing log contracts

**Story:** Story 1 — no stale global tag, no duplicate contextual prefix, and unchanged timestamp/ANSI/rotation/transition behavior
**Type:** negative-path

**Steps:**
1. Add failing regression cases that alternate global and feature-owned lines, include prefix-like message content, and exercise the existing transition-suppression and persisted-log composition.
2. Verify the new cases fail against any leaking or double-prefix behavior (RED).
3. Make the smallest composition corrections needed so global output stays `[daemon]`, feature context is added exactly once, and existing timestamp, ANSI stripping, rotation, and message text contracts remain intact.
4. Run the union of daemon log, daemon runner, transition logging, and progress rendering tests (GREEN).
5. Commit with message: `test(daemon): preserve contextual log boundaries`.

**Files:** `src/conductor/src/daemon-cli.ts`; `src/conductor/src/engine/daemon-log.ts`; `src/conductor/test/engine/daemon-log.test.ts`; `src/conductor/test/engine/daemon-runner.test.ts`; `src/conductor/test/engine/daemon-transition-status-logging.test.ts`; `src/conductor/test/daemon-render-progress.test.ts`

**Wired-into:** same as Task 3

**Dependencies:** Task 3

## Task Dependency Graph

`Task 1 → Task 2 → Task 3 → Task 4`

## Integration Points

- After Task 2: feature-run orchestration has isolated contextual loggers.
- After Task 3: representative active-feature output is attributable end to end.
- After Task 4: global output and all existing durable log contracts are regression-protected.

## Acceptance Coverage

| Story criterion | Tasks |
|---|---|
| Every feature-owned lifecycle line has `[daemon][feature]` | 2, 3 |
| Long slugs truncate deterministically to a 24-character display | 1 |
| Short slugs remain complete | 1 |
| Global lines retain `[daemon]` only | 1, 4 |
| Prefix-like content does not cause duplicate contextual prefixes | 4 |
| Overlapping feature loggers do not leak identity | 2 |
| Live/persisted output and existing timestamp/ANSI/rotation/transition contracts remain intact | 3, 4 |

## Verification

- [ ] All happy-path criteria map to Tasks 1–3.
- [ ] All negative-path criteria map to Tasks 2 and 4.
- [ ] Every task follows RED → GREEN and declares dependencies.
- [ ] Production surfaces declare concrete wiring sites.
- [ ] The aggregate repository verifier passes before SHIP.
