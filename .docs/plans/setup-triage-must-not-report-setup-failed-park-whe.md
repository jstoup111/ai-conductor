# Implementation Plan: Setup-triage decides on the setup exit, not solely a residual dirty tree (#582)

**Date:** 2026-07-12
**Track:** technical (.docs/track/setup-triage-must-not-report-setup-failed-park-whe.md)
**Stories:** .docs/stories/setup-triage-must-not-report-setup-failed-park-whe.md (Accepted)
**Governing ADR:** .docs/decisions/adr-2026-07-09-setup-failure-triage.md (APPROVED) — this fix
stays inside its contract (still parks; still preserves strays); no amendment.

## Summary

Separate the two signals conflated in the daemon setup-failure triage's terminal park: a genuine
nonzero setup exit stays "setup-still-failing", but a fix-session whose `bin/setup` re-run exited
0 yet left the tree dirty becomes a distinct, accurately-surfaced "dirty-tree-uncleaned" park
that also quarantines ALL residual uncommitted paths (incl. tracked-modified `conductor.ts`) — so
it is never reported as "setup failed" and nothing is silently discarded. 4 tasks.

## Technical Approach

- **One new terminal branch in `fixSession`** (`src/conductor/src/engine/setup-triage.ts`). Today
  step 5-6 (setup-triage.ts:599-610): after `runPrepare` succeeds, a dirty porcelain returns
  `{kind:'park', outputTail:'', preservedPaths: dirtyPaths}`. Replace with: when porcelain is
  dirty, call the existing `quarantine(git, slug)` to capture ALL uncommitted paths (`git add -A`
  → commit → `git branch -f wip/setup-quarantine-<slug>` → `reset --hard`); if quarantine returns
  a park (preservation failure), return that park unchanged (fail-toward-park, never data loss);
  otherwise return `{kind:'park', contractOutcome:'dirty-tree-uncleaned', quarantineRef:
  <ref>, preservedPaths: <captured paths>, outputTail: "<accurate message: bin/setup exited 0 but
  the worktree could not be brought clean — residual uncommitted paths quarantined to <ref>:
  <paths>">}`. The empty-porcelain path still returns `fixed-pass` (unchanged); the
  `runPrepare`-throws path still returns `contractOutcome:'setup-still-failing'` (unchanged).
- **`fixSession` gains a logger param** (optional, defaulted) only if needed to thread the
  quarantine logger; if kept internal, pass `undefined` — no call-site change required
  (daemon-cli.ts:873 passes positional args; a trailing optional param is source-compatible).
- **Neutralize the daemon-runner failure-class assumption** (`src/conductor/src/engine/
  daemon-runner.ts`). Line 258's fallback literal `'setup failed and parked after triage'` is
  the false attribution for the empty-tail dirty-tree park. With the fix the dirty-tree park now
  carries a non-empty accurate `outputTail`, so the fallback no longer triggers for it — but
  neutralize the fallback anyway to a cause-agnostic string (e.g. `'parked after setup triage'`)
  so no park is ever mislabeled "setup failed" purely from an empty tail. The log line at 251 and
  the HALT renderer (daemon-runner.ts:453-476, already renders `contractOutcome`/`quarantineRef`/
  `preservedPaths`) then read accurately with no further change.
- **Discriminator, not a union change.** The `park` variant of `TriageOutcome` already permits
  `contractOutcome?: string`, `quarantineRef?: string`, `preservedPaths?: string[]`
  (setup-triage.ts:78-84) — the new `'dirty-tree-uncleaned'` value needs no type edit. Document
  the two `contractOutcome` values in the union's doc comment.
- **Anchors, not line numbers:** all insertion points named structurally (`fixSession` step 5-6
  branch; daemon-runner park-reason fallback) since concurrent engine builds shift line numbers.
- **Sequencing:** core `fixSession` branch + capture first (unit-testable in isolation), then the
  daemon-runner rendering fix, then the coupled acceptance assertion, CHANGELOG last.

## Prerequisites

None. `quarantine()`, the `TriageOutcome` union, and the daemon-runner HALT/reason rendering all
exist on main. Tests run from `src/conductor` (vitest config lives there; always `cd src/conductor`).

## Tasks

### Task 1: fixSession — distinct dirty-tree-uncleaned outcome + residual-stray quarantine
**Story:** Story 1 (happy: distinct outcome, no "setup failed"; negatives: still-failing, fixed-pass),
Story 2 (happy: capture all incl. tracked; refreshed ref; negative: preservation failure parks)
**Type:** happy-path + negative (core engine)

**Steps:**
1. Update the existing test `test/engine/setup-triage.test.ts:731` ("(c) … porcelain dirty →
   park with dirty paths") to the new contract, and add new cases in the same describe block:
   (a) resolving dispatch + succeeding `runPrepare` + dirty porcelain incl.
   ` M src/conductor/src/engine/conductor.ts` and `?? scratch.txt` → assert `kind:'park'`,
   `contractOutcome:'dirty-tree-uncleaned'`, `quarantineRef` set, `preservedPaths` contains the
   tracked path, and `outputTail` does NOT contain "setup failed"; (b) capture over a
   pre-existing quarantine ref → assert `git branch -f` (refresh) issued; (c) `git add -A`/commit
   returns nonzero → assert park naming the preservation failure, no proceed; (d) throwing
   `runPrepare` → `contractOutcome:'setup-still-failing'` (unchanged); (e) empty porcelain →
   `fixed-pass` (unchanged); (f) throwing `dispatchFixSession` → park, no quarantine attempted.
2. Verify RED (current code returns the old empty-tail park for the dirty case, no quarantine).
3. Implement the new terminal branch in `fixSession` (setup-triage.ts step 5-6): on dirty
   porcelain, call `quarantine(git, slug)`; if it returns a `park`, return it; else build the
   `dirty-tree-uncleaned` park with the accurate `outputTail`, `quarantineRef`, and
   `preservedPaths` from the quarantine result. Update the `TriageOutcome` union doc comment to
   name both `contractOutcome` values.
4. Verify GREEN (new + existing setup-triage tests).
5. Commit: "fix(setup-triage): dirty tree after setup success parks distinctly + quarantines strays (#582)"

**Files:**
- src/conductor/src/engine/setup-triage.ts
- src/conductor/test/engine/setup-triage.test.ts

**Dependencies:** none

### Task 2: daemon-runner — never mislabel a park as "setup failed"
**Story:** Story 1 (happy: feature reason + HALT note carry no "setup failed"; log line accurate)
**Type:** happy-path (coupled rendering)

**Steps:**
1. Add/extend a test in `test/engine/daemon-runner.test.ts`: drive `makeRunFeature` with a
   `runSetupTriage` stub returning the `dirty-tree-uncleaned` park (non-empty accurate tail,
   `quarantineRef`, `preservedPaths`), assert the returned feature `reason` and the written
   `.pipeline/HALT` note contain neither `setup failed and parked after triage` nor a bare
   "setup failed", and DO contain the dirty-tree cause + `Contract outcome: dirty-tree-uncleaned`.
   Add a second case: a park with an EMPTY `outputTail` renders the neutral fallback (not "setup
   failed").
2. Verify RED (fallback literal still says "setup failed and parked after triage").
3. Implement: change the daemon-runner park-reason fallback (daemon-runner.ts near line 258) from
   `'setup failed and parked after triage'` to a cause-agnostic `'parked after setup triage'`.
   Leave the HALT renderer (453-476) and log line (251) unchanged — they already surface the
   accurate fields.
4. Verify GREEN.
5. Commit: "fix(daemon-runner): park reason no longer hardcodes 'setup failed' (#582)"

**Files:**
- src/conductor/src/engine/daemon-runner.ts
- src/conductor/test/engine/daemon-runner.test.ts

**Dependencies:** Task 1 (shares the outcome contract the test asserts)

### Task 3: Acceptance — end-to-end triage of setup-success-with-dirty-tree
**Story:** Story 1 + Story 2 (integration of both seams over the #582 shape)
**Type:** acceptance

**Steps:**
1. In `test/acceptance/setup-triage-dispatch.acceptance.test.ts` (or a sibling acceptance test),
   add a scenario over a real temp git repo: seed a HEAD, make a `runPrepare` that succeeds but
   leaves a tracked file modified, drive the daemon-cli-wired `runSetupTriage` (or `fixSession`
   directly against a real `GitRunner`) and assert: outcome `dirty-tree-uncleaned`; a real
   `wip/setup-quarantine-<slug>` ref exists and its commit contains the modified tracked file;
   the working tree is clean after; and the surfaced reason contains no "setup failed".
2. Verify RED, then GREEN after Tasks 1-2 are in.
3. Commit: "test(setup-triage): acceptance for setup-success-with-dirty-tree quarantine+surface (#582)"

**Files:**
- src/conductor/test/acceptance/setup-triage-dispatch.acceptance.test.ts

**Dependencies:** Task 1, Task 2

### Task 4: CHANGELOG
**Story:** repo release gate (CHANGELOG on every PR)
**Type:** infrastructure

**Steps:**
1. Add under `## [Unreleased]` → `### Fixed`: an entry describing that the daemon setup-failure
   triage now distinguishes a setup-success-with-dirty-tree (accurate "dirty tree could not be
   cleaned" park that quarantines all residual uncommitted paths) from a genuine setup failure,
   and no longer reports "setup failed" when `bin/setup` succeeded (#582).
2. No `## Migration` block: touched files are engine internals, not a `CANONICAL_BREAKING_SURFACES`
   (bin/conduct CLI, skill symlink targets, hook wiring, settings.json schema). No waiver needed.
3. Commit: "docs(changelog): setup-triage dirty-tree vs setup-failure distinction (#582)"

**Files:**
- CHANGELOG.md

**Dependencies:** none

## Task Graph

```
Task 1 ──┬──> Task 2 ──> Task 3
         └───────────────┘
Task 4 (independent)
```

- Task 1: core engine + capture (no deps)
- Task 2: depends on Task 1 (outcome contract)
- Task 3: depends on Task 1 + Task 2 (end-to-end)
- Task 4: independent (CHANGELOG)

## Verification

- `cd src/conductor && npx vitest run test/engine/setup-triage.test.ts test/engine/daemon-runner.test.ts test/acceptance/setup-triage-dispatch.acceptance.test.ts` — all green.
- Full engine suite green (no regression to the `fixed-pass` / `setup-still-failing` / stage-1
  quarantine paths): `cd src/conductor && npx vitest run`.
- Harness integrity: `test/test_harness_integrity.sh` passes (bash syntax, no schema/skill drift).
- Manual read-through: the daemon log for a setup-success-with-dirty-tree park no longer emits
  `setup failed and parked after triage`; the HALT note names the quarantine ref and
  `dirty-tree-uncleaned`.

## Coverage

| Story | Acceptance criterion | Task(s) |
|-------|----------------------|---------|
| 1 | Dirty-after-success → distinct `dirty-tree-uncleaned` park, no "setup failed" | 1 |
| 1 | Feature reason + HALT note carry no "setup failed"; log accurate | 2 |
| 1 | Genuine nonzero setup exit still `setup-still-failing` | 1 |
| 1 | Empty porcelain after success still `fixed-pass` | 1 |
| 2 | Capture ALL uncommitted incl. tracked-modified; `quarantineRef` set | 1 |
| 2 | Pre-existing quarantine ref refreshed (force-moved) | 1 |
| 2 | Preservation failure parks (no data loss, no proceed) | 1 |
| 2 | Throwing dispatch parks with no quarantine attempted | 1 |
| 1+2 | End-to-end over a real repo: ref exists, tree clean, no "setup failed" | 3 |
| gate | CHANGELOG [Unreleased] entry | 4 |
```
